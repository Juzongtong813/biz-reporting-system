import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnnualPackageEntity } from '../packages/annual-package.entity';
import { ContractEntity } from '../contracts/contract.entity';
import { AllocationEntity } from '../contracts/allocation.entity';
import { MonthSnapshotEntity } from '../packages/month-snapshot.entity';
import { ContractMonthRowEntity } from '../packages/contract-month-row.entity';
import { CityEntity } from '../cities/city.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AnnualPackageEntity, ContractEntity, AllocationEntity, MonthSnapshotEntity, ContractMonthRowEntity, CityEntity]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
