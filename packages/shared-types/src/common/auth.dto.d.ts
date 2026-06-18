/**
 * Auth 相关 DTO
 * 来源：OpenAPI YAML — Auth tag + schemas
 */
import { UserBrief } from '../user/user';
/** 管理员登录请求 */
export interface AdminLoginRequest {
    username: string;
    password: string;
}
/** 微信注册请求（首次登录自动注册） */
export interface WechatRegisterRequest {
    code: string;
    name: string;
    cityId: number;
}
/** 微信登录请求（已有用户直接登录） */
export interface WechatLoginRequest {
    code: string;
}
/** 登录统一响应 */
export interface LoginResponse {
    token: string;
    user: UserBrief;
}
/** 当前用户详情响应（GET /api/me） */
export interface MeResponse {
    id: number;
    role: import('../enums').Role;
    name: string;
    cityId: number | null;
    cityName: string | null;
    status: import('../enums').UserStatus;
}
//# sourceMappingURL=auth.dto.d.ts.map