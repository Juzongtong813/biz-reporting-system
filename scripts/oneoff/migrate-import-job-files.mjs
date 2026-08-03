#!/usr/bin/env node
/**
 * D-06：旧 Base64 文件迁移工具（默认 dry-run）
 *
 * 将 import_jobs 中仍以 source_file_base64 存储的源文件迁移到内容寻址持久存储
 * （<storage_root>/<sha256 前两位>/<sha256>），并回填 storage_key/sha256/size/stored_at 元数据。
 *
 * 安全约束（tasks.md D-06 / PG-R8、R11、R14）：
 * - 默认 dry-run：只报告将迁移的 job，不写任何数据。
 * - `--apply` 必须同时提供 `--env-id`（连接标识校验），否则硬失败退出（exit 2）。
 * - ID 游标分页（batch=20），禁止 OFFSET 全表扫描。
 * - 幂等：已迁移且 hash 一致的任务跳过。
 * - 失败保留 Base64 不动，输出脱敏 job ID + 错误码。
 * - 不实现清空 Base64 功能（历史数据保留，回退安全）。
 * - 禁止输出原始 Base64 内容（日志仅 job ID / 错误码 / hash 前缀）。
 *
 * 用法：
 *   node scripts/oneoff/migrate-import-job-files.mjs --db <sqlite路径> --storage-root <根目录>
 *   node scripts/oneoff/migrate-import-job-files.mjs --db <路径> --storage-root <根> --apply --env-id <标识>
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
// pnpm 不 hoist：better-sqlite3 位于 apps/api 依赖树，用 createRequire 从该处解析
const require = createRequire(path.join(REPO_ROOT, 'apps/api/package.json'));
const Database = require('better-sqlite3');

const BATCH_SIZE = 20;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply' || token === '--dry-run') {
      args[token.slice(2)] = true;
      continue;
    }
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error(`FATAL: 缺少参数值：--${key}`);
        process.exit(2);
      }
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.db || process.env.MIGRATION_TEST_DB_DATABASE || '';
  const storageRoot = args['storage-root'] || process.env.FACT_SOURCE_STORAGE_ROOT || '';
  const apply = Boolean(args.apply);
  const envId = args['env-id'] || '';

  if (!dbPath || !fs.existsSync(dbPath)) {
    console.error('FATAL: 缺少有效 --db（sqlite 路径）或 MIGRATION_TEST_DB_DATABASE');
    process.exit(2);
  }
  if (!storageRoot) {
    console.error('FATAL: 缺少 --storage-root 或 FACT_SOURCE_STORAGE_ROOT');
    process.exit(2);
  }

  if (apply) {
    // --apply 必须 --env-id，且 env-id 必须与数据库标识匹配（防止误连生产）
    if (!envId) {
      console.error('FATAL: --apply 必须提供 --env-id（连接标识校验）');
      process.exit(2);
    }
    const basename = path.basename(dbPath);
    if (!basename.includes(envId)) {
      console.error(`FATAL: --env-id "${envId}" 与数据库标识 "${basename}" 不匹配，拒绝写入`);
      process.exit(2);
    }
  }

  const db = new Database(dbPath, { readonly: apply ? false : true });
  if (apply) db.pragma('journal_mode = WAL');

  const migrated = [];   // { id, key? }
  const skipped = [];    // { id, reason }
  const failed = [];     // { id, code }

  let cursor = 0;
  let scanned = 0;
  // 校验表结构（import_jobs 需含 D-01 字段）
  const cols = db.prepare('PRAGMA table_info(import_jobs)').all().map((c) => c.name);
  for (const need of ['source_file_base64', 'source_file_storage_key', 'source_file_sha256', 'source_file_size', 'source_file_stored_at']) {
    if (!cols.includes(need)) {
      console.error(`FATAL: import_jobs 缺少列 ${need}（需先执行 009 迁移）`);
      process.exit(2);
    }
  }

  const stmt = db.prepare(
    `SELECT id, source_file_base64, source_file_sha256, source_file_storage_key, source_file_size
     FROM import_jobs WHERE id > ? ORDER BY id LIMIT ${BATCH_SIZE}`,
  );

  while (true) {
    const rows = stmt.all(cursor);
    if (rows.length === 0) break;
    for (const row of rows) {
      cursor = Number(row.id);
      scanned += 1;

      if (row.source_file_storage_key) {
        skipped.push({ id: Number(row.id), reason: 'already_migrated' });
        continue;
      }
      if (!row.source_file_base64) {
        skipped.push({ id: Number(row.id), reason: 'no_base64' });
        continue;
      }

      let buf;
      try {
        buf = Buffer.from(row.source_file_base64, 'base64');
      } catch {
        failed.push({ id: Number(row.id), code: 'BASE64_DECODE' });
        continue;
      }
      if (buf.length === 0) {
        failed.push({ id: Number(row.id), code: 'EMPTY_BASE64' });
        continue;
      }
      const sha = createHash('sha256').update(buf).digest('hex');
      if (row.source_file_sha256 && row.source_file_sha256 !== sha) {
        failed.push({ id: Number(row.id), code: 'HASH_MISMATCH' });
        continue;
      }

      const key = `${sha.slice(0, 2)}/${sha}`;
      if (!apply) {
        migrated.push({ id: Number(row.id), key: key.slice(0, 8) });
        continue;
      }

      // apply：写存储文件（wx 幂等，已存在视为已迁移）+ 更新 metadata
      const abs = path.join(storageRoot, key);
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        try {
          fs.writeFileSync(abs, buf, { flag: 'wx' });
        } catch (e) {
          if (e.code !== 'EEXIST') throw e;
        }
        db.prepare(
          `UPDATE import_jobs SET source_file_storage_key=?, source_file_sha256=?, source_file_size=?, source_file_stored_at=? WHERE id=?`,
        ).run(key, sha, buf.length, new Date().toISOString(), Number(row.id));
        migrated.push({ id: Number(row.id), key: key.slice(0, 8) });
      } catch (e) {
        failed.push({ id: Number(row.id), code: (e && e.code) || 'STORE_FAILED' });
      }
    }
  }

  db.close();

  // 汇总（脱敏：只输出 job ID 与错误码，不输出 Base64 内容）
  console.log(`MIGRATE_IMPORT_FILES mode=${apply ? 'apply' : 'dry-run'} env_id=${apply ? envId : '(n/a)'} scanned=${scanned} migrated=${migrated.length} skipped=${skipped.length} failed=${failed.length}`);
  if (migrated.length > 0 && !apply) {
    console.log(`DRY_RUN_PREVIEW first=${JSON.stringify(migrated.slice(0, 5))} total=${migrated.length}（apply 需 --env-id）`);
  }
  if (failed.length > 0) {
    console.log(`FAILED_DETAILS ${JSON.stringify(failed.slice(0, 20))}`);
  }
  if (skipped.length > 0) {
    console.log(`SKIPPED_DETAILS ${JSON.stringify(skipped.slice(0, 10))}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

main();
