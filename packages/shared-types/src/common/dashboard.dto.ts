/**
 * DashboardStats — 真实业务聚合
 *
 * 口径:
 * - totalCities:           有 annual_report_packages（本年度报表包）的城市数
 * - totalContracts:        COUNT(contracts) WHERE is_deleted = 0
 * - reportedThisMonth:     month_snapshots 中当前月有快照的 city_id 去重数
 * - overdueNotSubmitted:   totalCities - reportedThisMonth
 *
 * 注意：以 annual_report_packages 为基线，仅统计当年有实际填报任务的城市。
 */
export interface DashboardStats {
  /** 有年度报表包的城市数 */
  totalCities: number;
  /** 合同总数（排除软删除） */
  totalContracts: number;
  /** 本月已提交地市数 */
  reportedThisMonth: number;
  /** 逾期未提交地市数 */
  overdueNotSubmitted: number;
}
