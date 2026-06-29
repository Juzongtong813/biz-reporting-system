import { IsBoolean, IsEnum, IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ExportMode, ExportScopeType, SnapshotRange, RecalcRetryMode } from '@biz-reporting/shared-types';

/** 确认导入请求校验 */
export class ConfirmImportRequestDto {
  @IsBoolean()
  confirmOverwrite!: boolean;

  /** 城市报表导入专用：目标城市 ID */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  cityId?: number | null;

  /** 城市报表导入专用：目标年份 */
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  reportYear?: number | null;
}

/** 创建导出任务请求校验 */
export class CreateExportJobRequestDto {
  @IsEnum(ExportMode)
  exportMode!: ExportMode;

  @IsEnum(ExportScopeType)
  scopeType!: ExportScopeType;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  cityId?: number | null;

  @IsInt()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  reportYear!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  belongMonth?: number | null;

  @IsOptional()
  @IsEnum(SnapshotRange)
  snapshotRange?: SnapshotRange | null;
}

/** 重试重算任务请求校验 */
export class RetryRecalcTaskRequestDto {
  @IsEnum(RecalcRetryMode)
  retryMode!: RecalcRetryMode;
}
