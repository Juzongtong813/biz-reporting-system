import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImportJobEntity } from './import-job.entity';
import { ExportJobEntity } from './export-job.entity';
import { RecalcTaskEntity } from './recalc-task.entity';
import { ContractEntity } from '../contracts/contract.entity';
import { AllocationEntity } from '../contracts/allocation.entity';
import { CityEntity } from '../cities/city.entity';
import { JobStatus, ImportJobType, ExportMode, ExportScopeType, SnapshotRange, RecalcRetryMode } from '@biz-reporting/shared-types';
import type { ImportPreviewResponse, ImportConfirmResponse, ExportJobResponse, RecalcTaskListResponse, RecalcRetryResponse } from '@biz-reporting/shared-types';
import type { ConfirmImportRequestDto, CreateExportJobRequestDto, RetryRecalcTaskRequestDto } from './ws6.dto';
import { ContractImportService, ContractImportResult } from './contract-import.service';
import { ReportingImportService, ReportingPreviewResult, ReportingExecuteResult } from './reporting-import.service';

@Injectable()
export class Ws6Service {
  constructor(
    @InjectRepository(ImportJobEntity)
    private readonly importJobRepo: Repository<ImportJobEntity>,
    @InjectRepository(ExportJobEntity)
    private readonly exportJobRepo: Repository<ExportJobEntity>,
    @InjectRepository(RecalcTaskEntity)
    private readonly recalcTaskRepo: Repository<RecalcTaskEntity>,
    private readonly contractImportService: ContractImportService,
    private readonly reportingImportService: ReportingImportService,
  ) {}

  // ==================== Imports ====================

  async createImportJob(data: {
    jobType: ImportJobType;
    operatorUserId: number;
    cityId: number | null;
    sourceFileUrl?: string;
    sourceFileName?: string;
    sourceFileBase64?: string;
  }): Promise<ImportJobEntity> {
    const job = this.importJobRepo.create({
      jobType: data.jobType,
      operatorUserId: data.operatorUserId,
      cityId: data.cityId,
      status: JobStatus.PENDING,
      sourceFileUrl: data.sourceFileUrl || '',
      sourceFileName: data.sourceFileName || null,
      sourceFileBase64: data.sourceFileBase64 || null,
    });

    const saved = await this.importJobRepo.save(job);
    const sourceFileUrl = `/api/imports/${saved.id}/source-file`;
    await this.importJobRepo.update(saved.id, { sourceFileUrl });
    saved.sourceFileUrl = sourceFileUrl;
    return saved as ImportJobEntity;
  }

  async getImportPreview(jobId: number): Promise<ImportPreviewResponse> {
    const job = await this.importJobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`导入任务 #${jobId} 不存在`);

    let parsedSummary: Record<string, unknown> | null = null;
    let errorSummary: Record<string, unknown> | null = null;

    if (job.jobType === ImportJobType.CONTRACT) {
      if (job.parsedSummaryJson) {
        parsedSummary = job.parsedSummaryJson as unknown as Record<string, unknown>;
      } else {
        const fileBuffer = this.getSourceBuffer(job);
        if (!fileBuffer) throw new BadRequestException(`导入任务 #${jobId} 没有可读取的文件数据`);

        const result = await this.contractImportService.preview(fileBuffer);
        parsedSummary = result as unknown as Record<string, unknown>;
        errorSummary = result.errors.length > 0
          ? { errors: result.errors.map((e) => `${e.row ? `第${e.row}行` : ''}${e.message}`) }
          : null;

        await this.importJobRepo.update(jobId, {
          parsedSummaryJson: parsedSummary as any,
          errorSummaryJson: errorSummary as any,
        });
      }
    } else if (job.jobType === ImportJobType.CITY_REPORTING) {
      if (job.parsedSummaryJson) {
        parsedSummary = job.parsedSummaryJson as unknown as Record<string, unknown>;
      } else {
        const fileBuffer = this.getSourceBuffer(job);
        if (!fileBuffer) throw new BadRequestException(`导入任务 #${jobId} 没有可读取的文件数据`);

        const result = await this.reportingImportService.preview(fileBuffer);
        parsedSummary = result as unknown as Record<string, unknown>;
        errorSummary = result.errors.length > 0
          ? { errors: result.errors.map((e) => `${e.row ? `第${e.row}行` : ''}${e.message}`) }
          : null;

        await this.importJobRepo.update(jobId, {
          parsedSummaryJson: parsedSummary as any,
          errorSummaryJson: errorSummary as any,
        });
      }
    }

    return {
      id: job.id,
      status: job.status,
      parsedSummary,
      diffSummary: job.diffSummaryJson,
      errorSummary,
    };
  }

  async confirmImport(jobId: number, _dto: ConfirmImportRequestDto): Promise<ImportConfirmResponse> {
    const job = await this.importJobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`导入任务 #${jobId} 不存在`);
    if (job.status !== JobStatus.PENDING) {
      throw new BadRequestException(`导入任务 #${jobId} 当前状态为 ${job.status}，仅 pending 状态可确认`);
    }

    let result: ContractImportResult | null = null;
    let reportingResult: ReportingExecuteResult | null = null;

    try {
      if (job.jobType === ImportJobType.CONTRACT) {
        if (job.parsedSummaryJson) {
          const parsed = job.parsedSummaryJson as any;
          const contracts = parsed?.contracts;
          if (contracts && contracts.length > 0) {
            result = await this.contractImportService.executeFromCache(contracts, job.operatorUserId);
          }
        } else {
          const fileBuffer = this.getSourceBuffer(job);
          if (!fileBuffer) throw new BadRequestException(`导入任务 #${jobId} 没有可读取的文件数据`);
          result = await this.contractImportService.execute(fileBuffer, job.operatorUserId);
        }
      } else if (job.jobType === ImportJobType.CITY_REPORTING) {
        const cityId = _dto.cityId;
        const reportYear = _dto.reportYear;
        if (!cityId) throw new BadRequestException('城市报表导入必须指定 cityId');
        if (!reportYear) throw new BadRequestException('城市报表导入必须指定 reportYear');

        const fileBuffer = this.getSourceBuffer(job);
        if (!fileBuffer) throw new BadRequestException(`导入任务 #${jobId} 没有可读取的文件数据`);
        reportingResult = await this.reportingImportService.execute(
          fileBuffer,
          cityId,
          reportYear,
          job.operatorUserId,
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
      console.error(`[confirmImport] job#${jobId} 执行失败:`, errMsg);
      await this.importJobRepo.update(jobId, {
        status: JobStatus.FAILED,
        errorSummaryJson: { errors: [errMsg] } as any,
      });
      throw err;
    }

    const successCount = result?.successCount ?? reportingResult?.successCount ?? 0;
    const errors = result?.errors ?? reportingResult?.errors ?? [];
    const hasSuccess = successCount > 0;

    if (hasSuccess) {
      await this.importJobRepo.update(jobId, {
        status: JobStatus.COMPLETED,
        confirmedAt: new Date(),
      });
    } else {
      await this.importJobRepo.update(jobId, {
        status: JobStatus.FAILED,
        errorSummaryJson: {
          errors: errors.map((e: { row?: number; message: string }) => `${e.row ? `第${e.row}行` : ''}${e.message}`),
        } as any,
      });
    }

    return { success: hasSuccess, jobId: job.id };
  }

  async getImportSourceFile(jobId: number): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
    const job = await this.importJobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`导入任务 #${jobId} 不存在`);
    if (!job.sourceFileBase64) throw new BadRequestException(`导入任务 #${jobId} 没有可读取的文件数据`);

    const fileName = job.sourceFileName || `import-${job.id}.xlsx`;
    const buffer = Buffer.from(job.sourceFileBase64, 'base64');
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    const contentType = ext === 'csv'
      ? 'text/csv; charset=utf-8'
      : ext === 'xls'
        ? 'application/vnd.ms-excel'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    return { buffer, fileName, contentType };
  }

  // ==================== Exports ====================

  async createExportJob(data: CreateExportJobRequestDto, userId: number): Promise<ExportJobEntity> {
    const job = this.exportJobRepo.create({
      operatorUserId: userId,
      exportMode: data.exportMode,
      scopeType: data.scopeType,
      cityId: data.cityId ?? null,
      reportYear: data.reportYear,
      belongMonth: data.belongMonth ?? null,
      snapshotRange: data.snapshotRange ?? null,
      status: JobStatus.PENDING,
    });
    const saved = await this.exportJobRepo.save(job);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await this.exportJobRepo.update(saved.id, {
      status: JobStatus.COMPLETED,
      fileUrl: '',
      expiresAt,
    });

    return this.exportJobRepo.findOne({ where: { id: saved.id } }) as Promise<ExportJobEntity>;
  }

  async getExportJob(jobId: number): Promise<ExportJobResponse> {
    const job = await this.exportJobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`导出任务 #${jobId} 不存在`);
    return {
      id: job.id,
      status: job.status,
      fileUrl: job.fileUrl,
      expiresAt: job.expiresAt,
      createdAt: job.createdAt,
    };
  }

  // ==================== Recalc ====================

  async listRecalcTasks(): Promise<RecalcTaskListResponse> {
    const tasks = await this.recalcTaskRepo.find({ order: { createdAt: 'DESC' } });
    const items = tasks.map((t) => ({
      id: t.id,
      taskType: t.taskType,
      status: t.status,
      errorMessage: t.errorMessage,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
    return { items, total: items.length };
  }

  async retryRecalcTask(taskId: number, _dto: RetryRecalcTaskRequestDto): Promise<RecalcRetryResponse> {
    const task = await this.recalcTaskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`重算任务 #${taskId} 不存在`);
    if (task.status !== JobStatus.FAILED) {
      throw new BadRequestException(`重算任务 #${taskId} 当前状态为 ${task.status}，仅 failed 状态可重试`);
    }
    await this.recalcTaskRepo.update(taskId, {
      status: JobStatus.PENDING,
      errorMessage: null,
    });
    return { success: true, taskId: task.id };
  }

  private getSourceBuffer(job: ImportJobEntity): Buffer | null {
    return job.sourceFileBase64 ? Buffer.from(job.sourceFileBase64, 'base64') : null;
  }
}
