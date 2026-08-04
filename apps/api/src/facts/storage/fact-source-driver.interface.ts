/**
 * 源文件存储驱动契约（设计 §2.2）。
 *
 * ⚠️ 三条硬性约束（裁决 D-1）：
 * 1. 本文件是**内部实现契约**，不是 Nest provider；
 * 2. **不得**导出任何注入令牌（`FACT_SOURCE_STORAGE = Symbol(...)` 已在 v2 撤销）；
 * 3. 唯一 Nest 注入点与唯一类名仍为 `FactSourceFileStorageService`。
 *
 * 本文件为纯类型模块：不得引入 node:fs / cos-nodejs-sdk-v5 / @nestjs/*。
 */

/** 驱动实现类别标识，仅供日志与装配自检使用，不参与业务分支。 */
export type FactSourceDriverKind = 'local' | 'cos';

/** 存储对象的元数据（不含正文）。 */
export interface FactSourceObjectMeta {
  /** 内容寻址**逻辑键**，格式恒为 `${sha256.slice(0,2)}/${sha256}`；**不含 COS prefix**（裁决 D-4） */
  storageKey: string;
  /** 字节数 */
  size: number;
  /** 内容 SHA-256（小写 hex，64 位） */
  sha256: string;
  /**
   * MIME 类型；未知时为 'application/octet-stream'。
   * ⚠️ 裁决 D-3：本轮**仅作为返回值与 COS 对象的 Content-Type header 使用，不入库**。
   * 009 迁移无该列，入库需 010 迁移（独立待授权任务）。
   */
  contentType: string;
  /** 对象在存储侧的落盘/落桶时间 */
  storedAt: Date;
}

/**
 * `put()` 的返回值。
 * 字段与既有 `StoredFactSourceFile`（storageKey / size / storedAt）保持向后兼容——
 * 既有消费方 `fact-import.service.ts` 依赖这三个字段，新增字段均为**追加**。
 */
export interface StoredFactSourceFile extends FactSourceObjectMeta {
  /** true = 对象此前已存在且内容一致（幂等命中，未重复写入） */
  deduplicated: boolean;
}

export interface PutFactSourceFileInput {
  buffer: Buffer;
  /** 原始文件名，仅用于 contentType 推断与日志；**不参与 key 生成** */
  originalName: string;
  /** 调用方预先计算的 sha256，实现**必须**重新计算并比对 */
  expectedSha256: string;
}

/**
 * 内部 driver 契约。**不是 Nest provider，不导出注入令牌。**
 * Local 与 COS 两种实现必须语义等价（契约一致性测试见 B8）。
 */
export interface FactSourceDriver {
  /** 实现类别标识（'local' | 'cos'），供装配自检与日志使用。 */
  readonly kind: FactSourceDriverKind;

  /** 幂等写入。返回 `deduplicated=true` 表示命中已有对象，未重复写入。 */
  put(input: PutFactSourceFileInput): Promise<StoredFactSourceFile>;

  /** 读取完整正文。对象不存在时抛 `FactSourceStorageError('SOURCE_FILE_NOT_FOUND')`。 */
  get(storageKey: string): Promise<Buffer>;

  /** 读取元数据，不下载正文。对象不存在返回 `null`。 */
  head(storageKey: string): Promise<FactSourceObjectMeta | null>;

  /** 存在性判定。等价 `head() !== null`，但实现可走更廉价路径。 */
  exists(storageKey: string): Promise<boolean>;

  /**
   * 删除对象。**仅供补偿路径与运维清理使用，业务正常流程禁止调用。**
   * 对象不存在时必须静默成功（幂等删除）。
   */
  delete(storageKey: string): Promise<void>;

  /**
   * 只读健康探针（readiness 用）。失败抛错。
   * ⚠️ 裁决 D-2：COS driver 实现**必须为纯只读**（`headBucket`），
   *    禁止 PutObject / DeleteObject（设计 §4.7）。
   */
  assertReadable(): Promise<void>;

  /**
   * 启动时一次性探针。失败抛错。
   * ⚠️ 裁决 D-2：COS driver 实现**同样禁止真实写入**；
   *    仅 Local driver 保留"创建+删除探针文件"的写探针语义。
   */
  assertWritable(): Promise<void>;
}
