/**
 * 存储装配模块（任务 B7）。
 *
 * ⚠️ 硬性约束（裁决 D-1 / 设计 §2.4）：
 * - 本模块**只**提供并导出 `FactSourceFileStorageService` 一个 provider；
 * - **禁止**新增任何存储类注入令牌（`FACT_SOURCE_STORAGE`、`COS_CLIENT` 均不注册为 DI token）；
 * - COS 客户端与 Local driver 均由 `createFactSourceDriver()` 直接构造后
 *   作为**构造参数**传入服务，不经 Nest 容器。
 *
 * 使用 `useFactory` 而非 class provider 的原因：driver 是接口类型，
 * 走 class provider 会让 Nest 尝试解析 `design:paramtypes` 中的 `Object` token；
 * 工厂形态完全绕开该解析路径，装配行为确定可预期。
 */
import { Module } from '@nestjs/common';
import { FactSourceFileStorageService } from '../fact-source-file-storage.service';
import { createFactSourceDriver } from './fact-source-driver.factory';

/** 供测试与其他模块复用的工厂函数（不发起任何网络请求）。 */
export function factSourceFileStorageServiceFactory(): FactSourceFileStorageService {
  return new FactSourceFileStorageService(createFactSourceDriver(process.env));
}

@Module({
  providers: [
    {
      provide: FactSourceFileStorageService,
      useFactory: factSourceFileStorageServiceFactory,
    },
  ],
  exports: [FactSourceFileStorageService],
})
export class FactSourceDriverModule {}
