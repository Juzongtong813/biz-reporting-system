import { Injectable, InternalServerErrorException, OnModuleInit, Optional } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { assertProductionFactSourceStorage } from './fact-source-storage.config';
import { createFactSourceDriver } from './storage/fact-source-driver.factory';
import type {
  FactSourceDriver,
  FactSourceDriverKind,
  FactSourceObjectMeta,
  StoredFactSourceFile,
} from './storage/fact-source-driver.interface';
import { isFactSourceStorageError } from './storage/fact-source-storage.error';

/**
 * 向后兼容的类型再导出。
 *
 * 既有消费方（`fact-import.service.ts`）以
 * `import { FactSourceFileStorageService, StoredFactSourceFile } from './fact-source-file-storage.service'`
 * 的形式引用该类型；类型定义已内移至 `storage/fact-source-driver.interface.ts`
 * （新增 `sha256` / `contentType` / `deduplicated` 字段，原三字段不变），此处保持导入路径不变。
 */
export type { FactSourceDriver, FactSourceObjectMeta, StoredFactSourceFile };

/**
 * 源文件存储服务 —— **唯一 Nest 注入点、唯一类名**（裁决 D-1）。
 *
 * 本类不再直接操作文件系统：Local / COS 的差异全部下沉到内部持有的
 * `FactSourceDriver`（普通对象，**不是** Nest provider，**无**注入令牌）。
 *
 * 对外契约保持不变：
 * - 公开方法 `store` / `read` / `exists` / `assertReadable` / `assertWritable` / `assertReady` 签名不变；
 * - 抛出的仍是 `InternalServerErrorException(<既有错误码字符串>)`，
 *   保证既有测试与审计日志断言不漂移（设计 §2.3）。
 */
@Injectable()
export class FactSourceFileStorageService implements OnModuleInit {
  private readonly driver: FactSourceDriver;

  /**
   * @param driver **可选**内部驱动。
   *
   * 缺省时按 `FACT_SOURCE_STORAGE_DRIVER` 现场装配（非 production 默认 local），
   * 因此 `new FactSourceFileStorageService()` 的无参形态仍然可用
   * （`apps/api/test/import-job-storage.integration.mjs:67` 依赖该形态）。
   *
   * ⚠️ 驱动在**构造时**求值：既有测试会临时设置 `FACT_SOURCE_STORAGE_ROOT`、
   * 构造完立即还原，惰性求值会取到错误的根目录。
   *
   * `@Optional()` 使本类即便以普通 class provider 身份被 Nest 装配也不会因
   * 无法解析接口类型而报错；生产装配走 `FactSourceDriverModule` 的 `useFactory`。
   */
  constructor(@Optional() driver?: FactSourceDriver) {
    this.driver = driver ?? createFactSourceDriver(process.env);
  }

  /** 当前驱动类别（'local' | 'cos'），供装配自检与日志使用。 */
  get driverKind(): FactSourceDriverKind {
    return this.driver.kind;
  }

  async onModuleInit(): Promise<void> {
    // D1（Codex PG-20260805-COS-D-CORRECTION）：仅 driver=local 时才执行 CFS 挂载校验；
    // driver=cos 不读 mountinfo、不要求 FACT_SOURCE_STORAGE_ROOT。
    const driverKind = this.driverKind;
    const mountInfo = process.platform === 'linux' && process.env.NODE_ENV === 'production' && driverKind === 'local'
      ? await readFile('/proc/self/mountinfo', 'utf8').catch(() => '')
      : undefined;
    assertProductionFactSourceStorage(process.env, process.platform, mountInfo, driverKind);
    // E-02：模块初始化执行一次启动探针，后续 ready 只读
    await this.assertWritable();
  }

  /** E-02：只读探针（ready 用）。COS driver 下为 headBucket，零对象产生（裁决 D-2）。 */
  async assertReadable(): Promise<void> {
    await this.run('assertReadable', () => this.driver.assertReadable());
  }

  /** E-02：启动探针（模块初始化时执行一次）。COS driver 下同样禁止写入（裁决 D-2）。 */
  async assertWritable(): Promise<void> {
    await this.run('assertWritable', () => this.driver.assertWritable());
  }

  /** @deprecated E-02 拆分后保留兼容别名（等价 assertWritable） */
  async assertReady(): Promise<void> {
    await this.assertWritable();
  }

  async store(buffer: Buffer, originalName: string, expectedSha256: string): Promise<StoredFactSourceFile> {
    return this.run('store', () => this.driver.put({ buffer, originalName, expectedSha256 }));
  }

  async read(storageKey: string): Promise<Buffer> {
    return this.run('read', () => this.driver.get(storageKey));
  }

  async exists(storageKey: string): Promise<boolean> {
    return this.run('exists', () => this.driver.exists(storageKey));
  }

  /**
   * 读取对象元数据，不下载正文。
   * 供 C 阶段补偿路径判定"对象是否确实落桶"使用。
   */
  async head(storageKey: string): Promise<FactSourceObjectMeta | null> {
    return this.run('head', () => this.driver.head(storageKey));
  }

  /**
   * 删除对象（幂等）。
   * ⚠️ **仅供补偿路径与运维清理使用，业务正常流程禁止调用**（设计 §6.3）。
   */
  async delete(storageKey: string): Promise<void> {
    await this.run('delete', () => this.driver.delete(storageKey));
  }

  /**
   * 统一异常边界：把驱动层的 `FactSourceStorageError` 收敛为既有的
   * `InternalServerErrorException(<错误码>)`，保证对业务层的错误契约零变更。
   * 原始错误经 `cause` 传递，供 C 阶段读取 `code` / `retryable` 做补偿决策。
   */
  private async run<T>(operation: string, task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } catch (error: unknown) {
      if (isFactSourceStorageError(error)) {
        throw new InternalServerErrorException(error.code, { cause: error, description: operation });
      }
      throw error;
    }
  }
}
