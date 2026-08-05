/**
 * 测试专用凭据提供者（主理人 B 阶段指令：`FakeCredentialProvider`，dummy 凭据、无真实网络调用）。
 *
 * ⚠️ 用途边界（硬性）：
 * - 仅供单元测试与本地离线联调；**禁止**在生产装配路径（`fact-source-driver.factory.ts`
 *   的 driver=cos 分支）中构造本类；
 * - 返回的均为**显式占位串**（`fake-...`），不可能与真实腾讯云凭据混淆；
 * - `fetchCredentials()` 为纯内存实现，**不产生任何网络请求**。
 *
 * 之所以放在 `src/` 而非 `test/`：本仓库单元测试通过 tsc 编译产物
 * （`API_TEST_COMPILED_ROOT` → `compiled/apps/api/src/**`）加载被测模块，
 * 测试目录下的 .ts 不会进入编译产物。
 */
import {
  CosCredentials,
  DEFAULT_CREDENTIAL_REFRESH_SKEW_SECONDS,
  PERMANENT_CREDENTIAL_EXPIRES_AT,
  RefreshingCredentialProvider,
  nowInSeconds,
} from './credential.provider';

/** 占位 SecretId 前缀，便于门禁/审计一眼识别为非真实凭据。 */
export const FAKE_CREDENTIAL_SECRET_ID = 'fake-secret-id-0000';

/** 占位 SecretKey。 */
export const FAKE_CREDENTIAL_SECRET_KEY = 'fake-secret-key-0000';

/** 占位 SessionToken。 */
export const FAKE_CREDENTIAL_SESSION_TOKEN = 'fake-session-token-0000';

export interface FakeCredentialProviderOptions {
  /** 是否模拟 STS 临时凭据形态（附带 sessionToken 与有限有效期），默认 false */
  temporary?: boolean;
  /** 临时凭据的有效期（秒），默认 3600；仅 `temporary=true` 时生效 */
  ttlSeconds?: number;
  /** 提前刷新窗口（秒），默认沿用 `DEFAULT_CREDENTIAL_REFRESH_SKEW_SECONDS` */
  refreshSkewSeconds?: number;
  /** 每次 `fetchCredentials()` 抛出的错误；用于测试凭据获取失败路径 */
  failWith?: unknown;
}

/**
 * 伪凭据提供者：继承 `RefreshingCredentialProvider`，
 * 因此同时验证了缓存 / 提前刷新 / 单飞逻辑本身。
 */
export class FakeCredentialProvider extends RefreshingCredentialProvider {
  readonly name = 'fake';

  /** `fetchCredentials()` 实际被调用的次数，供测试断言刷新行为。 */
  fetchCount = 0;

  private readonly temporary: boolean;

  private readonly ttlSeconds: number;

  private readonly failWith: unknown;

  constructor(options: FakeCredentialProviderOptions = {}) {
    super(options.refreshSkewSeconds ?? DEFAULT_CREDENTIAL_REFRESH_SKEW_SECONDS);
    this.temporary = options.temporary === true;
    this.ttlSeconds = options.ttlSeconds ?? 3600;
    this.failWith = options.failWith;
  }

  protected async fetchCredentials(): Promise<CosCredentials> {
    this.fetchCount += 1;
    if (this.failWith !== undefined) throw this.failWith;

    if (!this.temporary) {
      return {
        secretId: FAKE_CREDENTIAL_SECRET_ID,
        secretKey: FAKE_CREDENTIAL_SECRET_KEY,
        // 长期密钥形态：统一使用 PERMANENT_CREDENTIAL_EXPIRES_AT 语义（不伪装真实 STS 生命周期）
        expiredAt: PERMANENT_CREDENTIAL_EXPIRES_AT,
      };
    }

    return {
      secretId: `${FAKE_CREDENTIAL_SECRET_ID}-${this.fetchCount}`,
      secretKey: `${FAKE_CREDENTIAL_SECRET_KEY}-${this.fetchCount}`,
      sessionToken: `${FAKE_CREDENTIAL_SESSION_TOKEN}-${this.fetchCount}`,
      expiredAt: nowInSeconds() + this.ttlSeconds,
    };
  }
}
