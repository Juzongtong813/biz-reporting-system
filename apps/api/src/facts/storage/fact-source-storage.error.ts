/**
 * 源文件存储层统一错误模型（设计 §2.3）。
 *
 * 约束：
 * - 前 4 个错误码沿用既有字符串，既有测试与审计日志依赖，**不得更改**。
 * - 错误码不得直接作为 HTTP 响应体外泄（设计 §4.6 / §9.2），
 *   由上层（FactSourceFileStorageService / FactImportService）统一转换。
 * - `cause` 仅供服务端日志使用，构造前必须已脱敏（见 cos-error.mapper.ts）。
 */

export type FactSourceStorageErrorCode =
  /** 入参 sha256 与实际内容不符（既有码，保留） */
  | 'SOURCE_FILE_HASH_MISMATCH'
  /** 同 key 已存在但内容不同（既有码，保留） */
  | 'SOURCE_FILE_IMMUTABILITY_VIOLATION'
  /** key 不符合内容寻址格式（既有码，保留） */
  | 'SOURCE_FILE_STORAGE_KEY_INVALID'
  /** 本地路径越界（既有码，Local only） */
  | 'SOURCE_FILE_STORAGE_KEY_OUTSIDE_ROOT'
  /** 对象不存在 */
  | 'SOURCE_FILE_NOT_FOUND'
  /** 网络/超时/5xx，可重试 */
  | 'SOURCE_FILE_STORAGE_UNAVAILABLE'
  /** 凭据无效/权限不足，不可重试 */
  | 'SOURCE_FILE_STORAGE_FORBIDDEN'
  /** 配置缺失或非法 */
  | 'SOURCE_FILE_STORAGE_CONFIG_INVALID';

export class FactSourceStorageError extends Error {
  constructor(
    readonly code: FactSourceStorageErrorCode,
    /** 可重试性，供上层决定是否退避重试 */
    readonly retryable: boolean = false,
    /** 原始错误（已脱敏），仅内部日志使用，禁止外泄到 HTTP 响应 */
    readonly cause?: unknown,
    /**
     * 是否因探针/请求超时而失败。
     * readiness 分层需要区分 `timeout` 与 `dependency_error`（设计 §4.7），
     * 而 `AppService.toState()` 只识别自身抛出的超时标记；该字段供 C3 阶段做精确分类。
     */
    readonly timedOut: boolean = false,
  ) {
    super(code);
    this.name = 'FactSourceStorageError';
    Object.setPrototypeOf(this, FactSourceStorageError.prototype);
  }
}

/**
 * 配置类错误。
 *
 * 归一到 `SOURCE_FILE_STORAGE_CONFIG_INVALID` 错误码，同时用 `reason` 承载
 * 设计 §4.4 要求的精确启动失败标识（如 `FACT_SOURCE_STORAGE_DRIVER_REQUIRED`、
 * `COS_BUCKET_REQUIRED`）。
 *
 * **硬性**：`reason` 只允许是环境变量名 + 固定后缀，**禁止**拼接任何变量值，
 * 以免密钥经启动日志外泄（设计 §4.4 密钥纪律）。
 */
export class FactSourceStorageConfigError extends FactSourceStorageError {
  constructor(
    /** 精确失败原因标识，形如 `COS_SECRET_ID_REQUIRED`；不含任何变量值 */
    readonly reason: string,
    cause?: unknown,
  ) {
    super('SOURCE_FILE_STORAGE_CONFIG_INVALID', false, cause, false);
    this.name = 'FactSourceStorageConfigError';
    this.message = reason;
    Object.setPrototypeOf(this, FactSourceStorageConfigError.prototype);
  }
}

/**
 * 类型守卫：跨编译单元（compiled temp dir）下 instanceof 亦可能失效，故同时比对 name 前缀。
 * 覆盖 `FactSourceStorageError` 及其子类（如 `FactSourceStorageConfigError`）。
 */
export function isFactSourceStorageError(error: unknown): error is FactSourceStorageError {
  if (error instanceof FactSourceStorageError) return true;
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string'
    && name.startsWith('FactSourceStorage')
    && typeof (error as { code?: unknown }).code === 'string';
}

/** 便捷判定：错误是否为指定存储错误码。 */
export function hasFactSourceStorageCode(error: unknown, code: FactSourceStorageErrorCode): boolean {
  return isFactSourceStorageError(error) && error.code === code;
}
