import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BizCostEntryEntity } from '../costs/biz-cost-entry.entity';
import { BizCostCategoryEntity } from '../costs/biz-cost-category.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { RbacModule } from '../rbac/rbac.module';
import { BizAggregatesModule } from '../biz-aggregates/biz-aggregates.module';
import { BizCostService } from './biz-cost.service';
import { BizCostController } from './biz-cost.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([BizCostEntryEntity, BizCostCategoryEntity, BizOperationLogEntity]),
    RbacModule,
    BizAggregatesModule,
  ],
  controllers: [BizCostController],
  providers: [BizCostService],
  exports: [BizCostService],
})
export class BizCostsModule {}
