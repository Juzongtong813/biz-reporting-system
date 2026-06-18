/**
 * 认证 API
 * 对应后端端点：POST /api/auth/admin/login, GET /api/me
 */
import type {
  AdminLoginRequest,
  LoginResponse,
  MeResponse,
} from '@biz-reporting/shared-types';
import request from '@/utils/request';

/** 管理员登录 */
export function login(data: AdminLoginRequest): Promise<LoginResponse> {
  return request.post('/auth/admin/login', data);
}

/** 获取当前用户信息 */
export function getMe(): Promise<MeResponse> {
  return request.get('/me');
}
