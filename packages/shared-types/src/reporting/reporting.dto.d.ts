/**
 * 填报相关 DTO
 * 来源：OpenAPI YAML — Packages + Snapshots + AdminPackages tags
 */
/** 单行合同填报输入 */
export interface ContractMonthInput {
    contractId: number;
    completionAmount: number;
    acceptanceAmount: number;
}
/** 单行费用填报输入 */
export interface CostMonthInput {
    costCategoryCode: string;
    amount: number;
}
/** 维保填报输入（可选，按城市配置决定是否必填） */
export interface MaintenanceMonthInput {
    invoiceTotalPrevYear?: number;
    invoiceMonthCountPrevYear?: number;
    invoiceTotalCurrentYear?: number;
}
/** 草稿保存请求 */
export interface DraftSaveRequest {
    monthNo: number;
    contractRows: ContractMonthInput[];
    costRows: CostMonthInput[];
    maintenanceRow?: MaintenanceMonthInput;
}
/** 提交预览请求（同草稿保存结构） */
export type SubmitPreviewRequest = DraftSaveRequest;
/** 提交预览响应 — 汇总校验结果与数据概览 */
export interface SubmitPreviewResponse {
    belongMonth: number;
    completionTotal: number;
    acceptanceTotal: number;
    costTotal: number;
    grossProfit: number;
    isOverdue: boolean;
}
/** 正式提交请求（payload 包含完整月度数据） */
export interface SubmitMonthRequest {
    monthNo: number;
    payload: DraftSaveRequest;
}
/** 退回草稿请求 */
export interface ReturnToDraftRequest {
    monthNo: number;
    reason: string;
}
/** 解锁历史月份请求 */
export interface UnlockMonthsRequest {
    months: number[];
    expiresAt: string;
    reason?: string | null;
}
/** 开放当月新增合同填报权限请求 */
export interface OpenCurrentMonthContractRequest {
    monthNo: number;
    contractId: number;
}
//# sourceMappingURL=reporting.dto.d.ts.map