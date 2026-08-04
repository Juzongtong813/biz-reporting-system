/**
 * COS 客户端韧性装饰器：超时 + 重试 + 错误映射（设计 §4.5 / §4.6）。
 *
 * 之所以独立成文件而非内嵌在 `cos-client.factory.ts`：
 * 本模块**不依赖 SDK**，因此单元测试可以直接把伪 `CosClientPort` 包进来，
 * 在无凭据、无网络的条件下验证重试次数、退避与 403/404 不重试等行为（任务 B8）。
 *
 * 语义约定：
 * - 入参 `inner` 抛出的是**原始**错误（SDK / 网络 / 超时标记）；
 * - 本装饰器返回的端口抛出的一律是已脱敏的 `FactSourceStorageError`。
 */
import {
  CosCallOptions,
  CosClientPort,
  CosDeleteObjectResult,
  CosGetObjectResult,
  CosHeadBucketResult,
  CosHeadObjectResult,
  CosPutObjectParams,
  CosPutObjectResult,
} from './cos-client.interface';
import { CosRequestTimeoutError, isRetryableCosError, mapCosError } from './cos-error.mapper';

export interface CosResilienceOptions {
  /** 默认请求超时（毫秒） */
  requestTimeoutMs: number;
  /** 最大重试次数（不含首次尝试） */
  maxRetries: number;
  /** 退避基数（毫秒），默认 200 */
  backoffBaseMs?: number;
  /** 随机源，测试可注入确定性实现；默认 `Math.random` */
  random?: () => number;
  /** 睡眠实现，测试可注入即时返回；默认基于 setTimeout */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_BACKOFF_BASE_MS = 200;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // 退避等待不应阻止进程退出
    if (typeof timer.unref === 'function') timer.unref();
  });
}

/** 指数退避 + 全抖动：`random() * base * 2^attempt`（设计 §4.5）。 */
export function computeBackoffMs(attempt: number, baseMs: number, random: () => number): number {
  const ceiling = baseMs * 2 ** attempt;
  return Math.floor(random() * ceiling);
}

/** 为 Promise 施加超时上限；超时抛 `CosRequestTimeoutError`。 */
export function withTimeout<T>(
  operation: string,
  timeoutMs: number,
  task: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new CosRequestTimeoutError(timeoutMs, operation));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    task().then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * 执行一次带超时与重试的调用。
 * 仅对幂等操作使用（本存储的 put 因内容寻址天然幂等，可安全重试）。
 */
export async function executeWithResilience<T>(
  operation: string,
  task: () => Promise<T>,
  options: CosResilienceOptions,
  overrideTimeoutMs?: number,
): Promise<T> {
  const timeoutMs = overrideTimeoutMs ?? options.requestTimeoutMs;
  const maxRetries = Math.max(0, options.maxRetries);
  const baseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await withTimeout(operation, timeoutMs, task);
    } catch (error: unknown) {
      lastError = error;
      const canRetry = attempt < maxRetries && isRetryableCosError(error);
      if (!canRetry) break;
      await sleep(computeBackoffMs(attempt, baseMs, random));
    }
  }
  throw mapCosError(lastError, operation);
}

/**
 * 把一个"抛原始错误"的客户端包装为"抛 `FactSourceStorageError`"的客户端，
 * 并统一施加超时与重试。
 */
export function withCosResilience(inner: CosClientPort, options: CosResilienceOptions): CosClientPort {
  return {
    putObject(params: CosPutObjectParams, callOptions?: CosCallOptions): Promise<CosPutObjectResult> {
      return executeWithResilience(
        'putObject',
        () => inner.putObject(params),
        options,
        callOptions?.timeoutMs,
      );
    },

    getObject(params: { Key: string }, callOptions?: CosCallOptions): Promise<CosGetObjectResult> {
      return executeWithResilience(
        'getObject',
        () => inner.getObject(params),
        options,
        callOptions?.timeoutMs,
      );
    },

    headObject(params: { Key: string }, callOptions?: CosCallOptions): Promise<CosHeadObjectResult> {
      return executeWithResilience(
        'headObject',
        () => inner.headObject(params),
        options,
        callOptions?.timeoutMs,
      );
    },

    deleteObject(params: { Key: string }, callOptions?: CosCallOptions): Promise<CosDeleteObjectResult> {
      return executeWithResilience(
        'deleteObject',
        () => inner.deleteObject(params),
        options,
        callOptions?.timeoutMs,
      );
    },

    headBucket(callOptions?: CosCallOptions): Promise<CosHeadBucketResult> {
      return executeWithResilience(
        'headBucket',
        () => inner.headBucket(),
        options,
        callOptions?.timeoutMs,
      );
    },
  };
}
