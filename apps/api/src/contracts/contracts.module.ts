import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractEntity } from './contract.entity';
import { AllocationEntity } from './allocation.entity';
import { ContractsController } from './contracts.controller';
import { AllocationsController } from './allocations.controller';
import { ContractsService } from './contracts.service';

@Module({
  imports: [TypeOrmModule.forFeature([ContractEntity, AllocationEntity])],
  controllers: [ContractsController, AllocationsController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
