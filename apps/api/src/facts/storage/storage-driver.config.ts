/**
 * 存储驱动选择与 COS 配置模型（设计 §4.4）。
 *
 * ⚠️ 硬性约束：
 * - **禁止任何隐式回退**：不得"COS 配置缺失就悄悄退回 local"。
 * - **纯函数**：env 由参数传入，不读全局 `process.env`，便于测试。
 * - **密钥纪律**：抛出的错误 message 只允许包含环境变量名，
 *   **禁止**拼接任何变量值（设计 §4.4）。
 *
 * 本文件不得引入 node:fs / cos-nodejs-sdk-v5 / @nestjs/*。
 */
import { FactSourceStorageConfigError } from './fact-source-storage.error';
import { normalizeObjectPrefix } from './storage-key.util';

export type FactSourceStorageDriverKind = 'local' | 'cos';

/** COS 对象前缀默认值（设计 §4.2）。 */
export const DEFAULT_COS_OBJECT_PREFIX = 'fact-source-files/';

/** 普通请求超时默认值（设计 §4.4）。 */
export const DEFAULT_COS_REQUEST_TIMEOUT_MS = 30_000;

/** 最大重试次数默认值（即最多 3 次尝试，设计 §4.4）。 */
export const DEFAULT_COS_MAX_RETRIES = 2;

/**
 * readiness 探针专用超时（设计 §4.7）。
 * 与 `app.service.ts` 的 `READINESS_TIMEOUT_MS = 2000` 对齐，探针必须更早收敛。
 */
export const COS_READINESS_PROBE_TIMEOUT_MS = 2_000;

/** 桶名必须形如 `<name>-<appid>`（设计 §4.4）。 */
export const COS_BUCKET_PATTERN = /^[a-z0-9-]+-\d{5,}$/;

/** 环境变量键名集中定义，避免散落拼写漂移。 */
export const COS_ENV_KEYS = Object.freeze({
  region: 'COS_REGION',
  bucket: 'COS_BUCKET',
  secretId: 'COS_SECRET_ID',
  secretKey: 'COS_SECRET_KEY',
  sessionToken: 'COS_SESSION_TOKEN',
  credentialExpiresAt: 'COS_CREDENTIAL_EXPIRES_AT',
  objectPrefix: 'COS_OBJECT_PREFIX',
  requestTimeoutMs: 'COS_REQUEST_TIMEOUT_MS',
  maxRetries: 'COS_MAX_RETRIES',
} as const);

/** 驱动选择开关的环境变量名。 */
export const FACT_SOURCE_STORAGE_DRIVER_ENV_KEY = 'FACT_SOURCE_STORAGE_DRIVER';

export interface CosStorageConfig {
  region: string;
  bucket: string;
  secretId: string;
  secretKey: string;
  /**
   * STS 临时凭据的 session token。
   * 设计 §11 R1 / PM Q-06 尚未在"长期密钥 vs 临时凭据"间二选一，
   * 因此两种形态均须兼容：本字段为可选，driver 不得硬编码任一种。
   */
  sessionToken?: string;
  /** 已规范化：空字符串或以 '/' 结尾 */
  objectPrefix: string;
  requestTimeoutMs: number;
  maxRetries: number;
}

function readTrimmed(env: NodeJS.ProcessEnv, key: string): string {
  const raw = env[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = readTrimmed(env, key);
  if (value === '') {
    throw new FactSourceStorageConfigError(`${key}_REQUIRED`);
  }
  return value;
}

function parseBoundedInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = readTrimmed(env, key);
  if (raw === '') return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new FactSourceStorageConfigError(`${key}_INVALID`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new FactSourceStorageConfigError(`${key}_INVALID`);
  }
  return parsed;
}

/**
 * 选择存储驱动（设计 §4.4，禁止猜测式回退）。
 *
 * - production：缺失 → `FACT_SOURCE_STORAGE_DRIVER_REQUIRED`；非法值 → `FACT_SOURCE_STORAGE_DRIVER_INVALID`
 * - 非 production：缺失 → 显式声明的默认值 `'local'`（非静默回退），允许显式指定 `'cos'` 联调
 */
export function resolveStorageDriver(env: NodeJS.ProcessEnv): FactSourceStorageDriverKind {
  const isProduction = String(env.NODE_ENV ?? '').toLowerCase() === 'production';
  const raw = readTrimmed(env, FACT_SOURCE_STORAGE_DRIVER_ENV_KEY).toLowerCase();

  if (raw === '') {
    if (isProduction) {
      throw new FactSourceStorageConfigError(`${FACT_SOURCE_STORAGE_DRIVER_ENV_KEY}_REQUIRED`);
    }
    return 'local';
  }
  if (raw === 'local' || raw === 'cos') return raw;
  throw new FactSourceStorageConfigError(`${FACT_SOURCE_STORAGE_DRIVER_ENV_KEY}_INVALID`);
}

/**
 * 解析 COS 配置（设计 §4.4）。
 * 仅在 `resolveStorageDriver(env) === 'cos'` 时调用；缺任一必填项即抛 `<NAME>_REQUIRED`。
 */
export function resolveCosConfig(env: NodeJS.ProcessEnv): CosStorageConfig {
  const region = requireEnv(env, COS_ENV_KEYS.region);
  const bucket = requireEnv(env, COS_ENV_KEYS.bucket);
  if (!COS_BUCKET_PATTERN.test(bucket)) {
    throw new FactSourceStorageConfigError(`${COS_ENV_KEYS.bucket}_INVALID`);
  }
  const secretId = requireEnv(env, COS_ENV_KEYS.secretId);
  const secretKey = requireEnv(env, COS_ENV_KEYS.secretKey);

  const sessionTokenRaw = readTrimmed(env, COS_ENV_KEYS.sessionToken);
  const rawPrefix = env[COS_ENV_KEYS.objectPrefix];
  const objectPrefix = normalizeObjectPrefix(
    typeof rawPrefix === 'string' ? rawPrefix : DEFAULT_COS_OBJECT_PREFIX,
  );

  const config: CosStorageConfig = {
    region,
    bucket,
    secretId,
    secretKey,
    objectPrefix,
    requestTimeoutMs: parseBoundedInt(
      env,
      COS_ENV_KEYS.requestTimeoutMs,
      DEFAULT_COS_REQUEST_TIMEOUT_MS,
      1_000,
      600_000,
    ),
    maxRetries: parseBoundedInt(env, COS_ENV_KEYS.maxRetries, DEFAULT_COS_MAX_RETRIES, 0, 10),
  };
  if (sessionTokenRaw !== '') config.sessionToken = sessionTokenRaw;
  return config;
}

/**
 * SecretId 日志脱敏：只保留前 4 位（设计 §4.4）。
 * ⚠️ `COS_SECRET_KEY` / `COS_SESSION_TOKEN` **一律不打印，连长度都不打印**，故本模块不提供其脱敏函数。
 */
export function maskSecretId(secretId: string): string {
  const value = String(secretId ?? '');
  if (value.length <= 4) return '****';
  return `${value.slice(0, 4)}****`;
}

/** 供日志/诊断使用的安全摘要：**不含**任何密钥字段。 */
export function describeCosConfig(config: CosStorageConfig): Record<string, string | number | boolean> {
  return {
    region: config.region,
    bucket: config.bucket,
    objectPrefix: config.objectPrefix,
    requestTimeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
    secretId: maskSecretId(config.secretId),
    temporaryCredential: typeof config.sessionToken === 'string',
  };
}
