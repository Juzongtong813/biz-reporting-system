/**
 * 腾讯云 COS 驱动（设计 §4）。
 *
 * ⚠️ 四条硬性禁令（实现不得偏离）：
 * 1. **不得生成任何 URL**：无 `getObjectUrl`、无预签名、不返回 `Location`（设计 §4.3）；
 * 2. **不得传 `ACL` 参数**：桶级私有 ACL 保持不变（设计 §4.3）；
 * 3. **不得把 prefix 写入对外 `storageKey`**：DB 只存逻辑键 `xx/<sha256>`（裁决 D-4）；
 * 4. **探针只允许 `headBucket`**：`assertReadable()` / `assertWritable()` 均禁止
 *    `putObject` / `deleteObject`，即"COS 桶中永远不会因健康检查而出现任何对象"（裁决 D-2）。
 *
 * 本文件**不引用** `cos-nodejs-sdk-v5`，只依赖 `CosClientPort`，
 * 因此可用伪客户端在无凭据、无网络条件下完整测试。
 */
import {
  FactSourceDriver,
  FactSourceDriverKind,
  FactSourceObjectMeta,
  PutFactSourceFileInput,
  StoredFactSourceFile,
} from './fact-source-driver.interface';
import { CosClientPort } from './cos-client.interface';
import { FactSourceStorageError, hasFactSourceStorageCode } from './fact-source-storage.error';
import { COS_READINESS_PROBE_TIMEOUT_MS } from './storage-driver.config';
import {
  DEFAULT_CONTENT_TYPE,
  assertLogicalStorageKey,
  buildLogicalKey,
  computeSha256,
  guessContentType,
  normalizeObjectPrefix,
  sha256FromLogicalKey,
} from './storage-key.util';

export interface CosFactSourceDriverOptions {
  /** 对象前缀，须已规范化（空串或以 '/' 结尾）；构造时会再次规范化以防漏配 */
  objectPrefix: string;
  /** readiness 探针超时；默认 `COS_READINESS_PROBE_TIMEOUT_MS`（2 秒） */
  probeTimeoutMs?: number;
}

function parseLastModified(value: string | undefined): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export class CosFactSourceDriver implements FactSourceDriver {
  readonly kind: FactSourceDriverKind = 'cos';

  private readonly objectPrefix: string;

  private readonly probeTimeoutMs: number;

  constructor(
    private readonly client: CosClientPort,
    options: CosFactSourceDriverOptions,
  ) {
    this.objectPrefix = normalizeObjectPrefix(options.objectPrefix);
    this.probeTimeoutMs = options.probeTimeoutMs ?? COS_READINESS_PROBE_TIMEOUT_MS;
  }

  /** 逻辑键 → 完整对象键（含 prefix）。仅在与 COS 交互时使用。 */
  toObjectKey(logicalKey: string): string {
    assertLogicalStorageKey(logicalKey);
    return `${this.objectPrefix}${logicalKey}`;
  }

  /** 完整对象键 → 逻辑键。供 D5 孤儿对象盘点等只读运维路径复用。 */
  toLogicalKey(objectKey: string): string {
    const withoutPrefix = this.objectPrefix !== '' && objectKey.startsWith(this.objectPrefix)
      ? objectKey.slice(this.objectPrefix.length)
      : objectKey;
    assertLogicalStorageKey(withoutPrefix);
    return withoutPrefix;
  }

  async put(input: PutFactSourceFileInput): Promise<StoredFactSourceFile> {
    const actualSha256 = computeSha256(input.buffer);
    if (actualSha256 !== input.expectedSha256) {
      throw new FactSourceStorageError('SOURCE_FILE_HASH_MISMATCH');
    }

    const storageKey = buildLogicalKey(actualSha256);
    const contentType = guessContentType(input.originalName);

    // 对象层幂等：head-then-put（设计 §5.1）
    const existing = await this.head(storageKey);
    if (existing) {
      if (existing.size !== input.buffer.length) {
        // 同 key 不同长度：内容寻址下必然是异常写入，按不可变违规处理
        throw new FactSourceStorageError('SOURCE_FILE_IMMUTABILITY_VIOLATION');
      }
      return {
        storageKey,
        size: existing.size,
        sha256: actualSha256,
        contentType: existing.contentType !== DEFAULT_CONTENT_TYPE ? existing.contentType : contentType,
        storedAt: existing.storedAt,
        deduplicated: true,
      };
    }

    // 设计 §4.3：**不传 ACL**
    await this.client.putObject({
      Key: this.toObjectKey(storageKey),
      Body: input.buffer,
      ContentType: contentType,
      ContentLength: input.buffer.length,
    });

    return {
      storageKey,
      size: input.buffer.length,
      sha256: actualSha256,
      contentType,
      storedAt: new Date(),
      deduplicated: false,
    };
  }

  async get(storageKey: string): Promise<Buffer> {
    const result = await this.client.getObject({ Key: this.toObjectKey(storageKey) });
    if (!Buffer.isBuffer(result.Body)) {
      throw new FactSourceStorageError('SOURCE_FILE_STORAGE_UNAVAILABLE', true, {
        operation: 'getObject',
        message: 'EMPTY_BODY',
      });
    }
    return result.Body;
  }

  async head(storageKey: string): Promise<FactSourceObjectMeta | null> {
    const objectKey = this.toObjectKey(storageKey);
    try {
      const result = await this.client.headObject({ Key: objectKey });
      return {
        storageKey,
        size: typeof result.ContentLength === 'number' ? result.ContentLength : 0,
        sha256: sha256FromLogicalKey(storageKey),
        contentType: result.ContentType ?? DEFAULT_CONTENT_TYPE,
        storedAt: parseLastModified(result.LastModified),
      };
    } catch (error: unknown) {
      if (hasFactSourceStorageCode(error, 'SOURCE_FILE_NOT_FOUND')) return null;
      throw error;
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    return (await this.head(storageKey)) !== null;
  }

  /** 幂等删除：对象不存在时静默成功。**仅供补偿路径与运维清理调用。** */
  async delete(storageKey: string): Promise<void> {
    try {
      await this.client.deleteObject({ Key: this.toObjectKey(storageKey) });
    } catch (error: unknown) {
      if (hasFactSourceStorageCode(error, 'SOURCE_FILE_NOT_FOUND')) return;
      throw error;
    }
  }

  /**
   * 裁决 D-2：只读探针。**只允许 `headBucket`**，2 秒超时，零对象产生。
   * `/ready` 链路经 `AppService.getReadiness()` → `assertReadable()` 到达这里。
   */
  async assertReadable(): Promise<void> {
    await this.client.headBucket({ timeoutMs: this.probeTimeoutMs });
  }

  /**
   * 裁决 D-2：启动期一次性探针。
   * **同样只调 `headBucket`**——禁止 `putObject` / `deleteObject`，
   * 凭据与权限的有效性由 headBucket 的 200/403 结果表达。
   */
  async assertWritable(): Promise<void> {
    await this.client.headBucket({ timeoutMs: this.probeTimeoutMs });
  }
}
