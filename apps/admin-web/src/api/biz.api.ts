/**
 * biz（新基线）API 客户端
 * 对应后端：POST /api/biz/auth/login、GET /api/biz/auth/me、
 *          GET /api/biz/portal/modules、GET /api/biz/portal/placeholder/:code、
 *          /api/biz/admin/**
 */
import axios, { type AxiosRequestConfig } from 'axios';
import { getBizToken } from '@/utils/biz-auth';

const request = axios.create({ baseURL: '/api' });

request.interceptors.request.use((config) => {
  const token = getBizToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface BizLoginResult {
  accessToken: string;
  expiresIn: number;
  user: { id: string; username: string; name: string; roleCode: string; cityId: string | null; sensitiveOrderScope: string };
}

export interface BizMeResult {
  id: string;
  username: string;
  roleCode: string;
  cityId: string | null;
  sensitiveOrderScope: string;
  permissions: string[];
  dataScope: { scopeType: string; provinceIds: string[]; cityId: string | null };
}

export interface BizModuleItem {
  id: string;
  code: string;
  name: string;
  level: string;
  parentId?: string | null;
  sortOrder: number;
}

export function bizLogin(username: string, password: string): Promise<BizLoginResult> {
  return request.post('/biz/auth/login', { username, password }).then((r) => r.data);
}

export function bizMe(): Promise<BizMeResult> {
  return request.get('/biz/auth/me').then((r) => r.data);
}

export function bizPortalModules(): Promise<{ level1: BizModuleItem[]; level2: BizModuleItem[] }> {
  return request.get('/biz/portal/modules').then((r) => r.data);
}

export function bizPlaceholder(code: string): Promise<{ code: string; found: boolean; message: string; accessible?: boolean }> {
  return request.get(`/biz/portal/placeholder/${code}`).then((r) => r.data);
}

// ================= 账号与权限管理（仅 super_admin） =================

export function bizAdminListUsers(): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/admin/users').then((r) => r.data);
}

export function bizAdminCreateUser(dto: {
  username: string; password: string; name: string; roleCode: string; cityId?: string | null;
}): Promise<Record<string, unknown>> {
  return request.post('/biz/admin/users', dto).then((r) => r.data);
}

export function bizAdminSetUserStatus(id: string, status: 'enabled' | 'disabled'): Promise<Record<string, unknown>> {
  return request.patch(`/biz/admin/users/${id}/status`, { status }).then((r) => r.data);
}

export function bizAdminResetPassword(id: string, newPassword: string): Promise<{ ok: boolean }> {
  return request.post(`/biz/admin/users/${id}/reset-password`, { newPassword }).then((r) => r.data);
}

export function bizAdminGetUserPermissions(id: string): Promise<{ roleCode: string; base: string[]; overrides: unknown[]; effective: string[] }> {
  return request.get(`/biz/admin/users/${id}/permissions`).then((r) => r.data);
}

export function bizAdminSetOverrides(id: string, overrides: Array<{ permissionCode: string; effect: 'allow' | 'deny' }>): Promise<{ ok: boolean }> {
  return request.put(`/biz/admin/users/${id}/permission-overrides`, { overrides }).then((r) => r.data);
}

export function bizAdminSetDataScopes(id: string, scopes: Array<{ provinceId: string | null; cityId?: string | null }>): Promise<{ ok: boolean }> {
  return request.put(`/biz/admin/users/${id}/data-scopes`, { scopes }).then((r) => r.data);
}

export function bizAdminRoles(): Promise<{ items: Array<{ id: string; code: string; name: string }> }> {
  return request.get('/biz/admin/roles').then((r) => r.data);
}

export function bizAdminModules(): Promise<{ items: unknown[] }> {
  return request.get('/biz/admin/modules').then((r) => r.data);
}

export function bizAdminPermissions(): Promise<{ items: Array<{ code: string; name: string; moduleId: string; action: string }> }> {
  return request.get('/biz/admin/permissions').then((r) => r.data);
}

export function bizAdminProvinces(): Promise<{ items: Array<{ id: string; code: string; name: string }> }> {
  return request.get('/biz/admin/provinces').then((r) => r.data);
}

export function bizAdminCities(provinceId?: string): Promise<{ items: Array<{ id: string; code: string; name: string; provinceId: string }> }> {
  return request.get('/biz/admin/cities', { params: provinceId ? { provinceId } : {} }).then((r) => r.data);
}

// ================= 合同域（M3） =================

export interface BizContractItem {
  id: string;
  contractNo: string;
  contractName: string;
  taxInclusiveAmountFen: number;
  provinceId: string;
  startDate?: string | null;
  endDate?: string | null;
  status: string;
  tags?: string[] | null;
  amountLocked?: boolean;
  parentContractId?: string | null;
}

export interface BizContractDetail {
  contract: {
    id: string; contractNo: string; contractName: string; taxInclusiveAmountFen: number;
    taxExclusiveAmountFen: number | null; provinceId: string; startDate: string | null; endDate: string | null;
    status: string; tags: string[]; amountLocked: boolean; voidSummaryChoice: string | null;
    parentContractId: string | null; versionNo: number; createdAt: string;
  };
  allocations: Array<{
    cityId: string; cityName: string; quotaFen: number; status: string; completionFen: number;
    progress: number; overrunFen: number; orderCompletionFen: number; offlineCompletionFen: number;
  }>;
  feeRates: Array<{ cityId: string; effectiveMonth: string; rateBp: number; changeReason: string | null }>;
  alerts: Array<{ alertType: string; firstTriggeredAt: string }>;
  progress: {
    orderCompletionFen: number; offlineCompletionFen: number; totalCompletionFen: number;
    contractAmountFen: number; progress: number; progressBasis: string; quotaFen: number | null;
    remainingFen: number; overrunFen: number;
  };
  finance?: {
    referenceCostFen: number; grossProfitFen: number; referenceNetProfitFen: number; isReference: boolean;
  };
}

export function bizContractList(params?: { provinceId?: string; cityId?: string; status?: string }): Promise<{ items: BizContractItem[] }> {
  return request.get('/biz/contracts', { params }).then((r) => r.data);
}

export function bizContractCreate(dto: {
  contractNo: string; contractName: string; taxInclusiveAmountFen: number;
  provinceId: string; startDate?: string | null; endDate?: string | null; parentContractId?: string | null;
}): Promise<BizContractItem> {
  return request.post('/biz/contracts', dto).then((r) => r.data);
}

export function bizContractDetail(id: string): Promise<BizContractDetail> {
  return request.get(`/biz/contracts/${id}`).then((r) => r.data);
}

export function bizContractUpdate(id: string, dto: Record<string, unknown>): Promise<BizContractItem> {
  return request.patch(`/biz/contracts/${id}`, dto).then((r) => r.data);
}

export function bizContractActivate(id: string): Promise<BizContractItem> {
  return request.post(`/biz/contracts/${id}/activate`).then((r) => r.data);
}

export function bizContractVoid(id: string, summaryChoice: string, reason: string): Promise<BizContractItem> {
  return request.post(`/biz/contracts/${id}/void`, { summaryChoice, reason }).then((r) => r.data);
}

export function bizContractUpsertAllocation(id: string, cityId: string, quotaFen: number): Promise<unknown> {
  return request.post(`/biz/contracts/${id}/allocations`, { cityId, quotaFen }).then((r) => r.data);
}

export function bizContractCancelAllocation(id: string, cityId: string): Promise<{ ok: boolean }> {
  return request.delete(`/biz/contracts/${id}/allocations/${cityId}`).then((r) => r.data);
}

export function bizContractAddFeeRate(id: string, cityId: string, effectiveMonth: string, rateBp: number, changeReason?: string): Promise<unknown> {
  return request.post(`/biz/contracts/${id}/fee-rates`, { cityId, effectiveMonth, rateBp, changeReason }).then((r) => r.data);
}

// ================= 订单域（M4） =================

export function bizOrderUpload(file: File, idempotencyKey: string): Promise<{ batchId: string; status: string }> {
  const form = new FormData();
  form.append('idempotencyKey', idempotencyKey);
  form.append('file', file);
  return request.post('/biz/orders/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
}

export function bizOrderBatches(): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/orders/batches').then((r) => r.data);
}

export function bizOrderBatchDetail(id: string): Promise<{ batch: Record<string, unknown>; errors: Array<Record<string, unknown>>; rowCount: number }> {
  return request.get(`/biz/orders/batches/${id}`).then((r) => r.data);
}

export function bizOrderBatchVoid(id: string, reason: string): Promise<{ ok: boolean }> {
  return request.post(`/biz/orders/batches/${id}/void`, { reason }).then((r) => r.data);
}

export function bizOrderBatchRestore(id: string): Promise<{ ok: boolean }> {
  return request.post(`/biz/orders/batches/${id}/restore`).then((r) => r.data);
}

export function bizOrderRows(filter?: { batchId?: string; cityId?: string; overrun?: 'city' | 'contract' | 'any' }): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/orders/rows', { params: filter }).then((r) => r.data);
}

// ================= 线下完工（M5） =================

export interface OfflineCompletionDto {
  contractId: string;
  cityId: string;
  businessMonth: string;
  amountFen: number;
  summary: string;
  attachmentRef?: string | null;
}

export function bizOfflineList(params?: { cityId?: string; status?: string }): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/offline-completions', { params }).then((r) => r.data);
}

export function bizOfflineCreate(dto: OfflineCompletionDto): Promise<Record<string, unknown>> {
  return request.post('/biz/offline-completions', dto).then((r) => r.data);
}

export function bizOfflineUpdate(id: string, dto: Partial<OfflineCompletionDto>): Promise<Record<string, unknown>> {
  return request.patch(`/biz/offline-completions/${id}`, dto).then((r) => r.data);
}

export function bizOfflineSubmit(id: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/offline-completions/${id}/submit`).then((r) => r.data);
}

export function bizOfflineWithdraw(id: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/offline-completions/${id}/withdraw`).then((r) => r.data);
}

export function bizOfflineApprove(id: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/offline-completions/${id}/approve`).then((r) => r.data);
}

export function bizOfflineReject(id: string, comment: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/offline-completions/${id}/reject`, { comment }).then((r) => r.data);
}

export function bizOfflineVoid(id: string, reason: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/offline-completions/${id}/void`, { reason }).then((r) => r.data);
}

export function bizOfflineRestore(id: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/offline-completions/${id}/restore`).then((r) => r.data);
}

// ================= 地市成本（M5，不关联合同） =================

export interface CostEntryDto {
  cityId: string;
  businessMonth: string;
  categoryCode: string;
  amountFen: number;
  description?: string | null;
}

export function bizCostList(params?: { cityId?: string; status?: string }): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/costs', { params }).then((r) => r.data);
}

export function bizCostCreate(dto: CostEntryDto): Promise<Record<string, unknown>> {
  return request.post('/biz/costs', dto).then((r) => r.data);
}

export function bizCostSubmit(id: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/costs/${id}/submit`).then((r) => r.data);
}

export function bizCostApprove(id: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/costs/${id}/approve`).then((r) => r.data);
}

export function bizCostReject(id: string, comment: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/costs/${id}/reject`, { comment }).then((r) => r.data);
}

export function bizCostVoid(id: string, reason: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/costs/${id}/void`, { reason }).then((r) => r.data);
}

export function bizCostRestore(id: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/costs/${id}/restore`).then((r) => r.data);
}

// ================= 汇总/分析/设置（M6） =================

export function bizAnalysisOverview(params?: { month?: string; cityId?: string }): Promise<{ orderCompletionFen: number; offlineCompletionFen: number; grossProfitFen: number; costFen: number; netProfitFen: number; contractCount: number; totalContractAmountFen: number; totalCompletionFen: number }> {
  return request.get('/biz/analysis/overview', { params }).then((r) => r.data);
}

export function bizAnalysisTrend(limit = 12, cityId?: string): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/analysis/trend', { params: cityId ? { limit, cityId } : { limit } }).then((r) => r.data);
}

export function bizAnalysisByCity(month?: string): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/analysis/by-city', { params: month ? { month } : {} }).then((r) => r.data);
}

export function bizAnalysisOverrunList(params?: { month?: string; cityId?: string }): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/analysis/overrun-list', { params }).then((r) => r.data);
}

export function bizAnalysisAlerts(cityId?: string, month?: string): Promise<{ items: Array<{ contractId: string; contractNo: string; contractName: string; alertType: string; endDate: string | null; status: string }> }> {
  const params: Record<string, string> = {};
  if (cityId) params.cityId = cityId;
  if (month) params.month = month;
  return request.get('/biz/analysis/alerts', { params }).then((r) => r.data);
}

export function bizAggregateRecalc(scope: Record<string, unknown>, confirmAll = false): Promise<{ ok: boolean }> {
  return request.post('/biz/aggregates/recalc', { scope, confirmAll }).then((r) => r.data);
}

export function bizAggregateCheck(): Promise<{ ok: boolean; warnings: Array<Record<string, unknown>>; warningCount: number }> {
  return request.post('/biz/aggregates/check').then((r) => r.data);
}

export function bizSettingsList(): Promise<{ items: Array<{ key: string; value: string; description: string | null }> }> {
  return request.get('/biz/settings').then((r) => r.data);
}

export function bizSettingUpdate(key: string, value: string): Promise<{ ok: boolean }> {
  return request.put(`/biz/settings/${key}`, { value }).then((r) => r.data);
}

export function bizOperationLogs(params?: { limit?: number; actionType?: string }): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/admin/operation-logs', { params }).then((r) => r.data);
}
