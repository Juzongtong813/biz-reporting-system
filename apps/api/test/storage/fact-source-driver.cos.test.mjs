/**
 * B8 — CosFactSourceDriver 驱动层单元测试（任务 B8，伪 CosClientPort，无凭据、无网络）。
 *
 * 覆盖（对应 B8 验收判据 + 设计 §4.2/§4.3/§4.7/§5.1 裁决 D-2/D-4）：
 * - prefix 映射：返回的 storageKey 不含 prefix；记录到的 putObject.Key 含 prefix
 * - head-then-put 幂等：head 命中且 size 一致 → deduplicated=true、putObject 未被调用
 * - head 命中但 size 不一致 → SOURCE_FILE_IMMUTABILITY_VIOLATION（C-3.2）
 * - put 不传 ACL
 * - get 404 → SOURCE_FILE_NOT_FOUND；delete 404 静默
 * - assertReadable / assertWritable 仅调 headBucket，不调 putObject/deleteObject（裁决 D-2）
 * - 韧性层：5xx 重试、403/404 不重试、超时映射（经 withCosResilience 包装）
 * - FakeCredentialProvider 刷新行为（提前刷新窗口、单飞、临时凭据形态）
 *
 * 执行：node apps/api/test/storage/fact-source-driver.cos.test.mjs（node:test，零新增依赖）
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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-b8-cos-'));
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

let CosFactSourceDriver;
let FakeCosClient;
let makeCosError;
let withCosResilience;
let FakeCredentialProvider;
let isFactSourceStorageError;

const PREFIX = 'fact-source-files/';

before(() => {
  compileCurrentSrc();
  CosFactSourceDriver = compiled('facts/storage/cos-fact-source-driver.js').CosFactSourceDriver;
  FakeCosClient = compiled('facts/storage/fake-cos-client.js').FakeCosClient;
  makeCosError = compiled('facts/storage/fake-cos-client.js').makeCosError;
  withCosResilience = compiled('facts/storage/cos-resilience.js').withCosResilience;
  FakeCredentialProvider = compiled('facts/storage/fake-credential.provider.js').FakeCredentialProvider;
  isFactSourceStorageError = compiled('facts/storage/fact-source-storage.error.js').isFactSourceStorageError;
});

after(() => {
  if (tempRoot && fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

/**
 * 构造 driver：默认把（原始端口语义的）FakeCosClient 包一层韧性装饰器，
 * 使 404/403/5xx 错误按设计 §4.6 映射为 FactSourceStorageError。
 * 这与生产装配（createCosClient = withCosResilience(createRawCosClient)）同构。
 */
function makeDriver(client, options = {}) {
  const resilient = withCosResilience(client, { requestTimeoutMs: 500, maxRetries: 0, sleep: async () => {} });
  return new CosFactSourceDriver(resilient, { objectPrefix: PREFIX, ...options });
}

test('prefix 映射：返回 storageKey 不含 prefix，putObject.Key 含 prefix（D-4）', async () => {
  const client = new FakeCosClient();
  const driver = makeDriver(client);
  const payload = Buffer.from('B8 cos prefix mapping', 'utf8');
  const sha = makeHash(payload);
  const logicalKey = `${sha.slice(0, 2)}/${sha}`;

  const stored = await driver.put({ buffer: payload, originalName: 'a.xlsx', expectedSha256: sha });
  assert.equal(stored.storageKey, logicalKey, '返回 storageKey 必须为逻辑键（不含 prefix）');
  assert.equal(stored.storageKey.includes('fact-source-files'), false, 'storageKey 不得含 prefix');
  assert.equal(stored.deduplicated, false);

  const putCalls = client.calls.filter((call) => call.method === 'putObject');
  assert.equal(putCalls.length, 1);
  assert.equal(putCalls[0].key, `${PREFIX}${logicalKey}`, 'putObject.Key 应含 prefix');
  assert.match(putCalls[0].key, /^fact-source-files\/[a-f0-9]{2}\/[a-f0-9]{64}$/);
});

test('幂等 head-then-put：head 命中且 size 一致 → deduplicated=true、putObject 未被调用（C-3.1）', async () => {
  const client = new FakeCosClient();
  const driver = makeDriver(client);
  const payload = Buffer.from('B8 cos idempotent', 'utf8');
  const sha = makeHash(payload);

  const first = await driver.put({ buffer: payload, originalName: 'b.xlsx', expectedSha256: sha });
  assert.equal(first.deduplicated, false);

  const second = await driver.put({ buffer: payload, originalName: 'b.xlsx', expectedSha256: sha });
  assert.equal(second.deduplicated, true, 'head 命中应 deduplicated=true');
  assert.equal(second.storageKey, first.storageKey);

  const putCallsAfterSecond = client.calls.filter((call) => call.method === 'putObject');
  assert.equal(putCallsAfterSecond.length, 1, '第二次 put 不应触发 putObject（head-then-put）');
});

test('不可变：head 命中但 size 不一致 → SOURCE_FILE_IMMUTABILITY_VIOLATION（C-3.2）', async () => {
  const client = new FakeCosClient();
  const driver = makeDriver(client);
  const payload = Buffer.from('immutable-original', 'utf8');
  const sha = makeHash(payload);
  const logicalKey = `${sha.slice(0, 2)}/${sha}`;

  // 预置"同 key 但不同长度"的对象（内容寻址下 sha 相同却长度不同 = 异常写入/外部损坏）
  client.objects.set(`${PREFIX}${logicalKey}`, {
    body: Buffer.from('WRONG-LENGTH-BODY'),
    lastModified: new Date().toUTCString(),
  });

  await assert.rejects(
    driver.put({ buffer: payload, originalName: 'c.xlsx', expectedSha256: sha }),
    (error) => isFactSourceStorageError(error) && error.code === 'SOURCE_FILE_IMMUTABILITY_VIOLATION',
    'size 不一致应抛 SOURCE_FILE_IMMUTABILITY_VIOLATION',
  );
  assert.equal(client.countCalls('putObject'), 0, 'size 不一致时不得执行 putObject');
});

test('put 不传 ACL（设计 §4.3）', async () => {
  const client = new FakeCosClient();
  const driver = makeDriver(client);
  const payload = Buffer.from('B8 no acl', 'utf8');
  const sha = makeHash(payload);
  await driver.put({ buffer: payload, originalName: 'd.xlsx', expectedSha256: sha });

  const putCall = client.calls.find((call) => call.method === 'putObject');
  assert.ok(putCall, '应有 putObject 调用');
  assert.equal('ACL' in (putCall.params ?? {}), false, 'putObject 参数不得含 ACL');
  assert.equal(putCall.params?.ContentType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx 应推断 ContentType');
});

test('get 404 → SOURCE_FILE_NOT_FOUND；delete 404 静默成功', async () => {
  const client = new FakeCosClient();
  const driver = makeDriver(client);
  const missingKey = `${'ab'.padEnd(2, '0')}/${'a'.repeat(64)}`;

  await assert.rejects(
    driver.get(missingKey),
    (error) => isFactSourceStorageError(error) && error.code === 'SOURCE_FILE_NOT_FOUND' && error.retryable === false,
    'get 404 应抛 SOURCE_FILE_NOT_FOUND（不可重试）',
  );

  // delete 404 静默成功
  await driver.delete(missingKey);
  assert.equal(client.calls.some((call) => call.method === 'deleteObject'), true);
});

test('裁决 D-2：assertReadable/assertWritable 仅调 headBucket，不调 putObject/deleteObject', async () => {
  const client = new FakeCosClient();
  const driver = makeDriver(client);

  await driver.assertReadable();
  await driver.assertWritable();

  const methods = new Set(client.calls.map((call) => call.method));
  assert.deepEqual([...methods], ['headBucket'], '探针路径只允许 headBucket');
  assert.equal(client.calls.filter((call) => call.method === 'headBucket').length, 2);
  assert.equal(client.calls.some((call) => call.method === 'putObject' || call.method === 'deleteObject'), false);
});

test('韧性层：5xx 重试到 maxRetries；403/404 不重试；超时映射', async () => {
  // 5xx 重试：失败 2 次（第 1、2 次抛 500）后第 3 次成功
  const client = new FakeCosClient();
  client.queueFailure('headObject', makeCosError(500, 'InternalError'), 2);
  const resilient = withCosResilience(client, { requestTimeoutMs: 500, maxRetries: 2, sleep: async () => {} });
  const driver = new CosFactSourceDriver(resilient, { objectPrefix: PREFIX });

  const payload = Buffer.from('B8 retry 5xx', 'utf8');
  const sha = makeHash(payload);
  await driver.put({ buffer: payload, originalName: 'e.xlsx', expectedSha256: sha });
  assert.equal(client.countCalls('headObject'), 3, '5xx 应重试 2 次，共 3 次尝试');

  // 403 不重试
  const client403 = new FakeCosClient();
  client403.queueFailure('headBucket', makeCosError(403, 'AccessDenied'), 1);
  const resilient403 = withCosResilience(client403, { requestTimeoutMs: 500, maxRetries: 3, sleep: async () => {} });
  const driver403 = new CosFactSourceDriver(resilient403, { objectPrefix: PREFIX });
  await assert.rejects(
    driver403.assertReadable(),
    (error) => isFactSourceStorageError(error) && error.code === 'SOURCE_FILE_STORAGE_FORBIDDEN' && error.retryable === false,
  );
  assert.equal(client403.countCalls('headBucket'), 1, '403 不应重试');

  // 404 不重试（head 语义：对象不存在返回 null，不抛错）
  const client404 = new FakeCosClient();
  client404.queueFailure('headObject', makeCosError(404, 'NoSuchKey'), 1);
  const resilient404 = withCosResilience(client404, { requestTimeoutMs: 500, maxRetries: 3, sleep: async () => {} });
  const driver404 = new CosFactSourceDriver(resilient404, { objectPrefix: PREFIX });
  const meta404 = await driver404.head(`${'ab'.padEnd(2, '0')}/${'b'.repeat(64)}`);
  assert.equal(meta404, null, 'head 404 应返回 null');
  assert.equal(client404.countCalls('headObject'), 1, '404 不应重试');

  // 超时 → SOURCE_FILE_STORAGE_UNAVAILABLE（retryable=true、timedOut=true）
  const hangClient = new FakeCosClient();
  hangClient.headBucket = () => new Promise(() => {});
  const resilientHang = withCosResilience(hangClient, { requestTimeoutMs: 30, maxRetries: 0, sleep: async () => {} });
  const driverHang = new CosFactSourceDriver(resilientHang, { objectPrefix: PREFIX, probeTimeoutMs: 30 });
  await assert.rejects(
    driverHang.assertReadable(),
    (error) => isFactSourceStorageError(error)
      && error.code === 'SOURCE_FILE_STORAGE_UNAVAILABLE'
      && error.retryable === true
      && error.timedOut === true,
    '超时应映射 SOURCE_FILE_STORAGE_UNAVAILABLE + timedOut',
  );
});

test('错误脱敏：SDK 错误中的 Authorization/签名字段不会进入 cause 外泄', async () => {
  const client = new FakeCosClient();
  const driver = makeDriver(client);
  const missingKey = `${'cd'.padEnd(2, '0')}/${'c'.repeat(64)}`;

  try {
    await driver.get(missingKey);
    assert.fail('应抛错');
  } catch (error) {
    const causeText = JSON.stringify(error.cause ?? {});
    assert.equal(causeText.includes('q-signature'), false, 'cause 不得含 q-signature');
    assert.equal(causeText.includes('Authorization'), false, 'cause 不得含 Authorization');
    assert.equal(causeText.includes('AKIDFAKE'), false, 'cause 不得含凭据字面量');
  }
});

test('FakeCredentialProvider：长期形态无刷新、临时形态按窗口提前刷新、单飞', async () => {
  // 长期形态：expiredAt 远期 → fetch 只发生一次
  const permanent = new FakeCredentialProvider();
  await permanent.getCredentials();
  await permanent.getCredentials();
  assert.equal(permanent.fetchCount, 1, '长期凭据不应重复 fetch');

  // 临时形态：ttl 短 + skew 大 → 第二次调用时已进入提前刷新窗口 → 触发第二次 fetch
  const temporary = new FakeCredentialProvider({ temporary: true, ttlSeconds: 60, refreshSkewSeconds: 300 });
  const first = await temporary.getCredentials();
  assert.ok(first.sessionToken, '临时凭据应含 sessionToken');
  assert.equal(temporary.fetchCount, 1);
  const second = await temporary.getCredentials();
  assert.equal(temporary.fetchCount, 2, '过期前 skew 窗口内应触发刷新');
  assert.notEqual(second.secretId, first.secretId, '刷新后凭据应更新');

  // 单飞：并发调用只触发一次 fetch
  const singleFlight = new FakeCredentialProvider({ temporary: true, ttlSeconds: 60, refreshSkewSeconds: 300 });
  await Promise.all([singleFlight.getCredentials(), singleFlight.getCredentials(), singleFlight.getCredentials()]);
  assert.equal(singleFlight.fetchCount, 1, '并发 getCredentials 应只触发一次 fetch（single-flight）');

  // 失败注入：fetch 抛错时错误上抛且不缓存
  const failing = new FakeCredentialProvider({ failWith: new Error('sts down') });
  await assert.rejects(failing.getCredentials(), /sts down/);
});
