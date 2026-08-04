/**
 * 本地文件系统驱动（设计 §3）。
 *
 * 逻辑来源：`apps/api/src/facts/fact-source-file-storage.service.ts` 的
 * `store()/read()/exists()/resolveKey()/assertReadable()/assertWritable()`（**原样内移，不重写**）。
 *
 * 保持不变的语义（设计 §3.2）：
 * - key 生成规则 `${sha256.slice(0,2)}/${sha256}`
 * - `wx` 原子创建 + EEXIST 回读比对
 * - 路径越界校验与正则校验
 * - `SOURCE_FILE_IMMUTABILITY_VIOLATION` 判定条件
 * - `assertWritable()` 保留"创建 + 删除探针文件"的写探针语义（仅 Local）
 *
 * ⚠️ 依赖方向（设计 §2.4）：本文件是 `apps/api/src/**` 中**唯一**允许
 * 为源文件正文读写而引入 `node:fs` 的驱动实现。
 */
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  FactSourceDriver,
  FactSourceDriverKind,
  FactSourceObjectMeta,
  PutFactSourceFileInput,
  StoredFactSourceFile,
} from './fact-source-driver.interface';
import { FactSourceStorageError } from './fact-source-storage.error';
import {
  DEFAULT_CONTENT_TYPE,
  assertLogicalStorageKey,
  buildLogicalKey,
  computeSha256,
  guessContentType,
  sha256FromLogicalKey,
} from './storage-key.util';

/** 取出 Node 系统错误的 errno code（如 'ENOENT' / 'EEXIST'）。 */
function systemErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export class LocalFactSourceDriver implements FactSourceDriver {
  readonly kind: FactSourceDriverKind = 'local';

  private readonly root: string;

  /**
   * @param root 存储根目录；构造时归一化为绝对路径，
   *             与既有 `resolveFactSourceStorageRoot()` 的返回值语义一致。
   */
  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** 存储根目录（只读，供装配自检与日志使用）。 */
  get rootDirectory(): string {
    return this.root;
  }

  async put(input: PutFactSourceFileInput): Promise<StoredFactSourceFile> {
    const actualSha256 = computeSha256(input.buffer);
    if (actualSha256 !== input.expectedSha256) {
      throw new FactSourceStorageError('SOURCE_FILE_HASH_MISMATCH');
    }

    const storageKey = buildLogicalKey(actualSha256);
    const absolutePath = this.resolvePath(storageKey);
    await mkdir(path.dirname(absolutePath), { recursive: true });

    let deduplicated = false;
    try {
      const handle = await open(absolutePath, 'wx');
      try {
        await handle.writeFile(input.buffer);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error: unknown) {
      if (systemErrorCode(error) !== 'EEXIST') throw error;
      // 幂等命中：回读比对，内容一致才认可（不可变存储语义）
      const existing = await readFile(absolutePath);
      if (computeSha256(existing) !== actualSha256) {
        throw new FactSourceStorageError('SOURCE_FILE_IMMUTABILITY_VIOLATION');
      }
      deduplicated = true;
    }

    return {
      storageKey,
      size: input.buffer.length,
      sha256: actualSha256,
      contentType: guessContentType(input.originalName),
      // 与既有 store() 行为完全一致：返回本次操作时刻，而非 inode mtime
      storedAt: new Date(),
      deduplicated,
    };
  }

  async get(storageKey: string): Promise<Buffer> {
    const absolutePath = this.resolvePath(storageKey);
    try {
      return await readFile(absolutePath);
    } catch (error: unknown) {
      if (systemErrorCode(error) === 'ENOENT') {
        throw new FactSourceStorageError('SOURCE_FILE_NOT_FOUND', false, error);
      }
      throw error;
    }
  }

  async head(storageKey: string): Promise<FactSourceObjectMeta | null> {
    const absolutePath = this.resolvePath(storageKey);
    try {
      const stats = await stat(absolutePath);
      return {
        storageKey,
        size: stats.size,
        sha256: sha256FromLogicalKey(storageKey),
        // 本地驱动不保存 MIME 元数据（裁决 D-3：contentType 不入库），统一返回兜底值
        contentType: DEFAULT_CONTENT_TYPE,
        storedAt: stats.mtime,
      };
    } catch (error: unknown) {
      if (systemErrorCode(error) === 'ENOENT') return null;
      throw error;
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await access(this.resolvePath(storageKey), constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  async delete(storageKey: string): Promise<void> {
    const absolutePath = this.resolvePath(storageKey);
    try {
      await unlink(absolutePath);
    } catch (error: unknown) {
      if (systemErrorCode(error) === 'ENOENT') return;
      throw error;
    }
  }

  /** 只读探针：目录存在且可读（ready 用，不创建文件）。语义与既有实现一致。 */
  async assertReadable(): Promise<void> {
    await access(this.root, constants.R_OK);
  }

  /**
   * 写探针：创建并删除临时探针文件（仅启动时执行一次）。
   * 先 `mkdir -p` 承接既有 `onModuleInit()` 的建目录职责，保证行为等价。
   */
  async assertWritable(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await this.assertReadable();
    const probe = path.join(this.root, `.readiness-probe-${process.pid}-${Date.now()}`);
    const handle = await open(probe, 'wx');
    try {
      await handle.writeFile('fact-source-storage-ready');
      await handle.sync();
    } finally {
      await handle.close();
      await unlink(probe).catch(() => undefined);
    }
  }

  /** 逻辑键 → 绝对路径；正则与越界校验逐字符沿用既有 `resolveKey()`。 */
  private resolvePath(storageKey: string): string {
    assertLogicalStorageKey(storageKey);
    const absolutePath = path.resolve(this.root, storageKey);
    if (!absolutePath.startsWith(`${this.root}${path.sep}`)) {
      throw new FactSourceStorageError('SOURCE_FILE_STORAGE_KEY_OUTSIDE_ROOT');
    }
    return absolutePath;
  }
}
