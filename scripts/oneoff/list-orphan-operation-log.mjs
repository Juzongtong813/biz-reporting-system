#!/usr/bin/env node
/**
 * D5（Codex PG-20260805-COS-D-CORRECTION）：孤儿标记 **operation-log 离线盘点**（只读对账，绝不执行删除）
 *
 * 依据：设计 §6.4 / 任务 D5 / 裁决 Q-02。
 *
 * ⚠️ 定位声明（D5 修正）：
 *  本脚本是 **orphan operation-log 离线盘点**，仅读取本地 SQLite（operation_logs 表）中的
 *  补偿标记与本地文件系统存在性判定，**未核对真实 COS 桶**，不得宣称已核对真实 COS 对象。
 *  真实 COS 只读对账（list/head）需等 F 阶段桶与 STS 凭据就绪后另行实现。
 *
 * 背景：
 *  - 补偿删除（C1/C2）删除失败时会在 operation_logs 写入
 *    action_type='fact_source_object_orphaned'、result_status='failed' 的孤儿标记
 *    （after_data_json={ storageKey, sha256, size, reason }）。
 *  - 本脚本把这类孤儿标记盘出来，并在可用的本地存储根目录下（FACT_SOURCE_STORAGE_ROOT）
 *    判定对象当前是否仍存在，输出 JSON 报告供人工复核后决定是否清理。
 *
 * 安全约束（硬性）：
 *  - **只读**：绝不调用 deleteObject / fs.unlink / DELETE SQL；本脚本不提供任何删除开关。
 *  - 不连接真实 COS：不做任何网络请求；仅读取本地 SQLite（离线对账）与本地 fs 存在性。
 *  - 输出不含任何密钥；仅 storageKey / sha256 / size / reason / createdAt / 存在性。
 *
 * 用法：
 *   node scripts/oneoff/list-orphan-operation-log.mjs --db <sqlite路径> [--storage-root <本地根目录>]
 *   示例：node scripts/oneoff/list-orphan-operation-log.mjs --db ./data/dev.sqlite --storage-root ./data/fact-source-files
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const require = createRequire(path.join(REPO_ROOT, 'apps/api/package.json'));

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
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

  if (!dbPath || !fs.existsSync(dbPath)) {
    console.error('FATAL: 缺少有效 --db（sqlite 路径）或 MIGRATION_TEST_DB_DATABASE');
    process.exit(2);
  }

  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    console.error('FATAL: 无法加载 better-sqlite3（本仓库测试/离线对账使用 sqlite 载体）');
    process.exit(2);
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const tableCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='operation_logs'",
    ).get();
    if (!tableCheck) {
      console.error('FATAL: 数据库中没有 operation_logs 表（孤儿标记载体缺失）');
      process.exit(2);
    }

    const rows = db.prepare(`
      SELECT id, action_type, result_status, summary_text, after_data_json, created_at
      FROM operation_logs
      WHERE action_type IN ('fact_source_object_orphaned','fact_source_object_compensation_skipped','fact_source_object_compensated')
      ORDER BY id DESC
      LIMIT 1000
    `).all();

    const orphans = [];
    for (const row of rows) {
      let after = {};
      try {
        after = typeof row.after_data_json === 'string'
          ? JSON.parse(row.after_data_json)
          : (row.after_data_json ?? {});
      } catch {
        after = { parseError: true };
      }
      const storageKey = typeof after.storageKey === 'string' ? after.storageKey : null;
      let existsOnDisk = null;
      if (storageKey && storageRoot && fs.existsSync(storageRoot)) {
        const absolute = path.resolve(storageRoot, storageKey);
        if (absolute.startsWith(`${path.resolve(storageRoot)}${path.sep}`)) {
          existsOnDisk = fs.existsSync(absolute);
        }
      }
      orphans.push({
        operationLogId: row.id,
        actionType: row.action_type,
        resultStatus: row.result_status,
        summaryText: row.summary_text,
        storageKey,
        sha256: typeof after.sha256 === 'string' ? after.sha256 : null,
        size: typeof after.size === 'number' ? after.size : null,
        reason: typeof after.reason === 'string' ? after.reason : null,
        createdAt: row.created_at,
        existsOnDisk,
      });
    }

    const report = {
      generatedAt: new Date().toISOString(),
      dbPath,
      storageRoot,
      orphanMarkerCount: orphans.length,
      items: orphans,
      scope: 'ORPHAN_OPERATION_LOG_OFFLINE_INVENTORY',
      cosVerification: 'NOT_VERIFIED',
      note: 'D5 定位声明：本报告仅为 operation_logs 离线盘点，未核对真实 COS 桶；真实 COS 对账需 F 阶段桶与 STS 凭据就绪后执行。只读报告仅供人工复核，请勿直接删除生产对象（tasks.md §0.4 / 设计 §6.4）。',
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    db.close();
  }
}

main();
