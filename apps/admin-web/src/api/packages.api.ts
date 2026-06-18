/**
 * 报表包管理 API（Admin 端）
 */
import type {
  AdminPackageItem,
  PaginatedResponse,
  ReturnToDraftRequest,
  UnlockMonthsRequest,
  OpenCurrentMonthContractRequest,
} from '@biz-reporting/shared-types';
import request from '@/utils/request';

const BASE = '/admin/packages';

/** 获取报表包列表（GET /api/admin/packages） */
export function listPackages(): Promise<PaginatedResponse<AdminPackageItem>> {
  return request.get(BASE);
}

/** 退回报表包到草稿（POST /admin/packages/{id}/return-to-draft） */
export function returnToDraft(
  packageId: number,
  data: ReturnToDraftRequest,
): Promise<void> {
  return request.post(`${BASE}/${packageId}/return-to-draft`, data);
}

/** 解锁历史月份（POST /admin/packages/{id}/unlock-months） */
export function unlockMonths(
  packageId: number,
  data: UnlockMonthsRequest,
): Promise<void> {
  return request.post(`${BASE}/${packageId}/unlock-months`, data);
}

/** 开放当月新增合同填报权限（POST /admin/packages/{id}/open-current-month-contract） */
export function openCurrentMonthContract(
  packageId: number,
  data: OpenCurrentMonthContractRequest,
): Promise<void> {
  return request.post(`${BASE}/${packageId}/open-current-month-contract`, data);
}
