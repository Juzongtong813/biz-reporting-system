/**
 * 用户管理 DTO
 * 来源：OpenAPI YAML — AdminUsers tag
 */
/** 用户列表项 */
export interface UserListItem {
    id: number;
    name: string;
    cityId: number | null;
    cityName: string | null;
    status: import('../enums').UserStatus;
    registerAt: string;
    lastLoginAt: string | null;
}
/** 用户列表响应 */
export interface UserListResponse {
    items: UserListItem[];
}
/** 更新用户状态请求（启用/禁用） */
export interface UpdateUserStatusRequest {
    status: import('../enums').UserStatus;
}
/** 重新绑定城市用户到其他城市 */
export interface RebindUserCityRequest {
    cityId: number;
}
//# sourceMappingURL=user.dto.d.ts.map