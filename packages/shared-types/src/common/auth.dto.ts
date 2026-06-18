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
  code: string;   // wx.login() 获取的临时 code
  name: string;   // 用户昵称/真实姓名
  cityId: number; // 绑定的城市 ID
}

/** 微信登录请求（已有用户直接登录） */
export interface WechatLoginRequest {
  code: string; // wx.login() 获取的临时 code
}

/** 登录统一响应 */
export interface LoginResponse {
  token: string;      // JWT access_token
  user: UserBrief;    // 当前用户简版信息
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
