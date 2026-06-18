/**
 * 合同管理 DTO
 * 来源：OpenAPI YAML — Contracts + Allocations tags
 */
/** 创建 / 更新合同请求 */
export interface CreateContractRequest {
    contractCode: string;
    contractName: string;
    contractAmount: number;
    rate: number;
    signDate?: string | null;
    expireDate?: string | null;
}
/** 更新合同 = 继承创建字段 */
export type UpdateContractRequest = CreateContractRequest;
/** 创建分配请求 */
export interface CreateAllocationRequest {
    cityId: number;
    cityContractAmount: number;
    rate: number;
    accumulatedOrderAmount: number;
    accumulatedInvoiceAmount: number;
}
/** 更新分配 = 继承创建字段 */
export type UpdateAllocationRequest = CreateAllocationRequest;
//# sourceMappingURL=contract.dto.d.ts.map