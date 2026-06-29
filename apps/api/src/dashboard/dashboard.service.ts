import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ContractEntity } from '../contracts/contract.entity';
import { AllocationEntity } from '../contracts/allocation.entity';
import { AnnualPackageEntity } from '../packages/annual-package.entity';
import { MonthSnapshotEntity } from '../packages/month-snapshot.entity';
import { ContractMonthRowEntity } from '../packages/contract-month-row.entity';
import { CityEntity } from '../cities/city.entity';
import { SoftDeleteFlag } from '@biz-reporting/shared-types';
import type { DashboardStats, AdminBusinessSummaryResponse, AdminBusinessSummaryItem } from '@biz-reporting/shared-types';

/** 旧快照 contractRowsJson 内部行对象结构 */
type SnapshotContractRowLike = {
  contractId?: unknown;
  completionAmount?: unknown;
};

/**
 * Dashboard 聚合查询服务
 *
 * 指标口径（基于 annual_report_packages 的真实聚合）：
 * - totalCities:           当年有年度报表包的城市数
 * - totalContracts:        COUNT(contracts) WHERE is_deleted = 0
 * - reportedThisMonth:     month_snapshots ↑ annual_report_packages 中当月有快照的城市去重数
 * - overdueNotSubmitted:   totalCities - reportedThisMonth
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(AnnualPackageEntity)
    private readonly packageRepo: Repository<AnnualPackageEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepo: Repository<ContractEntity>,
    @InjectRepository(AllocationEntity)
    private readonly allocationRepo: Repository<AllocationEntity>,
    @InjectRepository(MonthSnapshotEntity)
    private readonly snapshotRepo: Repository<MonthSnapshotEntity>,
    @InjectRepository(ContractMonthRowEntity)
    private readonly monthRowRepo: Repository<ContractMonthRowEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
  ) {}

  async getStats(year: number, month: number): Promise<DashboardStats> {
    // totalCities: 当年有 annual_report_packages 的城市数
    const raw = await this.packageRepo
      .createQueryBuilder('p')
      .select('COUNT(DISTINCT p.cityId)', 'count')
      .where('p.reportYear = :year', { year })
      .getRawOne<{ count: string }>();

    const totalCities = raw ? Number(raw.count) : 0;

    const totalContracts = await this.contractRepo.count({
      where: { isDeleted: SoftDeleteFlag.NOT_DELETED },
    });

    // reportedThisMonth: 联表年度包，确保与 totalCities 同基线
    const snapshotRaw = await this.snapshotRepo
      .createQueryBuilder('s')
      .innerJoin(AnnualPackageEntity, 'p', 'p.cityId = s.cityId AND p.reportYear = s.reportYear')
      .select('COUNT(DISTINCT s.cityId)', 'count')
      .where('s.reportYear = :year AND s.belongMonth = :month', {
        year,
        month,
      })
      .getRawOne<{ count: string }>();

    const reportedThisMonth = snapshotRaw ? Number(snapshotRaw.count) : 0;

    return {
      totalCities,
      totalContracts,
      reportedThisMonth,
      overdueNotSubmitted: totalCities - reportedThisMonth,
    };
  }

  // ============================================================
  // Admin 经营汇总总览
  // ============================================================

  /**
   * 获取 Admin 经营汇总总览（按城市维度）
   *
   * 返回 cities 表中所有城市，即使没有快照也返回一行（金额为 0）。
   * 旧快照兼容：如果 snapshot 没有 orderGrossProfit，从 contractRowsJson 回算。
   *
   * 数据来源优先级：
   * 1. month_snapshots 快照（城市用户正式上报）
   * 2. report_contract_monthly_rows 月度数据行（历史补录导入，如城市报表导入）
   */
  async getBusinessSummary(year: number): Promise<AdminBusinessSummaryResponse> {
    const cities = await this.cityRepo.find({
      order: { sortOrder: 'ASC', id: 'ASC' },
    });

    // 批量查询当年快照
    const snapshots = await this.snapshotRepo.find({
      where: { reportYear: year },
    });

    // 按 cityId 分组快照
    const snapshotMap = new Map<number, typeof snapshots>();
    const cityIdsWithSnapshots = new Set<number>();
    for (const s of snapshots) {
      cityIdsWithSnapshots.add(s.cityId);
      const list = snapshotMap.get(s.cityId) || [];
      list.push(s);
      snapshotMap.set(s.cityId, list);
    }

    // 查询无快照但年度包下有 monthly_rows 数据的城市（历史补录导入）
    const packages = await this.packageRepo.find({ where: { reportYear: year } });
    const packagesWithoutSnapshots = packages.filter((p) => !cityIdsWithSnapshots.has(p.cityId));
    const monthlyRowsMap = new Map<number, ContractMonthRowEntity[]>();
    if (packagesWithoutSnapshots.length > 0) {
      const pkgIds = packagesWithoutSnapshots.map((p) => p.id);
      const rows = await this.monthRowRepo.find({
        where: { packageId: In(pkgIds) },
      });
      for (const row of rows) {
        const list = monthlyRowsMap.get(row.packageId) || [];
        list.push(row);
        monthlyRowsMap.set(row.packageId, list);
      }
    }
    // 按 cityId 索引：cityId → monthlyRows
    const monthlyRowsByCity = new Map<number, ContractMonthRowEntity[]>();
    for (const pkg of packagesWithoutSnapshots) {
      const rows = monthlyRowsMap.get(pkg.id);
      if (rows && rows.length > 0) {
        monthlyRowsByCity.set(pkg.cityId, rows);
      }
    }

    // 批量查询各城市分配合同数（过滤软删除）
    const contractCountMap = await this.getContractCountMap();

    const items: AdminBusinessSummaryItem[] = [];

    for (const city of cities) {
      const citySnapshots = snapshotMap.get(city.id) || [];
      const cityMonthlyRows = monthlyRowsByCity.get(city.id) || [];
      const item = await this.calculateCityItem(
        year, city, citySnapshots, cityMonthlyRows, contractCountMap,
      );
      items.push(item);
    }

    // 计算总计行
    const totals = this.calculateTotals(items);

    return { year, items, totals };
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 计算单个城市的汇总行
   *
   * @param snapshots     城市用户上报的快照（含成本/毛利等完整数据）
   * @param monthlyRows   历史补录导入的月度行（仅 completionAmount + acceptanceAmount）
   */
  private async calculateCityItem(
    year: number,
    city: CityEntity,
    snapshots: MonthSnapshotEntity[],
    monthlyRows: ContractMonthRowEntity[],
    contractCountMap: Map<number, number>,
  ): Promise<AdminBusinessSummaryItem> {
    let completionTotal = 0;
    let acceptanceTotal = 0;
    let costTotal = 0;
    let orderGrossProfit = 0;

    // 来源 1：快照（城市用户正式上报）
    for (const s of snapshots) {
      const summary = s.summaryJson as Record<string, unknown> | null;
      if (!summary) continue;

      completionTotal += this.toFiniteNumber(summary.completionTotal);
      acceptanceTotal += this.toFiniteNumber(summary.acceptanceTotal);
      costTotal += this.toFiniteNumber(summary.costTotal);

      const ogp = this.toFiniteNumber(summary.orderGrossProfit);
      if (ogp !== 0 || 'orderGrossProfit' in summary) {
        orderGrossProfit += ogp;
      } else {
        orderGrossProfit += await this.calculateFallbackOrderGrossProfit(
          city.id,
          s.contractRowsJson,
        );
      }
    }

    // 来源 2：月度数据行（历史补录导入，如城市报表导入）
    // 仅在快照为空时使用，避免重复计算
    if (snapshots.length === 0 && monthlyRows.length > 0) {
      completionTotal = monthlyRows.reduce(
        (s, r) => s + this.toFiniteNumber(r.completionAmount), 0,
      );
      acceptanceTotal = monthlyRows.reduce(
        (s, r) => s + this.toFiniteNumber(r.acceptanceAmount), 0,
      );
      // 从 monthly_rows 推算订单毛利：∑(completionAmount × allocation.rate)
      orderGrossProfit = await this.calculateMonthlyRowsOrderGrossProfit(city.id, monthlyRows);
      // monthly_rows 不含成本数据
      costTotal = 0;
    }

    const netProfit = orderGrossProfit - costTotal;
    const costRate = this.safeDivide(costTotal, completionTotal);
    const costIncomeRate = this.safeDivide(costTotal, orderGrossProfit);
    const netProfitRate = this.safeDivide(netProfit, completionTotal);

    return {
      cityId: city.id,
      cityName: city.name,
      completionTotal,
      acceptanceTotal,
      orderGrossProfit,
      costTotal,
      costRate,
      costIncomeRate,
      netProfit,
      netProfitRate,
      submittedMonthCount: snapshots.length,
      contractCount: contractCountMap.get(city.id) ?? 0,
    };
  }

  /**
   * 计算总计行
   */
  private calculateTotals(items: AdminBusinessSummaryItem[]): AdminBusinessSummaryResponse['totals'] {
    const completionTotal = items.reduce((s, i) => s + i.completionTotal, 0);
    const acceptanceTotal = items.reduce((s, i) => s + i.acceptanceTotal, 0);
    const orderGrossProfit = items.reduce((s, i) => s + i.orderGrossProfit, 0);
    const costTotal = items.reduce((s, i) => s + i.costTotal, 0);
    const netProfit = orderGrossProfit - costTotal;

    return {
      completionTotal,
      acceptanceTotal,
      orderGrossProfit,
      costTotal,
      netProfit,
      costRate: this.safeDivide(costTotal, completionTotal),
      costIncomeRate: this.safeDivide(costTotal, orderGrossProfit),
      netProfitRate: this.safeDivide(netProfit, completionTotal),
      cityCount: items.length,
      submittedMonthCount: items.reduce((s, i) => s + i.submittedMonthCount, 0),
      contractCount: items.reduce((s, i) => s + i.contractCount, 0),
    };
  }

  /**
   * 查询各城市有效合同分配数（过滤软删除合同）
   */
  private async getContractCountMap(): Promise<Map<number, number>> {
    const raw = await this.allocationRepo
      .createQueryBuilder('a')
      .innerJoin(ContractEntity, 'c', 'c.id = a.contractId AND c.is_deleted = 0')
      .select('a.cityId', 'cityId')
      .addSelect('COUNT(a.id)', 'count')
      .groupBy('a.cityId')
      .getRawMany<{ cityId: string; count: string }>();

    const map = new Map<number, number>();
    for (const r of raw) {
      map.set(Number(r.cityId), Number(r.count));
    }
    return map;
  }

  /**
   * 旧快照兼容：从 snapshot.contractRowsJson 回算 orderGrossProfit
   *
   * 用 snapshot.cityId + contractId 查 allocation.rate，
   * 缺失 allocation 时按 0 处理（不抛错）。
   */
  private async calculateFallbackOrderGrossProfit(
    cityId: number,
    contractRowsJson: unknown,
  ): Promise<number> {
    if (!Array.isArray(contractRowsJson) || contractRowsJson.length === 0) {
      return 0;
    }

    const rows = contractRowsJson.filter((r): r is SnapshotContractRowLike =>
      typeof r === 'object' && r !== null,
    );

    if (rows.length === 0) return 0;

    const contractIds = rows
      .map((r) => Number(r.contractId))
      .filter((id) => Number.isFinite(id) && id > 0);

    const allocations = contractIds.length > 0
      ? await this.allocationRepo.find({
          where: { cityId, contractId: In(contractIds) },
        })
      : [];
    const allocMap = new Map(allocations.map((a) => [Number(a.contractId), a]));

    let total = 0;
    for (const row of rows) {
      const contractId = Number(row.contractId);
      if (!Number.isFinite(contractId) || contractId <= 0) continue;

      const completionAmount = this.toFiniteNumber(row.completionAmount);
      const alloc = allocMap.get(contractId);
      if (!alloc) continue; // 旧快照兼容：缺失 allocation 按 0 处理

      total += completionAmount * Number(alloc.rate);
    }

    return total;
  }

  /**
   * 从 monthly_rows 推算订单毛利
   *
   * 对每条月度行，查 allocation.rate，计算 completionAmount × rate 的全年累计。
   * 使用 contractId 查 allocation，若为 null 则尝试 cityAllocationId 直接查询。
   * 缺失 allocation 时按 0 处理。
   */
  private async calculateMonthlyRowsOrderGrossProfit(
    cityId: number,
    rows: ContractMonthRowEntity[],
  ): Promise<number> {
    // 收集所有 unique contractId
    const contractIds = [...new Set(
      rows.map((r) => r.contractId).filter((id): id is number => id !== null),
    )];
    if (contractIds.length === 0) return 0;

    const allocations = contractIds.length > 0
      ? await this.allocationRepo.find({
          where: { cityId, contractId: In(contractIds) },
        })
      : [];
    const allocMap = new Map(allocations.map((a) => [Number(a.contractId), a]));

    let total = 0;
    for (const row of rows) {
      if (row.contractId === null) continue;
      const alloc = allocMap.get(Number(row.contractId));
      if (!alloc) continue;
      total += this.toFiniteNumber(row.completionAmount) * Number(alloc.rate);
    }
    return total;
  }

  /** 安全数字转换 */
  private toFiniteNumber(value: unknown): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  /** 安全除法（分母为 0 返回 0） */
  private safeDivide(numerator: number, denominator: number): number {
    if (denominator === 0 || !Number.isFinite(denominator)) return 0;
    const result = numerator / denominator;
    return Number.isFinite(result) ? result : 0;
  }
}
