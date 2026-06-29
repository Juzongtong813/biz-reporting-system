import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImportJobEntity } from './import-job.entity';
import { ExportJobEntity } from './export-job.entity';
import { RecalcTaskEntity } from './recalc-task.entity';
import { AdminImportsController } from './admin-imports.controller';
import { CityImportsController } from './city-imports.controller';
import { ImportsController } from './imports.controller';
import { ExportsController } from './exports.controller';
import { AdminRecalcController } from './admin-recalc.controller';
import { Ws6Service } from './ws6.service';
import { ContractEntity } from '../contracts/contract.entity';
import { AllocationEntity } from '../contracts/allocation.entity';
import { CityEntity } from '../cities/city.entity';
import { ContractImportService } from './contract-import.service';
import { ReportingImportService } from './reporting-import.service';
import { AnnualPackageEntity } from '../packages/annual-package.entity';
import { ContractMonthRowEntity } from '../packages/contract-month-row.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ImportJobEntity, ExportJobEntity, RecalcTaskEntity,
      ContractEntity, AllocationEntity, CityEntity,
      AnnualPackageEntity, ContractMonthRowEntity,
    ]),
  ],
  controllers: [
    AdminImportsController,
    CityImportsController,
    ImportsController,
    ExportsController,
    AdminRecalcController,
  ],
  providers: [Ws6Service, ContractImportService, ReportingImportService],
  exports: [Ws6Service],
})
export class Ws6Module {}
