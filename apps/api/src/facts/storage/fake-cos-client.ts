/**
 * 内存伪 COS 客户端（任务 B8：无凭据、无网络可跑的驱动层测试）。
 *
 * ⚠️ 用途边界（硬性）：
 * - 仅供单元测试与本地离线联调；**禁止**在生产装配路径中构造本类；
 * - **不引用 `cos-nodejs-sdk-v5`，不发起任何网络请求**。
 *
 * 语义层级：本类模拟的是**原始**端口（与 `createRawCosClient()` 同层），
 * 因此抛出的是 SDK 形态的原始错误对象（`{ statusCode, code }`），
 * 由 `withCosResilience()` 完成重试判定与错误映射——
 * 这样测试才能真实覆盖"403/404 不重试、5xx/429 重试"等分支。
 *
 * 之所以放在 `src/` 而非 `test/`：本仓库单元测试通过 tsc 编译产物
 * （`compiled/apps/api/src/**`）加载被测模块，测试目录下的 .ts 不会进入编译产物。
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

export type FakeCosMethod = 'putObject' | 'getObject' | 'headObject' | 'deleteObject' | 'headBucket';

export interface FakeCosCall {
  method: FakeCosMethod;
  /** 完整对象键（含 prefix）；`headBucket` 无该字段 */
  key?: string;
  /** putObject 记录的对象参数快照，便于断言"未传 ACL"与 ContentType */
  params?: Record<string, unknown>;
}

export interface FakeCosObject {
  body: Buffer;
  contentType?: string;
  lastModified: string;
}

interface QueuedFailure {
  method: FakeCosMethod | 'any';
  error: unknown;
  remaining: number;
}

/** 构造一个 SDK 形态的错误对象。 */
export function makeCosError(statusCode: number, code: string, message = 'fake cos error'): Record<string, unknown> {
  return {
    statusCode,
    code,
    message,
    // 刻意混入敏感字段，用于验证 sanitizeCosError() 的白名单剥离
    headers: { Authorization: 'q-sign-algorithm=sha1&q-ak=AKIDFAKE&q-signature=deadbeef' },
    request: { headers: { Authorization: 'q-signature=deadbeef' } },
  };
}

export class FakeCosClient implements CosClientPort {
  /** 全量调用流水，供断言"探针只调 headBucket""head 命中时未调 putObject"。 */
  readonly calls: FakeCosCall[] = [];

  /** 内存对象表，键为完整对象键（含 prefix）。 */
  readonly objects = new Map<string, FakeCosObject>();

  private readonly failures: QueuedFailure[] = [];

  /**
   * 注入一次性/多次失败。
   * @param method 作用方法，`'any'` 表示所有方法
   * @param error 抛出的原始错误对象
   * @param times 生效次数，默认 1
   */
  queueFailure(method: FakeCosMethod | 'any', error: unknown, times = 1): void {
    this.failures.push({ method, error, remaining: Math.max(1, times) });
  }

  /** 统计某方法被调用的次数。 */
  countCalls(method: FakeCosMethod): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  /** 清空调用流水（保留对象与失败队列）。 */
  resetCalls(): void {
    this.calls.length = 0;
  }

  private record(method: FakeCosMethod, key?: string, params?: Record<string, unknown>): void {
    const call: FakeCosCall = { method };
    if (key !== undefined) call.key = key;
    if (params !== undefined) call.params = params;
    this.calls.push(call);
  }

  private maybeFail(method: FakeCosMethod): void {
    const index = this.failures.findIndex(
      (failure) => failure.remaining > 0 && (failure.method === 'any' || failure.method === method),
    );
    if (index < 0) return;
    const failure = this.failures[index];
    failure.remaining -= 1;
    if (failure.remaining <= 0) this.failures.splice(index, 1);
    throw failure.error;
  }

  async putObject(params: CosPutObjectParams): Promise<CosPutObjectResult> {
    this.record('putObject', params.Key, { ...params, Body: `<buffer:${params.Body.length}>` });
    this.maybeFail('putObject');
    const stored: FakeCosObject = {
      body: Buffer.from(params.Body),
      lastModified: new Date().toUTCString(),
    };
    if (params.ContentType !== undefined) stored.contentType = params.ContentType;
    this.objects.set(params.Key, stored);
    return { statusCode: 200, ETag: `"fake-etag-${params.Body.length}"` };
  }

  async getObject(params: { Key: string }): Promise<CosGetObjectResult> {
    this.record('getObject', params.Key);
    this.maybeFail('getObject');
    const found = this.objects.get(params.Key);
    if (!found) throw makeCosError(404, 'NoSuchKey');
    return { Body: Buffer.from(found.body), statusCode: 200 };
  }

  async headObject(params: { Key: string }): Promise<CosHeadObjectResult> {
    this.record('headObject', params.Key);
    this.maybeFail('headObject');
    const found = this.objects.get(params.Key);
    if (!found) throw makeCosError(404, 'NoSuchKey');
    const result: CosHeadObjectResult = {
      ContentLength: found.body.length,
      LastModified: found.lastModified,
      statusCode: 200,
    };
    if (found.contentType !== undefined) result.ContentType = found.contentType;
    return result;
  }

  async deleteObject(params: { Key: string }): Promise<CosDeleteObjectResult> {
    this.record('deleteObject', params.Key);
    this.maybeFail('deleteObject');
    this.objects.delete(params.Key);
    return { statusCode: 204 };
  }

  async headBucket(): Promise<CosHeadBucketResult> {
    this.record('headBucket');
    this.maybeFail('headBucket');
    return { statusCode: 200 };
  }
}
