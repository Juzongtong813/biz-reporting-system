import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContractEntity } from '../contracts/contract.entity';
import { AnnualPackageEntity } from '../packages/annual-package.entity';
import { MonthSnapshotEntity } from '../packages/month-snapshot.entity';
import { SoftDeleteFlag } from '@biz-reporting/shared-types';
import type { DashboardStats } from '@biz-reporting/shared-types';

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
    @InjectRepository(MonthSnapshotEntity)
    private readonly snapshotRepo: Repository<MonthSnapshotEntity>,
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
}
