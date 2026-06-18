/**
 * 仪表盘 API（Admin 端）
 *
 * DashboardStats 类型来源: @biz-reporting/shared-types
 * ⚠️ 口径为联调过渡版，待冻结管理端指标方案后替换
 */
import type { DashboardStats } from '@biz-reporting/shared-types';
import request from '@/utils/request';

const BASE = '/admin/dashboard';

/** 获取仪表盘统计数据 */
export function getDashboard(): Promise<DashboardStats> {
  return request.get(BASE);
}
