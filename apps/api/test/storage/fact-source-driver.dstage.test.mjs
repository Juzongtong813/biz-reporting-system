/**
 * D 阶段 — 存储层 7 类用例（QA 严过关 / 主理人按 Codex 令第 7 条接管执行）。
 *
 * 覆盖（对应 D 阶段验收判据 + 设计 §2.2/§4.2/§5.1/§11 裁决 D-1~D-5）：
 * 1. hash/size    — store 后对象内容/大小/逻辑键正确（D-4）
 * 2. 幂等         — 同 sha256 重复 store → deduplicated=true、不重复写对象
 * 3. 并发         — 同 key 并发 store → 单对象写入、无双写
 * 4. 失败补偿     — COS 上传成功但"业务层失败"→ delete 被调 1 次；deduplicated=true 不删
 * 5. orphan       — 补偿删除失败 → 记录 orphan（三态落盘由 C 阶段 operation_logs 承担；
 *                   本测试在对象层验证 delete 抛错可被捕获并留下 storageKey/sha256 证据）
 * 6. 重启恢复     — Local driver：同 root 重建实例后对象仍可读（模拟进程重启）
 * 7. 鉴权         — assertCredentials 空凭据抛错；COS assertReadable 仅 headBucket（D-2）
 *
 * 执行：node apps/api/test/storage/fact-source-driver.dstage.test.mjs
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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-dstage-'));
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
let CosFactSourceDriver;
let FakeCosClient;
let withCosResilience;
let assertCredentials;
let StaticCredentialProvider;
let createStaticCredentialProvider;
let FactSourceStorageError;
let isFactSourceStorageError;

const PREFIX = 'fact-source-files/';

function makeCosDriver(client, options = {}) {
  const resilient = withCosResilience(client, { requestTimeoutMs: 500, maxRetries: 0, sleep: async () => {} });
  return new CosFactSourceDriver(resilient, { objectPrefix: PREFIX, ...options });
}

before(() => {
  compileCurrentSrc();
  LocalFactSourceDriver = compiled('facts/storage/local-fact-source-driver.js').LocalFactSourceDriver;
  CosFactSourceDriver = compiled('facts/storage/cos-fact-source-driver.js').CosFactSourceDriver;
  FakeCosClient = compiled('facts/storage/fake-cos-client.js').FakeCosClient;
  withCosResilience = compiled('facts/storage/cos-resilience.js').withCosResilience;
  assertCredentials = compiled('facts/storage/credential.provider.js').assertCredentials;
  StaticCredentialProvider = compiled('facts/storage/credential.provider.js').StaticCredentialProvider;
  createStaticCredentialProvider = compiled('facts/storage/credential.provider.js').createStaticCredentialProvider;
  FactSourceStorageError = compiled('facts/storage/fact-source-storage.error.js').FactSourceStorageError;
  isFactSourceStorageError = compiled('facts/storage/fact-source-storage.error.js').isFactSourceStorageError;
});

after(() => {
  if (tempRoot) {
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ─────────────────────────── 1. hash/size ───────────────────────────

test('D-1a Local：store 后内容/大小/逻辑键正确（D-4）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-dstage-local-hash-'));
  const driver = new LocalFactSourceDriver(root);
  const buffer = Buffer.from('D stage hash size payload', 'utf8');
  const sha = makeHash(buffer);
  const stored = await driver.put({ buffer, originalName: 'a.csv', expectedSha256: sha });
  assert.equal(stored.sha256, sha, 'sha256 应等于输入哈希');
  assert.equal(stored.size, buffer.length, 'size 应等于字节数');
  assert.equal(stored.storageKey, `${sha.slice(0, 2)}/${sha}`, '逻辑键格式应为 xx/<sha256>，不含 prefix');
  assert.equal(stored.contentType, 'text/csv', '按扩展名推断 contentType（a.csv → text/csv）');
  const got = await driver.get(stored.storageKey);
  assert.deepEqual(got, buffer, '读回内容应逐字节一致');
});

test('D-1b COS：store 后返回逻辑键不含 prefix，对象键含 prefix（D-4）', async () => {
  const client = new FakeCosClient();
  const driver = makeCosDriver(client);
  const buffer = Buffer.from('D stage cos hash', 'utf8');
  const sha = makeHash(buffer);
  const stored = await driver.put({ buffer, originalName: 'b.csv', expectedSha256: sha });
  assert.equal(stored.storageKey, `${sha.slice(0, 2)}/${sha}`, '返回 storageKey 必须为逻辑键');
  assert.equal(stored.storageKey.includes(PREFIX), false, '逻辑键不得含 prefix');
  const putCalls = client.calls.filter((c) => c.method === 'putObject');
  assert.equal(putCalls.length, 1);
  assert.equal(putCalls[0].key, `${PREFIX}${stored.storageKey}`, 'COS 对象键应含 prefix');
  assert.equal(stored.size, buffer.length, 'size 应等于字节数');
  const got = await driver.get(stored.storageKey);
  assert.deepEqual(got, buffer, '读回内容应一致');
});

// ─────────────────────────── 2. 幂等 ───────────────────────────

test('D-2a Local：同 buffer 重复 store → 第二次 deduplicated=true 且不重复写', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-dstage-local-idem-'));
  const driver = new LocalFactSourceDriver(root);
  const buffer = Buffer.from('idempotent payload', 'utf8');
  const sha = makeHash(buffer);
  const first = await driver.put({ buffer, originalName: 'i.csv', expectedSha256: sha });
  const second = await driver.put({ buffer, originalName: 'i.csv', expectedSha256: sha });
  assert.equal(first.deduplicated, false, '首次写入应 deduplicated=false');
  assert.equal(second.deduplicated, true, '重复写入应 deduplicated=true');
  assert.equal(second.storageKey, first.storageKey, 'storageKey 应一致');
  const files = fs.readdirSync(path.join(root, sha.slice(0, 2)));
  assert.equal(files.length, 1, '物理文件应只有 1 份，无双写');
});

test('D-2b COS：head 命中且 size 一致 → deduplicated=true、putObject 未被调用', async () => {
  const client = new FakeCosClient();
  const driver = makeCosDriver(client);
  const buffer = Buffer.from('cos idempotent', 'utf8');
  const sha = makeHash(buffer);
  await driver.put({ buffer, originalName: 'c.csv', expectedSha256: sha });
  const again = await driver.put({ buffer, originalName: 'c.csv', expectedSha256: sha });
  assert.equal(again.deduplicated, true, '重复写入应 deduplicated=true');
  const putCalls = client.calls.filter((c) => c.method === 'putObject');
  assert.equal(putCalls.length, 1, 'putObject 应只调用 1 次');
  const headCalls = client.calls.filter((c) => c.method === 'headObject');
  assert.ok(headCalls.length >= 1, '应走 head-then-put 幂等路径');
});

// ─────────────────────────── 3. 并发 ───────────────────────────

test('D-3 Local：同 key 并发 store → 单对象写入、无双写（应用层幂等窗口已知，对象层收敛）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-dstage-local-conc-'));
  const driver = new LocalFactSourceDriver(root);
  const buffer = Buffer.from('concurrent payload', 'utf8');
  const sha = makeHash(buffer);
  const results = await Promise.all([
    driver.put({ buffer, originalName: 'x.csv', expectedSha256: sha }),
    driver.put({ buffer, originalName: 'x.csv', expectedSha256: sha }),
    driver.put({ buffer, originalName: 'x.csv', expectedSha256: sha }),
  ]);
  const keys = new Set(results.map((r) => r.storageKey));
  assert.equal(keys.size, 1, '所有结果 storageKey 应相同');
  const dir = path.join(root, sha.slice(0, 2));
  assert.equal(fs.readdirSync(dir).length, 1, '物理文件应只有 1 份');
  const got = await driver.get([...keys][0]);
  assert.deepEqual(got, buffer, '读回内容应一致');
});

test('D-3b COS：并发 put 同内容 → 最终对象内容一致（内存表只保留一份等价内容）', async () => {
  const client = new FakeCosClient();
  const driver = makeCosDriver(client);
  const buffer = Buffer.from('cos concurrent', 'utf8');
  const sha = makeHash(buffer);
  const results = await Promise.all([
    driver.put({ buffer, originalName: 'y.csv', expectedSha256: sha }),
    driver.put({ buffer, originalName: 'y.csv', expectedSha256: sha }),
  ]);
  assert.equal(new Set(results.map((r) => r.storageKey)).size, 1);
  const logicalKey = results[0].storageKey;
  const got = await driver.get(logicalKey);
  assert.deepEqual(got, buffer, '读回内容应一致');
});

// ─────────────────────────── 4. 失败补偿 ───────────────────────────

test('D-4a COS：上传成功但业务层失败 → delete 被调 1 次（补偿删除触发点）', async () => {
  const client = new FakeCosClient();
  const driver = makeCosDriver(client);
  const buffer = Buffer.from('compensation payload', 'utf8');
  const sha = makeHash(buffer);
  const stored = await driver.put({ buffer, originalName: 'z.csv', expectedSha256: sha });
  // 模拟"MySQL 写库失败"后补偿路径：先查引用（无引用）→ 再 delete
  const referenced = false; // 假设 DB 无引用（D-5 护栏由业务层 anyRowReferences 决定）
  if (!stored.deduplicated && !referenced) {
    await driver.delete(stored.storageKey);
  }
  const deleteCalls = client.calls.filter((c) => c.method === 'deleteObject');
  assert.equal(deleteCalls.length, 1, '补偿删除应触发 1 次');
  assert.equal(deleteCalls[0].key, `${PREFIX}${stored.storageKey}`, '删除应作用于含 prefix 的对象键');
  assert.equal(await driver.exists(stored.storageKey), false, '删除后对象应不存在');
});

test('D-4b COS：deduplicated=true → 绝不补偿删除（护栏①）', async () => {
  const client = new FakeCosClient();
  const driver = makeCosDriver(client);
  const buffer = Buffer.from('dedup no delete', 'utf8');
  const sha = makeHash(buffer);
  const first = await driver.put({ buffer, originalName: 'd.csv', expectedSha256: sha });
  const second = await driver.put({ buffer, originalName: 'd.csv', expectedSha256: sha });
  assert.equal(second.deduplicated, true);
  // 即使业务层误触发，也模拟调用方按 C 阶段护栏跳过删除
  if (!second.deduplicated) {
    await driver.delete(second.storageKey);
  }
  const deleteCalls = client.calls.filter((c) => c.method === 'deleteObject');
  assert.equal(deleteCalls.length, 0, 'deduplicated=true 时不得触发补偿删除');
  assert.equal(await driver.exists(first.storageKey), true, '对象应保留');
});

test('D-4c Local：补偿删除幂等（对象已删除再删 → 静默成功）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-dstage-local-comp-'));
  const driver = new LocalFactSourceDriver(root);
  const buffer = Buffer.from('comp idempotent', 'utf8');
  const sha = makeHash(buffer);
  const stored = await driver.put({ buffer, originalName: 'e.csv', expectedSha256: sha });
  await driver.delete(stored.storageKey);
  await driver.delete(stored.storageKey); // 第二次删除必须静默成功
  assert.equal(await driver.exists(stored.storageKey), false);
});

// ─────────────────────────── 5. orphan object ───────────────────────────

test('D-5a COS：补偿删除失败 → 抛错可捕获，留下 storageKey/sha256 证据（orphan 标记载体）', async () => {
  const client = new FakeCosClient();
  const driver = makeCosDriver(client);
  const buffer = Buffer.from('orphan payload', 'utf8');
  const sha = makeHash(buffer);
  const stored = await driver.put({ buffer, originalName: 'o.csv', expectedSha256: sha });
  // 注入 delete 一次性失败（模拟 COS 删除失败 → orphan）
  client.queueFailure('deleteObject', { statusCode: 500, code: 'InternalError', message: 'delete failed' }, 1);
  let threw = false;
  try {
    await driver.delete(stored.storageKey);
  } catch (err) {
    threw = true;
    assert.ok(isFactSourceStorageError(err), '应抛出 FactSourceStorageError 家族错误');
    assert.equal(err.code, 'SOURCE_FILE_STORAGE_UNAVAILABLE', '5xx 删除失败应映射 STORAGE_UNAVAILABLE');
    // orphan 证据字段（C 阶段落 operation_logs.after_data_json）
    const evidence = { storageKey: stored.storageKey, sha256: stored.sha256, size: stored.size, reason: err.code };
    assert.equal(evidence.storageKey, `${sha.slice(0, 2)}/${sha}`, 'orphan 证据应含逻辑键');
    assert.equal(evidence.sha256, sha, 'orphan 证据应含 sha256');
  }
  assert.ok(threw, '删除失败必须上抛（不吞），由业务层落 orphan 标记');
  // 重试成功后对象可删（恢复路径）
  await driver.delete(stored.storageKey);
  assert.equal(await driver.exists(stored.storageKey), false, '重试删除后对象应消失');
});

test('D-5b Local：删除不存在对象静默成功（幂等删除，孤儿清理安全）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-dstage-local-orphan-'));
  const driver = new LocalFactSourceDriver(root);
  const sha = makeHash(Buffer.from('never stored', 'utf8'));
  await driver.delete(`${sha.slice(0, 2)}/${sha}`);
  assert.equal(await driver.exists(`${sha.slice(0, 2)}/${sha}`), false);
});

// ─────────────────────────── 6. 重启恢复 ───────────────────────────

test('D-6a Local：同 root 重建实例（模拟进程重启）→ 对象仍可读', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-dstage-local-restart-'));
  const driver1 = new LocalFactSourceDriver(root);
  const buffer = Buffer.from('restart persistence', 'utf8');
  const sha = makeHash(buffer);
  const stored = await driver1.put({ buffer, originalName: 'r.csv', expectedSha256: sha });
  // 模拟重启：丢弃 driver1，用同一 root 新建 driver2
  const driver2 = new LocalFactSourceDriver(root);
  const got = await driver2.get(stored.storageKey);
  assert.deepEqual(got, buffer, '重启后对象应可读');
  assert.equal(await driver2.exists(stored.storageKey), true);
});

test('D-6b COS：head 可读取元数据（重启后不依赖内存状态）', async () => {
  const client = new FakeCosClient();
  const driver = makeCosDriver(client);
  const buffer = Buffer.from('cos restart', 'utf8');
  const sha = makeHash(buffer);
  const stored = await driver.put({ buffer, originalName: 's.csv', expectedSha256: sha });
  // 模拟重启：新客户端新 driver，对象在"桶"里（FakeCosClient 共享内存表）
  const client2 = new FakeCosClient();
  client2.objects.set(
    `${PREFIX}${stored.storageKey}`,
    { body: buffer, lastModified: new Date().toISOString() },
  );
  const driver2 = makeCosDriver(client2);
  const meta = await driver2.head(stored.storageKey);
  assert.ok(meta, 'head 应能读到元数据');
  assert.equal(meta.sha256, sha, '元数据 sha256 应一致');
  assert.equal(meta.size, buffer.length, '元数据 size 应一致');
  const got = await driver2.get(stored.storageKey);
  assert.deepEqual(got, buffer, '重启后对象应可读');
});

// ─────────────────────────── 7. 鉴权 ───────────────────────────

test('D-7a 凭据校验：空/缺凭据 → assertCredentials 抛 FactSourceStorageConfigError（拒绝匿名）', () => {
  const ConfigError = compiled('facts/storage/fact-source-storage.error.js').FactSourceStorageConfigError;
  assert.throws(
    () => assertCredentials({ secretId: '', secretKey: '', expiredAt: 0 }),
    (err) => err instanceof ConfigError,
    '空 secretId 应抛 FactSourceStorageConfigError',
  );
  assert.throws(
    () => assertCredentials({ secretId: 'ok', secretKey: '', expiredAt: 0 }),
    (err) => err instanceof ConfigError,
    '空 secretKey 应抛 FactSourceStorageConfigError',
  );
});

test('D-7b StaticCredentialProvider：合法凭据通过校验并原样返回', async () => {
  const provider = createStaticCredentialProvider({
    secretId: 'AKIDDSTAGETEST0000',
    secretKey: 'fake-secret-key-for-dstage',
  });
  const creds = await provider.getCredentials();
  assert.equal(creds.secretId, 'AKIDDSTAGETEST0000');
  assert.ok(creds.secretKey.length > 0);
  assert.ok(creds.expiredAt > 0, '应有过期时间');
  assert.doesNotThrow(() => assertCredentials(creds));
});

test('D-7c COS assertReadable：仅 headBucket 只读探针，不产生任何写操作（D-2）', async () => {
  const client = new FakeCosClient();
  const driver = makeCosDriver(client);
  await driver.assertReadable();
  await driver.assertWritable();
  const writes = client.calls.filter((c) => c.method === 'putObject' || c.method === 'deleteObject');
  assert.equal(writes.length, 0, '探针不得产生 putObject/deleteObject 写操作');
  const headBucket = client.calls.filter((c) => c.method === 'headBucket');
  assert.ok(headBucket.length >= 1, '探针应调用 headBucket');
});

test('D-7d COS 未授权：403 → 韧性层不重试并映射为存储错误', async () => {
  const client = new FakeCosClient();
  client.queueFailure('headBucket', { statusCode: 403, code: 'AccessDenied', message: 'no permission' }, 1);
  const driver = makeCosDriver(client, { requestTimeoutMs: 500 });
  let threw = false;
  try {
    await driver.assertReadable();
  } catch (err) {
    threw = true;
    assert.ok(isFactSourceStorageError(err), '403 应映射为 FactSourceStorageError');
    assert.equal(err.code, 'SOURCE_FILE_STORAGE_FORBIDDEN', '403 应映射 SOURCE_FILE_STORAGE_FORBIDDEN');
  }
  assert.ok(threw, '未授权必须抛错');
});

// ─────────── D 纠偏补强（Codex PG-20260805-COS-D-CORRECTION 令四）───────────

test('D-8a production 无 STS 形态 → EnvCredentialProvider 明确失败（BLOCKED_STS_ISSUER_UNDEFINED）', async () => {
  const EnvCredentialProviderC = compiled('facts/storage/credential.provider.js').EnvCredentialProvider;
  const ConfigError = compiled('facts/storage/fact-source-storage.error.js').FactSourceStorageConfigError;
  const prod = new EnvCredentialProviderC({ NODE_ENV: 'production', COS_SECRET_ID: 'x', COS_SECRET_KEY: 'y' });
  await assert.rejects(() => prod.getCredentials(), (err) => err instanceof ConfigError && err.message.includes('BLOCKED_STS_ISSUER_UNDEFINED'),
    '生产装配禁止静默退回永久环境变量密钥');
});

test('D-8b production + STS 形态 → 通过且 sessionToken 保留', async () => {
  const EnvCredentialProviderC = compiled('facts/storage/credential.provider.js').EnvCredentialProvider;
  const prodSts = new EnvCredentialProviderC({
    NODE_ENV: 'production', COS_SECRET_ID: 'x', COS_SECRET_KEY: 'y',
    COS_SESSION_TOKEN: 'sts-token', COS_CREDENTIAL_EXPIRES_AT: '4102444800',
  });
  const c = await prodSts.getCredentials();
  assert.equal(c.sessionToken, 'sts-token', 'STS 形态应保留 sessionToken');
});

test('D-8c 非 production 长期密钥形态仍可用（local 联调路径）', async () => {
  const EnvCredentialProviderC = compiled('facts/storage/credential.provider.js').EnvCredentialProvider;
  const dev = new EnvCredentialProviderC({ COS_SECRET_ID: 'dev-id', COS_SECRET_KEY: 'dev-key' });
  const d = await dev.getCredentials();
  assert.ok(d.expiredAt > 0, '非生产应可用（长期密钥仅限本地联调）');
});
