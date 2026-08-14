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
