/**
 * Axios 单例 - 所有 API 请求的唯一入口
 *
 * 职责：
 * 1. 自动附加 Authorization header
 * 2. 401 响应时自动跳转登录页
 * 3. 统一错误 toast 提示
 * 4. 响应数据解包（返回 res.data）
 */
import axios, { AxiosError } from 'axios';
import { message } from 'antd';
import { getToken, clearToken } from './auth';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

const request = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// ---- 请求拦截器 ----
request.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ---- 响应拦截器 ----
request.interceptors.response.use(
  (response) => {
    // Axios 成功响应 (2xx)，直接返回 data（业务层不再需要解包）
    return response.data;
  },
  (error: AxiosError<{ message?: string }>) => {
    if (error.response) {
      const status = error.response.status;
      const serverMsg = error.response.data?.message;

      if (status === 401) {
        clearToken();
        // HashRouter：登录页必须走 hash 路由，避免静态站点跳错地址
        if (!window.location.hash.includes('/login')) {
          window.location.hash = '#/login';
        }
        message.error('登录已过期，请重新登录');
      } else {
        message.error(serverMsg || `请求失败 (${status})`);
      }
    } else {
      message.error('网络连接异常，请检查网络');
    }

    return Promise.reject(error);
  },
);

export default request;
