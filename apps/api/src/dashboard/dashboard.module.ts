import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnnualPackageEntity } from '../packages/annual-package.entity';
import { ContractEntity } from '../contracts/contract.entity';
import { MonthSnapshotEntity } from '../packages/month-snapshot.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AnnualPackageEntity, ContractEntity, MonthSnapshotEntity]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
