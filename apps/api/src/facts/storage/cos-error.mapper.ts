/**
 * COS 错误脱敏与映射（设计 §4.5 / §4.6，任务清单 §2.2 日志脱敏规则）。
 *
 * ⚠️ 硬性纪律：
 * - SDK 原始错误体可能携带签名串（`headers.Authorization`、`request.headers`、
 *   URL 上的 `q-signature`），**向上抛出前必须剥离**；
 * - 本模块只保留白名单字段（statusCode / code / message / requestId），
 *   并对 message 再做一次签名字面量擦除；
 * - 错误码**不得**直接作为 HTTP 响应体返回终端用户（设计 §4.6）。
 */
import { FactSourceStorageError } from './fact-source-storage.error';

/** 内部超时标记：由 `withTimeout()` 抛出，供重试判定与 readiness 分层识别。 */
export class CosRequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number, readonly operation: string) {
    super('COS_REQUEST_TIMEOUT');
    this.name = 'CosRequestTimeoutError';
    Object.setPrototypeOf(this, CosRequestTimeoutError.prototype);
  }
}

/** 跨编译单元安全的超时判定。 */
export function isCosRequestTimeoutError(error: unknown): error is CosRequestTimeoutError {
  if (error instanceof CosRequestTimeoutError) return true;
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { name?: unknown }).name === 'CosRequestTimeoutError',
  );
}

/** 403 家族：凭据无效 / 权限不足，**不可重试**。 */
const FORBIDDEN_CODES: ReadonlySet<string> = new Set([
  'AccessDenied',
  'SignatureDoesNotMatch',
  'InvalidAccessKeyId',
  'InvalidSecretId',
  'RequestTimeTooSkewed',
  'ExpiredToken',
  'InvalidToken',
  'Forbidden',
]);

/** 404 家族：对象/桶不存在，**不可重试**。 */
const NOT_FOUND_CODES: ReadonlySet<string> = new Set([
  'NoSuchKey',
  'NoSuchBucket',
  'NoSuchObject',
  'NotFound',
]);

/** 可重试的网络层 errno。 */
const RETRYABLE_NETWORK_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

export interface SanitizedCosError {
  statusCode?: number;
  code?: string;
  message?: string;
  requestId?: string;
}

/** 擦除可能出现在文本中的签名/凭据字面量。 */
function scrubSignatureText(value: string): string {
  return value
    .replace(/q-signature=[^&\s"']+/gi, 'q-signature=****')
    .replace(/q-sign-algorithm=[^&\s"']+/gi, 'q-sign-algorithm=****')
    .replace(/q-ak=[^&\s"']+/gi, 'q-ak=****')
    .replace(/q-key-time=[^&\s"']+/gi, 'q-key-time=****')
    .replace(/x-cos-security-token[:=][^&\s"']+/gi, 'x-cos-security-token=****')
    .replace(/Authorization[:=]\s*[^\s,"']+/gi, 'Authorization=****');
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  return undefined;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * 白名单式脱敏：只提取 statusCode / code / message / requestId。
 * **不会**透传 headers、request、config 等可能含签名的字段。
 */
export function sanitizeCosError(raw: unknown): SanitizedCosError {
  if (isCosRequestTimeoutError(raw)) {
    return { code: 'COS_REQUEST_TIMEOUT', message: `timeout after ${raw.timeoutMs}ms` };
  }
  if (!raw || typeof raw !== 'object') {
    return typeof raw === 'string' ? { message: scrubSignatureText(raw) } : {};
  }

  const source = raw as Record<string, unknown>;
  const nested = (source.error && typeof source.error === 'object')
    ? source.error as Record<string, unknown>
    : undefined;

  const sanitized: SanitizedCosError = {};
  const statusCode = readNumber(source, 'statusCode') ?? readNumber(source, 'status');
  if (statusCode !== undefined) sanitized.statusCode = statusCode;

  const code = readString(source, 'code')
    ?? readString(source, 'Code')
    ?? (nested ? readString(nested, 'Code') ?? readString(nested, 'code') : undefined);
  if (code !== undefined) sanitized.code = code;

  const message = readString(source, 'message')
    ?? readString(source, 'Message')
    ?? (nested ? readString(nested, 'Message') ?? readString(nested, 'message') : undefined);
  if (message !== undefined) sanitized.message = scrubSignatureText(message);

  const requestId = readString(source, 'RequestId')
    ?? readString(source, 'requestId')
    ?? (nested ? readString(nested, 'RequestId') : undefined);
  if (requestId !== undefined) sanitized.requestId = requestId;

  return sanitized;
}

/**
 * 重试判定（设计 §4.5）。
 * 可重试：网络错误 / 超时 / 5xx / 429；**403、404 一律不重试**。
 */
export function isRetryableCosError(raw: unknown): boolean {
  if (isCosRequestTimeoutError(raw)) return true;

  const sanitized = sanitizeCosError(raw);
  const { statusCode, code } = sanitized;

  if (code !== undefined) {
    if (FORBIDDEN_CODES.has(code) || NOT_FOUND_CODES.has(code)) return false;
    if (RETRYABLE_NETWORK_CODES.has(code)) return true;
  }
  if (statusCode === undefined) {
    // 无状态码且无已知 errno：视为不可重试，避免对确定性失败做无谓退避
    return false;
  }
  if (statusCode === 429) return true;
  if (statusCode >= 500) return true;
  return false;
}

/**
 * 映射为统一存储错误（设计 §4.6）。
 * `cause` 已脱敏，仅供服务端日志使用。
 */
export function mapCosError(raw: unknown, operation: string): FactSourceStorageError {
  const sanitized = sanitizeCosError(raw);
  const cause = { operation, ...sanitized };

  if (isCosRequestTimeoutError(raw)) {
    return new FactSourceStorageError('SOURCE_FILE_STORAGE_UNAVAILABLE', true, cause, true);
  }

  const { statusCode, code } = sanitized;

  if (statusCode === 404 || (code !== undefined && NOT_FOUND_CODES.has(code))) {
    return new FactSourceStorageError('SOURCE_FILE_NOT_FOUND', false, cause);
  }
  if (statusCode === 403 || (code !== undefined && FORBIDDEN_CODES.has(code))) {
    return new FactSourceStorageError('SOURCE_FILE_STORAGE_FORBIDDEN', false, cause);
  }
  if (isRetryableCosError(raw)) {
    return new FactSourceStorageError('SOURCE_FILE_STORAGE_UNAVAILABLE', true, cause);
  }
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
    // 其余 4xx（如 400 InvalidArgument）：确定性失败，不重试
    return new FactSourceStorageError('SOURCE_FILE_STORAGE_FORBIDDEN', false, cause);
  }
  return new FactSourceStorageError('SOURCE_FILE_STORAGE_UNAVAILABLE', true, cause);
}
