/**
 * DashboardStats - real business aggregation for admin overview cards.
 *
 * Field definitions:
 * - totalCities: cities with an annual_report_packages record for the selected year.
 * - totalContracts: non-deleted contracts.
 * - reportedThisMonth: distinct cities with a snapshot in the selected month.
 * - overdueNotSubmitted: totalCities - reportedThisMonth.
 */
export interface DashboardStats {
  /** Cities that have an annual report package for the selected year. */
  totalCities: number;
  /** Non-deleted contract count. */
  totalContracts: number;
  /** Cities that have submitted the selected month. */
  reportedThisMonth: number;
  /** Cities overdue and not submitted for the selected month. */
  overdueNotSubmitted: number;
}

export interface AdminBusinessSummaryQuery {
  year: number;
}

export interface AdminBusinessSummaryItem {
  cityId: number;
  cityName: string;
  /** Annual completion amount filled by city users. */
  completionTotal: number;
  /** Annual acceptance amount filled by city users. */
  acceptanceTotal: number;
  /** Annual order gross profit calculated from completion amount and allocation rate. */
  orderGrossProfit: number;
  /** Annual submitted cost total. */
  costTotal: number;
  /** costTotal / completionTotal. */
  costRate: number;
  /** costTotal / orderGrossProfit. */
  costIncomeRate: number;
  /** orderGrossProfit - costTotal. */
  netProfit: number;
  /** netProfit / completionTotal. */
  netProfitRate: number;
  /** Submitted month count. */
  submittedMonthCount: number;
  /** Active contract allocation count for the city. */
  contractCount: number;
}

export interface AdminBusinessSummaryResponse {
  year: number;
  items: AdminBusinessSummaryItem[];
  totals: {
    completionTotal: number;
    acceptanceTotal: number;
    orderGrossProfit: number;
    costTotal: number;
    netProfit: number;
    costRate: number;
    costIncomeRate: number;
    netProfitRate: number;
    cityCount: number;
    submittedMonthCount: number;
    contractCount: number;
  };
}
