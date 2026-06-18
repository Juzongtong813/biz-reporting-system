/**
 * 合同 API
 * 对应冻结 OpenAPI 端点：
 *   GET    /api/admin/contracts             — 分页列表
 *   GET    /api/admin/contracts/:id          — 详情
 *   POST   /api/admin/contracts              — 创建
 *   PATCH  /api/admin/contracts/:id          — 更新
 *   DELETE /api/admin/contracts/:id          — 软删除
 *   POST   /api/admin/contracts/:id/allocations — 新增分配
 *
 * GET /api/admin/contracts/:id/allocations 不在冻结 OpenAPI 中。
 */
import type {
  Contract,
  CreateContractRequest,
  UpdateContractRequest,
  PaginatedResponse,
  PaginationParams,
} from '@biz-reporting/shared-types';
import request from '@/utils/request';

const BASE = '/admin/contracts';

/** 分页获取合同列表 */
export function listContracts(
  params?: PaginationParams,
): Promise<PaginatedResponse<Contract>> {
  return request.get(BASE, { params });
}

/** 获取合同详情 */
export function getContract(contractId: number): Promise<Contract> {
  return request.get(`${BASE}/${contractId}`);
}

/** 创建合同 */
export function createContract(data: CreateContractRequest): Promise<Contract> {
  return request.post(BASE, data);
}

/** 更新合同 */
export function updateContract(
  contractId: number,
  data: UpdateContractRequest,
): Promise<Contract> {
  return request.patch(`${BASE}/${contractId}`, data);
}

/** 软删除合同 */
export function softDeleteContract(contractId: number): Promise<void> {
  return request.delete(`${BASE}/${contractId}`);
}
