/**
 * B8 — storage-driver.config 纯函数测试（任务 B8 / B6 验收五条 + 设计 §4.4）。
 *
 * 覆盖：
 * - production + 无 driver → FACT_SOURCE_STORAGE_DRIVER_REQUIRED
 * - production + driver=cos + 缺任一 COS 变量 → 对应 COS_*_REQUIRED
 * - 抛出的错误 message 不含任何 secret 值
 * - 非 production + 无 driver → 'local'
 * - 带 COS_SESSION_TOKEN → 能解析为 cos 配置（临时凭据形态）
 * - bucket 正则校验、prefix 规范化、超时/重试边界
 * - describeCosConfig / maskSecretId 脱敏
 *
 * 执行：node apps/api/test/storage/storage-driver.config.test.mjs（node:test，零新增依赖）
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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-b8-config-'));
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

let config;
let errorModule;

before(() => {
  compileCurrentSrc();
  config = compiled('facts/storage/storage-driver.config.js');
  errorModule = compiled('facts/storage/fact-source-storage.error.js');
});

after(() => {
  if (tempRoot && fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

function isConfigError(error) {
  return errorModule.isFactSourceStorageError(error)
    && error.code === 'SOURCE_FILE_STORAGE_CONFIG_INVALID';
}

function fullCosEnv(overrides = {}) {
  return {
    COS_REGION: 'ap-shanghai',
    COS_BUCKET: 'biz-reporting-1250000000',
    COS_SECRET_ID: 'AKIDFAKE0000000000000000',
    COS_SECRET_KEY: 'fake-secret-key-0000',
    ...overrides,
  };
}

test('production + 无 driver → FACT_SOURCE_STORAGE_DRIVER_REQUIRED', () => {
  assert.throws(
    () => config.resolveStorageDriver({ NODE_ENV: 'production' }),
    (error) => isConfigError(error) && error.reason === 'FACT_SOURCE_STORAGE_DRIVER_REQUIRED',
  );
});

test('production + driver=cos + 缺任一 COS 变量 → 对应 COS_*_REQUIRED', () => {
  const base = { NODE_ENV: 'production', FACT_SOURCE_STORAGE_DRIVER: 'cos' };
  assert.throws(
    () => config.resolveCosConfig({ ...base }),
    (error) => isConfigError(error) && error.reason === 'COS_REGION_REQUIRED',
  );
  assert.throws(
    () => config.resolveCosConfig({ ...base, ...fullCosEnv({ COS_REGION: '' }) }),
    (error) => isConfigError(error) && error.reason === 'COS_REGION_REQUIRED',
  );
  assert.throws(
    () => config.resolveCosConfig({ ...base, ...fullCosEnv({ COS_BUCKET: '' }) }),
    (error) => isConfigError(error) && error.reason === 'COS_BUCKET_REQUIRED',
  );
  assert.throws(
    () => config.resolveCosConfig({ ...base, ...fullCosEnv({ COS_SECRET_ID: '' }) }),
    (error) => isConfigError(error) && error.reason === 'COS_SECRET_ID_REQUIRED',
  );
  assert.throws(
    () => config.resolveCosConfig({ ...base, ...fullCosEnv({ COS_SECRET_KEY: '' }) }),
    (error) => isConfigError(error) && error.reason === 'COS_SECRET_KEY_REQUIRED',
  );
});

test('错误 message 不含任何 secret 值（密钥纪律）', () => {
  const secretId = 'AKIDREAL1234567890abcdef';
  const secretKey = 'super-secret-key-value';
  const sessionToken = 'super-session-token-value';

  const env = {
    NODE_ENV: 'production',
    FACT_SOURCE_STORAGE_DRIVER: 'cos',
    COS_REGION: 'ap-shanghai',
    COS_BUCKET: 'bad-bucket-name', // 触发 COS_BUCKET_INVALID
    COS_SECRET_ID: secretId,
    COS_SECRET_KEY: secretKey,
    COS_SESSION_TOKEN: sessionToken,
  };

  try {
    config.resolveCosConfig(env);
    assert.fail('应抛错');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fullText = `${message} ${JSON.stringify(error.reason ?? '')}`;
    assert.equal(fullText.includes(secretId), false, 'message 不得含 COS_SECRET_ID 值');
    assert.equal(fullText.includes(secretKey), false, 'message 不得含 COS_SECRET_KEY 值');
    assert.equal(fullText.includes(sessionToken), false, 'message 不得含 COS_SESSION_TOKEN 值');
  }

  // production + driver 缺失错误同理
  try {
    config.resolveStorageDriver({ NODE_ENV: 'production', COS_SECRET_ID: secretId, COS_SECRET_KEY: secretKey });
    assert.fail('应抛错');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.equal(message.includes(secretId), false);
    assert.equal(message.includes(secretKey), false);
  }
});

test('非 production + 无 driver → local（显式默认，非静默回退）', () => {
  assert.equal(config.resolveStorageDriver({}), 'local');
  assert.equal(config.resolveStorageDriver({ NODE_ENV: 'test' }), 'local');
  assert.equal(config.resolveStorageDriver({ NODE_ENV: 'development' }), 'local');
});

test('driver 非法值 → FACT_SOURCE_STORAGE_DRIVER_INVALID', () => {
  assert.throws(
    () => config.resolveStorageDriver({ NODE_ENV: 'production', FACT_SOURCE_STORAGE_DRIVER: 's3' }),
    (error) => isConfigError(error) && error.reason === 'FACT_SOURCE_STORAGE_DRIVER_INVALID',
  );
  assert.throws(
    () => config.resolveStorageDriver({ FACT_SOURCE_STORAGE_DRIVER: 'cosfs' }),
    (error) => isConfigError(error) && error.reason === 'FACT_SOURCE_STORAGE_DRIVER_INVALID',
  );
});

test('driver=cos 显式指定在非 production 也可解析', () => {
  assert.equal(config.resolveStorageDriver({ FACT_SOURCE_STORAGE_DRIVER: 'cos' }), 'cos');
});

test('bucket 正则：必须形如 <name>-<appid>', () => {
  const base = fullCosEnv({ COS_BUCKET: 'no-appid' });
  assert.throws(
    () => config.resolveCosConfig({ ...base }),
    (error) => isConfigError(error) && error.reason === 'COS_BUCKET_INVALID',
  );
  const ok = config.resolveCosConfig(fullCosEnv());
  assert.equal(ok.bucket, 'biz-reporting-1250000000');
});

test('带 COS_SESSION_TOKEN → 解析为临时凭据形态（R1 兼容）', () => {
  const cfg = config.resolveCosConfig(fullCosEnv({
    COS_SESSION_TOKEN: 'fake-sts-token',
  }));
  assert.equal(cfg.sessionToken, 'fake-sts-token');
  assert.equal(cfg.region, 'ap-shanghai');
  assert.equal(cfg.objectPrefix, 'fact-source-files/');
});

test('COS_OBJECT_PREFIX 规范化：默认/自定义/空串/非法', () => {
  assert.equal(config.resolveCosConfig(fullCosEnv()).objectPrefix, 'fact-source-files/');
  assert.equal(config.resolveCosConfig(fullCosEnv({ COS_OBJECT_PREFIX: 'my-prefix' })).objectPrefix, 'my-prefix/');
  assert.equal(config.resolveCosConfig(fullCosEnv({ COS_OBJECT_PREFIX: 'my-prefix/' })).objectPrefix, 'my-prefix/');
  assert.equal(config.resolveCosConfig(fullCosEnv({ COS_OBJECT_PREFIX: '' })).objectPrefix, '');
  // 以 '/' 开头非法
  assert.throws(
    () => config.resolveCosConfig(fullCosEnv({ COS_OBJECT_PREFIX: '/bad' })),
    (error) => isConfigError(error) && error.code === 'SOURCE_FILE_STORAGE_CONFIG_INVALID',
  );
});

test('COS_REQUEST_TIMEOUT_MS / COS_MAX_RETRIES 边界与默认', () => {
  const defaults = config.resolveCosConfig(fullCosEnv());
  assert.equal(defaults.requestTimeoutMs, 30000);
  assert.equal(defaults.maxRetries, 2);

  const custom = config.resolveCosConfig(fullCosEnv({ COS_REQUEST_TIMEOUT_MS: '5000', COS_MAX_RETRIES: '4' }));
  assert.equal(custom.requestTimeoutMs, 5000);
  assert.equal(custom.maxRetries, 4);

  assert.throws(
    () => config.resolveCosConfig(fullCosEnv({ COS_REQUEST_TIMEOUT_MS: 'not-a-number' })),
    (error) => isConfigError(error) && error.reason === 'COS_REQUEST_TIMEOUT_MS_INVALID',
  );
  assert.throws(
    () => config.resolveCosConfig(fullCosEnv({ COS_MAX_RETRIES: '99' })),
    (error) => isConfigError(error) && error.reason === 'COS_MAX_RETRIES_INVALID',
  );
});

test('describeCosConfig / maskSecretId 脱敏：不含 secretKey/sessionToken', () => {
  const cfg = config.resolveCosConfig(fullCosEnv({ COS_SESSION_TOKEN: 'fake-sts-token' }));
  const desc = config.describeCosConfig(cfg);
  assert.equal(desc.secretId, 'AKID****', 'secretId 只保留前 4 位 + ****');
  assert.equal('secretKey' in desc, false, 'describeCosConfig 不得含 secretKey');
  assert.equal('sessionToken' in desc, false, 'describeCosConfig 不得含 sessionToken');
  assert.equal(desc.temporaryCredential, true);

  assert.equal(config.maskSecretId('AKID1234567890'), 'AKID****');
  assert.equal(config.maskSecretId('abc'), '****', '长度 ≤4 的 secretId 整体打码');
  assert.equal(config.maskSecretId(''), '****', '空 secretId 整体打码');
});
