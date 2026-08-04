/**
 * COS SDK 适配工厂（设计 §4.1 / §4.5）。
 *
 * ⚠️ 硬性约束（设计 §2.4 / 任务 B4）：
 * **本文件是全仓库唯一允许引用 `cos-nodejs-sdk-v5` 的文件。**
 *
 * 三条实现纪律：
 * 1. **惰性加载**：模块 import 时不加载 SDK；只有真正构造 COS 客户端
 *    （即 `FACT_SOURCE_STORAGE_DRIVER=cos`）才 `require` SDK。
 *    这保证 driver=local 的单元测试与 CI **不触碰** SDK，也不产生任何网络能力。
 * 2. **凭据经 `CredentialProvider` 动态注入**：走 SDK 的 `getAuthorization` 回调形态，
 *    天然支持 STS 临时凭据的到期刷新；构造函数**不传** SecretId/SecretKey，
 *    避免长期密钥被 SDK 长期驻留。
 * 3. **零 URL 生成**：不调用 `getObjectUrl`，不生成预签名 URL（设计 §4.3）。
 *
 * 构造客户端**不发起任何网络请求**——`new COS(...)` 仅初始化本地对象。
 */
import {
  CosClientPort,
  CosDeleteObjectResult,
  CosGetObjectResult,
  CosHeadBucketResult,
  CosHeadObjectResult,
  CosPutObjectParams,
  CosPutObjectResult,
} from './cos-client.interface';
import { CosResilienceOptions, withCosResilience } from './cos-resilience';
import { CredentialProvider, nowInSeconds } from './credential.provider';
import { FactSourceStorageConfigError } from './fact-source-storage.error';
import { CosStorageConfig } from './storage-driver.config';

/**
 * SDK 模块 id 以常量形式保存，配合 `require(...)` 实现运行时惰性解析。
 * 这样 TypeScript 不会在编译期把 SDK 打进任何模块的静态依赖图。
 */
const COS_SDK_MODULE_ID = 'cos-nodejs-sdk-v5';

/** SDK 回调的凭据形态（对应 SDK 类型 `COS.Credentials` 的必要子集）。 */
interface RawCosCredentialsParams {
  TmpSecretId: string;
  TmpSecretKey: string;
  SecurityToken?: string;
  StartTime: number;
  ExpiredTime: number;
}

type RawCosCallback<T> = (error: unknown, data: T) => void;

/**
 * SDK 客户端的最小结构类型。
 * 刻意**不**从 SDK d.ts 导入类型：既避免把 SDK 类型泄漏到本层之外，
 * 也让 `grep -rn "cos-nodejs-sdk-v5" apps/api/src` 恰好只命中本文件的一行。
 */
interface RawCosClient {
  putObject(params: Record<string, unknown>, callback: RawCosCallback<Record<string, unknown>>): void;
  getObject(params: Record<string, unknown>, callback: RawCosCallback<Record<string, unknown>>): void;
  headObject(params: Record<string, unknown>, callback: RawCosCallback<Record<string, unknown>>): void;
  deleteObject(params: Record<string, unknown>, callback: RawCosCallback<Record<string, unknown>>): void;
  headBucket(params: Record<string, unknown>, callback: RawCosCallback<Record<string, unknown>>): void;
}

interface RawCosOptions {
  Timeout?: number;
  ForceSignHost?: boolean;
  getAuthorization: (
    options: Record<string, unknown>,
    callback: (params: RawCosCredentialsParams) => void,
  ) => void;
}

type RawCosConstructor = new (options: RawCosOptions) => RawCosClient;

let cachedConstructor: RawCosConstructor | null = null;

/**
 * 惰性加载 SDK 构造器。
 * 仅在 driver=cos 装配路径上被调用；失败抛配置错误而非裸异常。
 */
export function loadCosSdkConstructor(): RawCosConstructor {
  if (cachedConstructor) return cachedConstructor;
  let loaded: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    loaded = require(COS_SDK_MODULE_ID);
  } catch (error: unknown) {
    throw new FactSourceStorageConfigError('COS_SDK_MODULE_NOT_INSTALLED', error);
  }
  const candidate = (loaded && typeof loaded === 'object' && 'default' in (loaded as object))
    ? (loaded as { default: unknown }).default
    : loaded;
  if (typeof candidate !== 'function') {
    throw new FactSourceStorageConfigError('COS_SDK_MODULE_INVALID');
  }
  cachedConstructor = candidate as RawCosConstructor;
  return cachedConstructor;
}

function promisify<T extends Record<string, unknown>>(
  invoke: (callback: RawCosCallback<T>) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    invoke((error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data ?? ({} as T));
    });
  });
}

function readOptionalNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  return undefined;
}

function readOptionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function readHeader(data: Record<string, unknown>, headerName: string): string | undefined {
  const headers = data.headers;
  if (!headers || typeof headers !== 'object') return undefined;
  const value = (headers as Record<string, unknown>)[headerName];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * 原始（未加韧性层）的 SDK 端口实现：只做参数装配与回调 → Promise 转换，
 * 抛出的是 SDK 原始错误，由 `withCosResilience()` 统一映射脱敏。
 */
class SdkBackedCosClient implements CosClientPort {
  constructor(
    private readonly raw: RawCosClient,
    private readonly bucket: string,
    private readonly region: string,
  ) {}

  private base(): Record<string, unknown> {
    return { Bucket: this.bucket, Region: this.region };
  }

  async putObject(params: CosPutObjectParams): Promise<CosPutObjectResult> {
    // 设计 §4.3：**不得**传 ACL 参数，桶级私有 ACL 保持不变
    const request: Record<string, unknown> = {
      ...this.base(),
      Key: params.Key,
      Body: params.Body,
    };
    if (params.ContentType !== undefined) request.ContentType = params.ContentType;
    if (params.ContentLength !== undefined) request.ContentLength = params.ContentLength;

    const data = await promisify<Record<string, unknown>>(
      (callback) => this.raw.putObject(request, callback),
    );
    const result: CosPutObjectResult = {};
    const etag = readOptionalString(data, 'ETag');
    if (etag !== undefined) result.ETag = etag;
    const statusCode = readOptionalNumber(data, 'statusCode');
    if (statusCode !== undefined) result.statusCode = statusCode;
    return result;
  }

  async getObject(params: { Key: string }): Promise<CosGetObjectResult> {
    const data = await promisify<Record<string, unknown>>(
      (callback) => this.raw.getObject({ ...this.base(), Key: params.Key }, callback),
    );
    const body = data.Body;
    const result: CosGetObjectResult = {
      Body: Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : ''),
    };
    const statusCode = readOptionalNumber(data, 'statusCode');
    if (statusCode !== undefined) result.statusCode = statusCode;
    return result;
  }

  async headObject(params: { Key: string }): Promise<CosHeadObjectResult> {
    const data = await promisify<Record<string, unknown>>(
      (callback) => this.raw.headObject({ ...this.base(), Key: params.Key }, callback),
    );
    const result: CosHeadObjectResult = {};
    const contentLengthHeader = readHeader(data, 'content-length');
    const contentLength = readOptionalNumber(data, 'ContentLength')
      ?? (contentLengthHeader !== undefined ? Number.parseInt(contentLengthHeader, 10) : undefined);
    if (contentLength !== undefined && Number.isFinite(contentLength)) {
      result.ContentLength = contentLength;
    }
    const contentType = readOptionalString(data, 'ContentType') ?? readHeader(data, 'content-type');
    if (contentType !== undefined) result.ContentType = contentType;
    const lastModified = readOptionalString(data, 'LastModified') ?? readHeader(data, 'last-modified');
    if (lastModified !== undefined) result.LastModified = lastModified;
    const etag = readOptionalString(data, 'ETag') ?? readHeader(data, 'etag');
    if (etag !== undefined) result.ETag = etag;
    const statusCode = readOptionalNumber(data, 'statusCode');
    if (statusCode !== undefined) result.statusCode = statusCode;
    return result;
  }

  async deleteObject(params: { Key: string }): Promise<CosDeleteObjectResult> {
    const data = await promisify<Record<string, unknown>>(
      (callback) => this.raw.deleteObject({ ...this.base(), Key: params.Key }, callback),
    );
    const result: CosDeleteObjectResult = {};
    const statusCode = readOptionalNumber(data, 'statusCode');
    if (statusCode !== undefined) result.statusCode = statusCode;
    return result;
  }

  async headBucket(): Promise<CosHeadBucketResult> {
    const data = await promisify<Record<string, unknown>>(
      (callback) => this.raw.headBucket(this.base(), callback),
    );
    const result: CosHeadBucketResult = {};
    const statusCode = readOptionalNumber(data, 'statusCode');
    if (statusCode !== undefined) result.statusCode = statusCode;
    return result;
  }
}

/**
 * 构造未加韧性层的 SDK 客户端端口。
 * 单独导出便于测试装配组合；生产路径请使用 `createCosClient()`。
 */
export function createRawCosClient(
  config: CosStorageConfig,
  credentialProvider: CredentialProvider,
): CosClientPort {
  const Constructor = loadCosSdkConstructor();
  const raw = new Constructor({
    Timeout: config.requestTimeoutMs,
    ForceSignHost: true,
    getAuthorization: (_options, callback) => {
      credentialProvider.getCredentials().then(
        (credentials) => {
          const params: RawCosCredentialsParams = {
            TmpSecretId: credentials.secretId,
            TmpSecretKey: credentials.secretKey,
            StartTime: nowInSeconds(),
            ExpiredTime: credentials.expiredAt,
          };
          if (credentials.sessionToken !== undefined) {
            params.SecurityToken = credentials.sessionToken;
          }
          callback(params);
        },
        () => {
          // 凭据获取失败：回传空凭据让 SDK 以签名失败收敛为 403 → SOURCE_FILE_STORAGE_FORBIDDEN。
          // ⚠️ 禁止在此处打印任何凭据相关信息（设计 §4.4）。
          credentialProvider.invalidate();
          callback({
            TmpSecretId: '',
            TmpSecretKey: '',
            StartTime: nowInSeconds(),
            ExpiredTime: nowInSeconds() + 1,
          });
        },
      );
    },
  });
  return new SdkBackedCosClient(raw, config.bucket, config.region);
}

/** 由已解析配置构造韧性选项。 */
export function buildResilienceOptions(config: CosStorageConfig): CosResilienceOptions {
  return {
    requestTimeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
  };
}

/**
 * 生产装配入口：SDK 客户端 + 超时/重试/错误映射。
 * 调用本函数会惰性加载 SDK，但**不会发起任何网络请求**。
 */
export function createCosClient(
  config: CosStorageConfig,
  credentialProvider: CredentialProvider,
): CosClientPort {
  return withCosResilience(createRawCosClient(config, credentialProvider), buildResilienceOptions(config));
}
