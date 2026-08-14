import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizContractFeeRateEntity } from '../contracts/biz-contract-fee-rate.entity';
import { BizContractAlertEntity } from '../contracts/biz-contract-alert.entity';
import { BizOrderRowEntity } from '../orders/biz-order-row.entity';
import { BizOfflineCompletionEntity } from '../completions/biz-offline-completion.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { CityEntity } from '../main-data/city.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { RbacModule } from '../rbac/rbac.module';
import { BizContractsService } from './biz-contracts.service';
import { BizContractsController } from './biz-contracts.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BizContractEntity,
      BizContractCityAllocationEntity,
      BizContractFeeRateEntity,
      BizContractAlertEntity,
      BizOrderRowEntity,
      BizOfflineCompletionEntity,
      ProvinceEntity,
      CityEntity,
      BizOperationLogEntity,
    ]),
    RbacModule,
  ],
  controllers: [BizContractsController],
  providers: [BizContractsService],
  exports: [BizContractsService],
})
export class BizContractsModule {}
