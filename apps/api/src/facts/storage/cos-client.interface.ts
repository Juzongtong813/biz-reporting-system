/**
 * COS 客户端最小端口（设计 §4.1）。
 *
 * 目的：让 `CosFactSourceDriver` 不直接依赖 `cos-nodejs-sdk-v5` 的类型与回调形态，
 * 从而在**无凭据、无网络**的环境下可用伪实现完成全部单元测试。
 *
 * ⚠️ 约束：
 * - 本文件**不得**导出任何 SDK 类型，也不得 import SDK；
 * - `Bucket` / `Region` 由工厂在构造客户端时固化，端口方法不再重复传递；
 * - 端口只暴露 5 个方法，**不含**任何 URL 生成能力
 *   （设计 §4.3：禁止 `getObjectUrl` / 预签名 URL）。
 *
 * 关于 `COS_CLIENT` 注入令牌：设计 §4.1 曾示意导出 `Symbol('COS_CLIENT')`；
 * 但任务 B7 硬性约束"不得新增除 `FactSourceFileStorageService` 之外的任何存储类
 * Nest provider / 注入令牌"（裁决 D-1 的门禁化）。**因此本文件不导出该符号**，
 * 客户端实例由 `fact-source-driver.factory.ts` 直接构造并传入 driver 构造函数。
 */

export interface CosPutObjectParams {
  /** 完整对象键（**含** prefix） */
  Key: string;
  Body: Buffer;
  ContentType?: string;
  ContentLength?: number;
}

export interface CosPutObjectResult {
  ETag?: string;
  statusCode?: number;
}

export interface CosGetObjectResult {
  Body: Buffer;
  statusCode?: number;
}

export interface CosHeadObjectResult {
  ContentLength?: number;
  ContentType?: string;
  LastModified?: string;
  ETag?: string;
  statusCode?: number;
}

export interface CosDeleteObjectResult {
  statusCode?: number;
}

export interface CosHeadBucketResult {
  statusCode?: number;
}

/** 单次调用的可选覆盖项（目前仅用于探针的更短超时）。 */
export interface CosCallOptions {
  /** 覆盖默认请求超时；探针使用 `COS_READINESS_PROBE_TIMEOUT_MS` */
  timeoutMs?: number;
}

export interface CosClientPort {
  putObject(params: CosPutObjectParams, options?: CosCallOptions): Promise<CosPutObjectResult>;

  getObject(params: { Key: string }, options?: CosCallOptions): Promise<CosGetObjectResult>;

  headObject(params: { Key: string }, options?: CosCallOptions): Promise<CosHeadObjectResult>;

  deleteObject(params: { Key: string }, options?: CosCallOptions): Promise<CosDeleteObjectResult>;

  /**
   * 裁决 D-2：健康探针专用。**只读、零对象产生。**
   * `/ready` 链路上只允许出现本方法。
   */
  headBucket(options?: CosCallOptions): Promise<CosHeadBucketResult>;
}
