import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import { OperationLogsService } from './operation-logs.service';
import { OperationLogsController } from './operation-logs.controller';

@Module({
  imports: [TypeOrmModule.forFeature([OperationLogEntity])],
  providers: [OperationLogsService],
  controllers: [OperationLogsController],
  exports: [OperationLogsService],
})
export class OperationLogsModule {}