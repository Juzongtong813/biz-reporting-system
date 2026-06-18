/**
 * 用户管理 API（Admin 端）
 * 对应后端端点：
 *   GET   /api/admin/users             — 用户列表
 *   PATCH /api/admin/users/:id/status  — 启用/禁用
 */
import type {
  UserListItem,
  UserListResponse,
  UpdateUserStatusRequest,
} from '@biz-reporting/shared-types';
import request from '@/utils/request';

const BASE = '/admin/users';

/** 获取用户列表 */
export function listUsers(): Promise<UserListResponse> {
  return request.get(BASE);
}

/** 更新用户状态（启用/禁用） */
export function updateUserStatus(
  userId: number,
  data: UpdateUserStatusRequest,
): Promise<UserListItem> {
  return request.patch(`${BASE}/${userId}/status`, data);
}
