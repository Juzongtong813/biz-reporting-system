import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BizMonthlyAggregateEntity } from '../aggregates/biz-monthly-aggregate.entity';
import { BizAggregateFailureEntity } from '../aggregates/biz-aggregate-failure.entity';
import { BizSystemSettingEntity } from '../aggregates/biz-system-setting.entity';
import { BizOrderRowEntity } from '../orders/biz-order-row.entity';
import { BizOfflineCompletionEntity } from '../completions/biz-offline-completion.entity';
import { BizCostEntryEntity } from '../costs/biz-cost-entry.entity';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { CityEntity } from '../main-data/city.entity';
import { RbacModule } from '../rbac/rbac.module';
import { BizAggregateService } from './biz-aggregate.service';
import { BizAggregateController } from './biz-aggregate.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BizMonthlyAggregateEntity,
      BizAggregateFailureEntity,
      BizSystemSettingEntity,
      BizOrderRowEntity,
      BizOfflineCompletionEntity,
      BizCostEntryEntity,
      BizContractEntity,
      BizContractCityAllocationEntity,
      BizOperationLogEntity,
      CityEntity,
    ]),
    RbacModule,
  ],
  controllers: [BizAggregateController],
  providers: [BizAggregateService],
  exports: [BizAggregateService],
})
export class BizAggregatesModule {}
