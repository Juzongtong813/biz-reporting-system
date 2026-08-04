/**
 * COS 凭据提供者抽象（主理人 B 阶段指令：`CredentialProvider` 抽象 + STS 临时凭据刷新机制）。
 *
 * 设计动机（对齐设计 §4.4 密钥纪律 / §11 R1 待决项）：
 * - 长期密钥（SecretId/SecretKey）与 STS 临时凭据（额外带 sessionToken + 过期时间）
 *   两种形态尚未由上游二选一，driver 与客户端**不得硬编码任一种**；
 * - 通过本抽象把"凭据从哪来、何时刷新"与"怎么调 COS"彻底解耦。
 *
 * ⚠️ 硬性纪律：
 * - 凭据只经环境变量或外部 provider 注入，**禁止**写入代码、配置文件、日志、Git；
 * - 任何实现的 `toString()` / 日志输出**不得**包含 secretKey / sessionToken，
 *   连长度都不得打印（设计 §4.4）。
 *
 * 本文件为纯逻辑模块：不得引入 node:fs / cos-nodejs-sdk-v5 / @nestjs/*。
 */
import { FactSourceStorageConfigError } from './fact-source-storage.error';
import { COS_ENV_KEYS } from './storage-driver.config';

/** 一组可直接用于 COS 签名的凭据。 */
export interface CosCredentials {
  secretId: string;
  secretKey: string;
  /** STS 临时凭据的 session token；长期密钥形态下为 undefined */
  sessionToken?: string;
  /**
   * 过期时间（**epoch 秒**，与 COS SDK `getAuthorization` 回调的 `ExpiredTime` 同单位）。
   * 长期密钥使用 `PERMANENT_CREDENTIAL_EXPIRES_AT`。
   */
  expiredAt: number;
}

/** 凭据提供者契约。**不是 Nest provider，不导出注入令牌**（裁决 D-1）。 */
export interface CredentialProvider {
  /** 实现标识，仅用于日志（禁止含密钥） */
  readonly name: string;
  /** 取得当前有效凭据；实现负责必要的刷新 */
  getCredentials(): Promise<CosCredentials>;
  /** 主动失效缓存（如收到 403 后强制下一次重新获取） */
  invalidate(): void;
}

/** 长期密钥的"过期时间"占位：2100-01-01T00:00:00Z 的 epoch 秒。 */
export const PERMANENT_CREDENTIAL_EXPIRES_AT = 4_102_444_800;

/** 提前刷新窗口（秒）：距过期不足该时长即视为需要刷新。 */
export const DEFAULT_CREDENTIAL_REFRESH_SKEW_SECONDS = 300;

/** 当前 epoch 秒。 */
export function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** 判定凭据是否已过期（含提前刷新窗口）。 */
export function isCredentialExpired(
  credentials: CosCredentials,
  skewSeconds: number = DEFAULT_CREDENTIAL_REFRESH_SKEW_SECONDS,
  now: number = nowInSeconds(),
): boolean {
  if (!Number.isFinite(credentials.expiredAt)) return true;
  return credentials.expiredAt - skewSeconds <= now;
}

/**
 * 校验凭据结构完整性。
 * ⚠️ 抛出的错误 message 只含字段名标识，**不含**任何凭据值。
 */
export function assertCredentials(credentials: CosCredentials): void {
  if (typeof credentials?.secretId !== 'string' || credentials.secretId.trim() === '') {
    throw new FactSourceStorageConfigError('COS_CREDENTIAL_SECRET_ID_REQUIRED');
  }
  if (typeof credentials.secretKey !== 'string' || credentials.secretKey.trim() === '') {
    throw new FactSourceStorageConfigError('COS_CREDENTIAL_SECRET_KEY_REQUIRED');
  }
  if (credentials.sessionToken !== undefined
    && (typeof credentials.sessionToken !== 'string' || credentials.sessionToken.trim() === '')) {
    throw new FactSourceStorageConfigError('COS_CREDENTIAL_SESSION_TOKEN_INVALID');
  }
  if (!Number.isFinite(credentials.expiredAt) || credentials.expiredAt <= 0) {
    throw new FactSourceStorageConfigError('COS_CREDENTIAL_EXPIRES_AT_INVALID');
  }
}

/**
 * 静态凭据提供者：一次注入、不刷新。
 * 适用于长期 SecretId/SecretKey，或调用方自行保证有效期的临时凭据。
 */
export class StaticCredentialProvider implements CredentialProvider {
  readonly name = 'static';

  private readonly credentials: CosCredentials;

  constructor(credentials: CosCredentials) {
    assertCredentials(credentials);
    this.credentials = Object.freeze({ ...credentials });
  }

  async getCredentials(): Promise<CosCredentials> {
    return this.credentials;
  }

  /** 静态凭据无缓存可失效，保持幂等空实现以满足契约。 */
  invalidate(): void {
    // 无状态实现：无缓存需要清理。
  }
}

/**
 * 带缓存与提前刷新的凭据提供者基类（STS 临时凭据刷新机制）。
 *
 * 能力：
 * - 缓存有效凭据，过期前 `refreshSkewSeconds` 秒即触发刷新；
 * - **单飞（single-flight）**：并发调用只触发一次 `fetchCredentials()`；
 * - 刷新失败时不污染既有缓存的失效状态（异常直接上抛，由调用方决定重试）。
 *
 * 子类只需实现 `fetchCredentials()`（例如对接 STS / 元数据服务 / 外部 sidecar）。
 * ⚠️ B 阶段不提供任何发起真实网络请求的子类；`FakeCredentialProvider` 为测试实现。
 */
export abstract class RefreshingCredentialProvider implements CredentialProvider {
  abstract readonly name: string;

  private cached: CosCredentials | null = null;

  private inFlight: Promise<CosCredentials> | null = null;

  constructor(protected readonly refreshSkewSeconds: number = DEFAULT_CREDENTIAL_REFRESH_SKEW_SECONDS) {}

  async getCredentials(): Promise<CosCredentials> {
    const cached = this.cached;
    if (cached && !isCredentialExpired(cached, this.refreshSkewSeconds)) return cached;
    if (this.inFlight) return this.inFlight;

    const task = this.refresh();
    this.inFlight = task;
    try {
      return await task;
    } finally {
      this.inFlight = null;
    }
  }

  invalidate(): void {
    this.cached = null;
  }

  private async refresh(): Promise<CosCredentials> {
    const fresh = await this.fetchCredentials();
    assertCredentials(fresh);
    this.cached = Object.freeze({ ...fresh });
    return this.cached;
  }

  /** 获取一组全新凭据。实现方负责所有 IO；**禁止**在日志中打印凭据值。 */
  protected abstract fetchCredentials(): Promise<CosCredentials>;
}

/**
 * 环境变量凭据提供者。
 *
 * 每次调用都重新读取 env，因此支持"外部进程热轮换环境变量"的临时凭据模式；
 * `COS_CREDENTIAL_EXPIRES_AT`（epoch 秒，可选）用于声明临时凭据过期时刻，
 * 缺省视为长期密钥（`PERMANENT_CREDENTIAL_EXPIRES_AT`）。
 */
export class EnvCredentialProvider implements CredentialProvider {
  readonly name = 'env';

  constructor(private readonly env: NodeJS.ProcessEnv) {}

  async getCredentials(): Promise<CosCredentials> {
    const secretId = String(this.env[COS_ENV_KEYS.secretId] ?? '').trim();
    const secretKey = String(this.env[COS_ENV_KEYS.secretKey] ?? '').trim();
    const sessionToken = String(this.env[COS_ENV_KEYS.sessionToken] ?? '').trim();
    const expiresRaw = String(this.env[COS_ENV_KEYS.credentialExpiresAt] ?? '').trim();

    // R1 已裁定（Codex PG-20260805-COS-D-CORRECTION）：生产采用 STS 临时凭据刷新，
    // 长期 SecretId/SecretKey 不得作为默认生产方案。
    // 生产环境（NODE_ENV=production）下若无 STS 形态（sessionToken + 过期时刻）→ 明确失败，
    // 禁止静默退回永久环境变量密钥（BLOCKED_STS_ISSUER_UNDEFINED）。
    const isProduction = String(this.env.NODE_ENV ?? '').toLowerCase() === 'production';
    if (isProduction && (sessionToken === '' || expiresRaw === '')) {
      throw new FactSourceStorageConfigError('BLOCKED_STS_ISSUER_UNDEFINED');
    }

    let expiredAt = PERMANENT_CREDENTIAL_EXPIRES_AT;
    if (expiresRaw !== '') {
      if (!/^\d+$/.test(expiresRaw)) {
        throw new FactSourceStorageConfigError(`${COS_ENV_KEYS.credentialExpiresAt}_INVALID`);
      }
      expiredAt = Number.parseInt(expiresRaw, 10);
    }

    const credentials: CosCredentials = { secretId, secretKey, expiredAt };
    if (sessionToken !== '') credentials.sessionToken = sessionToken;
    assertCredentials(credentials);
    return credentials;
  }

  /** env 每次实时读取，无缓存需要清理。 */
  invalidate(): void {
    // 无状态实现。
  }
}

/**
 * 由已解析配置构造凭据提供者。
 * 配置来自 `resolveCosConfig()`，其本身已完成必填校验。
 */
export function createStaticCredentialProvider(config: {
  secretId: string;
  secretKey: string;
  sessionToken?: string;
  expiredAt?: number;
}): CredentialProvider {
  const credentials: CosCredentials = {
    secretId: config.secretId,
    secretKey: config.secretKey,
    expiredAt: config.expiredAt ?? PERMANENT_CREDENTIAL_EXPIRES_AT,
  };
  if (config.sessionToken !== undefined) credentials.sessionToken = config.sessionToken;
  return new StaticCredentialProvider(credentials);
}
