/**
 * 导入导出 / 提醒 / 重算 DTO
 * 来源：OpenAPI YAML — Reminders + Imports + Exports + RecalcTasks tags
 */

/** 发送提醒请求 */
export interface SendRemindersRequest {
  year: number;
  month: number;
  cityIds: number[];
}

/** 确认导入请求 */
export interface ConfirmImportRequest {
  confirmOverwrite: boolean;
}

/** 创建导出任务请求 */
export interface CreateExportJobRequest {
  exportMode: 'current_realtime' | 'month_snapshot';
  scopeType: 'city' | 'all_cities';
  cityId?: number | null;
  reportYear: number;
  belongMonth?: number | null;
  snapshotRange?: 'month_only' | 'year_to_month' | null;
}

/** 重试重算任务请求 */
export interface RetryRecalcTaskRequest {
  retryMode: 'full' | 'failed_only';
}

// ============================================================
// WS6 响应 DTO
// ============================================================

/** 导入预览响应 */
export interface ImportPreviewResponse {
  id: number;
  status: string;
  parsedSummary: Record<string, unknown> | null;
  diffSummary: Record<string, unknown> | null;
  errorSummary: Record<string, unknown> | null;
}

/** 导入确认响应 */
export interface ImportConfirmResponse {
  success: boolean;
  jobId: number;
}

/** 导出任务状态响应 */
export interface ExportJobResponse {
  id: number;
  status: string;
  fileUrl: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

/** 导出创建响应 */
export interface ExportCreateResponse {
  jobId: number;
  status: string;
}

/** 重算任务列表响应 */
export interface RecalcTaskItem {
  id: number;
  taskType: string;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 重算任务列表响应 */
export interface RecalcTaskListResponse {
  items: RecalcTaskItem[];
  total: number;
}

/** 重算重试响应 */
export interface RecalcRetryResponse {
  success: boolean;
  taskId: number;
}
