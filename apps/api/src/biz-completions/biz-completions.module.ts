import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BizOfflineCompletionEntity } from '../completions/biz-offline-completion.entity';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { RbacModule } from '../rbac/rbac.module';
import { BizAggregatesModule } from '../biz-aggregates/biz-aggregates.module';
import { BizOfflineCompletionService } from './biz-offline-completion.service';
import { BizOfflineCompletionController } from './biz-offline-completion.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BizOfflineCompletionEntity,
      BizContractEntity,
      BizContractCityAllocationEntity,
      BizOperationLogEntity,
    ]),
    RbacModule,
    BizAggregatesModule,
  ],
  controllers: [BizOfflineCompletionController],
  providers: [BizOfflineCompletionService],
  exports: [BizOfflineCompletionService],
})
export class BizCompletionsModule {}
