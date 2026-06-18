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
//# sourceMappingURL=misc.dto.d.ts.map