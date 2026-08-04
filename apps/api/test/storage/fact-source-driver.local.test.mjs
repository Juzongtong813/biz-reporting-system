/**
 * B8 — LocalFactSourceDriver 驱动层单元测试（任务 B8，无凭据、无网络可跑）。
 *
 * 覆盖（对应 B8 验收判据 + C-3.1/C-3.2 对象层语义）：
 * - put/get/head/exists/delete 全方法
 * - 幂等 deduplicated：同 buffer 连调两次 → 第一次 false、第二次 true、storageKey 相同
 * - hash 不符 → SOURCE_FILE_HASH_MISMATCH
 * - key 非法 → SOURCE_FILE_STORAGE_KEY_INVALID
 * - 路径越界 → SOURCE_FILE_STORAGE_KEY_OUTSIDE_ROOT
 * - get 不存在 → SOURCE_FILE_NOT_FOUND
 * - delete 不存在 → 静默成功（幂等删除）
 * - assertReadable / assertWritable 语义
 *
 * 执行：node apps/api/test/storage/fact-source-driver.local.test.mjs（node:test，零新增依赖）
 *      或经 pnpm test:unit（run-unit.mjs 注册）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const API_ROOT = path.join(REPO_ROOT, 'apps', 'api');
const apiRequire = createRequire(path.join(API_ROOT, 'package.json'));

let compiledRoot = null;
let tempRoot = null;

function compileCurrentSrc() {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-b8-local-'));
  compiledRoot = path.join(tempRoot, 'compiled');
  process.env.NODE_PATH = [
    path.join(API_ROOT, 'node_modules'),
    path.join(REPO_ROOT, 'node_modules'),
    process.env.NODE_PATH,
  ].filter(Boolean).join(path.delimiter);
  Module._initPaths();
  apiRequire('reflect-metadata');
  const tsc = apiRequire.resolve('typescript/bin/tsc');
  execFileSync(
    process.execPath,
    [tsc, '-p', path.join(API_ROOT, 'tsconfig.v3-check.json'), '--noEmit', 'false', '--declaration', 'false', '--outDir', compiledRoot, '--pretty', 'false'],
    { cwd: REPO_ROOT, stdio: 'pipe' },
  );
}

function compiled(rel) {
  return apiRequire(path.join(compiledRoot, 'apps', 'api', 'src', rel));
}

function makeHash(buffer) {
  const { createHash } = apiRequire('node:crypto');
  return createHash('sha256').update(buffer).digest('hex');
}

let LocalFactSourceDriver;
let FactSourceStorageError;
let driver;
let rootDir;

before(() => {
  compileCurrentSrc();
  LocalFactSourceDriver = compiled('facts/storage/local-fact-source-driver.js').LocalFactSourceDriver;
  FactSourceStorageError = compiled('facts/storage/fact-source-storage.error.js').FactSourceStorageError;
  rootDir = path.join(tempRoot, 'local-root');
  driver = new LocalFactSourceDriver(rootDir);
});

after(() => {
  if (tempRoot && fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('put 后 get/head/exists 一致；storageKey 为逻辑键 xx/<sha>', async () => {
  const payload = Buffer.from('B8 local put/get 一致', 'utf8');
  const sha = makeHash(payload);
  const expectedKey = `${sha.slice(0, 2)}/${sha}`;

  const stored = await driver.put({ buffer: payload, originalName: 'a.xlsx', expectedSha256: sha });
  assert.equal(stored.storageKey, expectedKey, 'storageKey 应为逻辑键 xx/<sha>');
  assert.equal(stored.size, payload.length);
  assert.equal(stored.sha256, sha);
  assert.equal(stored.deduplicated, false, '首次写入 deduplicated=false');
  assert.ok(stored.storedAt instanceof Date);

  const readBack = await driver.get(expectedKey);
  assert.deepEqual(readBack, payload, 'get 应读回原内容');

  const meta = await driver.head(expectedKey);
  assert.ok(meta, 'head 应命中');
  assert.equal(meta.size, payload.length);
  assert.equal(meta.sha256, sha);

  assert.equal(await driver.exists(expectedKey), true, 'exists 应为 true');
  const missingKey = `${'ab'.padEnd(2, '0')}/${'0'.repeat(64)}`;
  assert.equal(await driver.exists(missingKey), false, '不存在应为 false');
});

test('幂等：同 buffer 连调两次 → 第二次 deduplicated=true、storageKey 相同、不重复写入', async () => {
  const payload = Buffer.from('B8 local 幂等 deduplicated', 'utf8');
  const sha = makeHash(payload);

  const first = await driver.put({ buffer: payload, originalName: 'b.xlsx', expectedSha256: sha });
  assert.equal(first.deduplicated, false);

  const second = await driver.put({ buffer: payload, originalName: 'b.xlsx', expectedSha256: sha });
  assert.equal(second.deduplicated, true, '第二次应 deduplicated=true（C-3.1 对象层幂等）');
  assert.equal(second.storageKey, first.storageKey, '两次 storageKey 应相同');

  // 内容仍可读且一致（不可变语义）
  const readBack = await driver.get(first.storageKey);
  assert.deepEqual(readBack, payload);
});

test('hash 不符 → SOURCE_FILE_HASH_MISMATCH', async () => {
  const payload = Buffer.from('B8 local hash mismatch', 'utf8');
  const wrongSha = '0'.repeat(64);
  await assert.rejects(
    driver.put({ buffer: payload, originalName: 'c.xlsx', expectedSha256: wrongSha }),
    (error) => error instanceof FactSourceStorageError
      && error.code === 'SOURCE_FILE_HASH_MISMATCH'
      && error.retryable === false,
    'hash 不符应抛 SOURCE_FILE_HASH_MISMATCH',
  );
});

test('key 非法：get/head/delete 抛 SOURCE_FILE_STORAGE_KEY_INVALID；exists 保持既有语义返回 false', async () => {
  await assert.rejects(driver.get('not-a-key'), (error) => error.code === 'SOURCE_FILE_STORAGE_KEY_INVALID');
  await assert.rejects(driver.head('xx/not-a-real-sha'), (error) => error.code === 'SOURCE_FILE_STORAGE_KEY_INVALID');
  await assert.rejects(driver.delete('ab/cd'), (error) => error.code === 'SOURCE_FILE_STORAGE_KEY_INVALID');
  // 带路径分隔符的 key 不符合内容寻址正则 → get 抛 KEY_INVALID
  await assert.rejects(
    driver.get(`aa/${'a'.repeat(64)}/../../etc/passwd`),
    (error) => error.code === 'SOURCE_FILE_STORAGE_KEY_INVALID',
  );
  // exists() 保留既有实现语义（catch-all → false）：非法 key 不抛错、不触碰文件系统
  assert.equal(await driver.exists('../../etc/passwd'), false, 'exists 对非法 key 应返回 false（既有语义）');
});

test('get 不存在 → SOURCE_FILE_NOT_FOUND', async () => {
  const missingKey = `${'ff'.padEnd(2, '0')}/${'f'.repeat(64)}`;
  await assert.rejects(
    driver.get(missingKey),
    (error) => error instanceof FactSourceStorageError && error.code === 'SOURCE_FILE_NOT_FOUND',
    'get 不存在应抛 SOURCE_FILE_NOT_FOUND',
  );
});

test('delete 幂等：存在删除成功、不存在静默成功', async () => {
  const payload = Buffer.from('B8 local delete', 'utf8');
  const sha = makeHash(payload);
  const key = `${sha.slice(0, 2)}/${sha}`;

  await driver.put({ buffer: payload, originalName: 'd.xlsx', expectedSha256: sha });
  assert.equal(await driver.exists(key), true);
  await driver.delete(key);
  assert.equal(await driver.exists(key), false, '删除后 exists 应为 false');

  // 幂等删除：不存在时静默成功
  await driver.delete(key);
  assert.equal(await driver.head(key), null, '删除后 head 应为 null');
});

test('head 不存在返回 null（不抛错）', async () => {
  const missingKey = `${'ab'.padEnd(2, '0')}/${'b'.repeat(64)}`;
  const meta = await driver.head(missingKey);
  assert.equal(meta, null, 'head 不存在应返回 null');
});

test('assertReadable 目录不可读时抛错；assertWritable 创建并清理探针文件', async () => {
  // 目录存在时 assertReadable 通过
  await driver.assertReadable();
  // assertWritable 会创建根目录 + 探针文件并清理
  await driver.assertWritable();
  assert.equal(fs.existsSync(rootDir), true, 'assertWritable 应创建根目录');
  const leftovers = fs.readdirSync(rootDir).filter((name) => name.startsWith('.readiness-probe-'));
  assert.deepEqual(leftovers, [], 'assertWritable 后探针文件应被清理');

  // 目录不存在且父路径不可创建（指向一个文件路径下的子目录）→ assertWritable 抛错
  const blockedRoot = path.join(tempRoot, 'blocked');
  fs.writeFileSync(blockedRoot, 'i am a file');
  const blockedDriver = new LocalFactSourceDriver(path.join(blockedRoot, 'sub'));
  await assert.rejects(blockedDriver.assertWritable());
});
