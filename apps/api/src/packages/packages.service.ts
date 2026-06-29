import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThan } from 'typeorm';
import { AnnualPackageEntity } from './annual-package.entity';
import { ContractMonthRowEntity } from './contract-month-row.entity';
import { CostMonthRowEntity } from './cost-month-row.entity';
import { MaintenanceMonthRowEntity } from './maintenance-month-row.entity';
import { MonthSnapshotEntity } from './month-snapshot.entity';
import { MonthUnlockGrantEntity } from './month-unlock-grant.entity';
import { ContractEntity } from '../contracts/contract.entity';
import { AllocationEntity } from '../contracts/allocation.entity';
import { CityEntity } from '../cities/city.entity';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import { PackageStatus, Role, ContractRowLockStatus, SoftDeleteFlag } from '@biz-reporting/shared-types';
import { VALIDATION_RULES, VALID_COST_CATEGORY_CODES } from '@biz-reporting/shared-constants';
import type {
  DraftSaveRequest,
  SubmitPreviewResponse,
  ReturnToDraftRequest,
  UnlockMonthsRequest,
  OpenCurrentMonthContractRequest,
  AdminPackageItem,
  PaginatedResponse,
} from '@biz-reporting/shared-types';

/** 默认每月截止日期: 每月 10 号 18:00 */
const DEFAULT_DEADLINE_DAY = 10;
const DEFAULT_DEADLINE_HOUR = 18;

/** 旧快照 contractRowsJson 内部行对象结构（unknown 边界类型守卫用） */
type SnapshotContractRowLike = {
  contractId?: unknown;
  completionAmount?: unknown;
};

/**
 * 年度报表包核心服务
 *
 * 业务流程:
 * 1. getCurrentPackage(cityId) — 获取或自动创建当年包
 * 2. getMonthData(pkgId, month) — 读当月草稿数据（含锁定状态检查）
 * 3. draftSave(pkgId, data) — upsert 草稿（3 张行表，含合同快照）
 * 4. submitPreview(pkgId, data) — 校验 + 返回汇总
 * 5. submitMonth(pkgId, data) — 校验通过 → 写快照 + 记录操作日志 + 更新状态
 */
@Injectable()
export class PackagesService {
  constructor(
    @InjectRepository(AnnualPackageEntity)
    private readonly packageRepo: Repository<AnnualPackageEntity>,
    @InjectRepository(ContractMonthRowEntity)
    private readonly contractRowRepo: Repository<ContractMonthRowEntity>,
    @InjectRepository(CostMonthRowEntity)
    private readonly costRowRepo: Repository<CostMonthRowEntity>,
    @InjectRepository(MaintenanceMonthRowEntity)
    private readonly maintenanceRowRepo: Repository<MaintenanceMonthRowEntity>,
    @InjectRepository(MonthSnapshotEntity)
    private readonly snapshotRepo: Repository<MonthSnapshotEntity>,
    @InjectRepository(MonthUnlockGrantEntity)
    private readonly unlockGrantRepo: Repository<MonthUnlockGrantEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepo: Repository<ContractEntity>,
    @InjectRepository(AllocationEntity)
    private readonly allocationRepo: Repository<AllocationEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(OperationLogEntity)
    private readonly operationLogRepo: Repository<OperationLogEntity>,
  ) {}

  // ============================================================
  // 公有方法
  // ============================================================

  /**
   * 获取城市当前年度的包，不存在则自动创建
   */
  async getOrCreateCurrent(cityId: number, year: number): Promise<AnnualPackageEntity> {
    let pkg = await this.packageRepo.findOne({
      where: { cityId, reportYear: year },
    });

    if (!pkg) {
      pkg = this.packageRepo.create({
        cityId,
        reportYear: year,
        status: PackageStatus.DRAFT,
      });
      pkg = await this.packageRepo.save(pkg);
    }

    return pkg;
  }

  /**
   * 获取指定包的各月提交状态（含逾期标记）
   * 返回格式: [{monthNo: 1, submitted: true, overdue: false}, ...]
   */
  async getMonthStatuses(packageId: number): Promise<{monthNo: number; submitted: boolean; overdue: boolean}[]> {
    const snapshots = await this.snapshotRepo.find({
      where: { packageId },
      select: ['belongMonth'],
    });
    const submittedSet = new Set(snapshots.map((s) => s.belongMonth));
    const months: {monthNo: number; submitted: boolean; overdue: boolean}[] = [];
    for (let m = 1; m <= 12; m++) {
      const submitted = submittedSet.has(m);
      const overdue = !submitted && this.isMonthOverdue(m);
      months.push({ monthNo: m, submitted, overdue });
    }
    return months;
  }

  /**
   * 统计该城市有效合同分配数（过滤软删除）
   */
  async getCityContractCount(cityId: number): Promise<number> {
    const raw = await this.allocationRepo
      .createQueryBuilder('a')
      .innerJoin('contracts', 'c', 'c.id = a.contractId AND c.is_deleted = 0')
      .where('a.cityId = :cityId', { cityId })
      .select('COUNT(*)', 'count')
      .getRawOne<{ count: string }>();
    return raw ? Number(raw.count) : 0;
  }

  /**
   * 获取全年累计汇总（仅基于已提交的 month_snapshots）
   *
   * 旧快照兼容策略：
   * - 旧快照可能没有 orderGrossProfit / netProfit 等新字段
   * - 遇到旧快照时通过 contractRowsJson + allocation.rate 回算
   * - 缺失 allocation 时按 0 处理（不抛错，确保首页不崩溃）
   * - grossProfit 永远等于 orderGrossProfit，不独立累加
   */
  async getYearSummary(packageId: number): Promise<{
    completionTotal: number;
    acceptanceTotal: number;
    costTotal: number;
    orderGrossProfit: number;
    grossProfit: number;
    costRate: number;
    costIncomeRate: number;
    netProfit: number;
    netProfitRate: number;
  }> {
    const pkg = await this.findPackageOrThrow(packageId);

    const snapshots = await this.snapshotRepo.find({
      where: { packageId },
      select: ['cityId', 'summaryJson', 'contractRowsJson'],
    });

    let completionTotal = 0;
    let acceptanceTotal = 0;
    let costTotal = 0;
    let orderGrossProfit = 0;

    for (const s of snapshots) {
      const summary = s.summaryJson as Record<string, unknown> | null;
      if (!summary) continue;

      completionTotal += this.toFiniteNumber(summary.completionTotal);
      acceptanceTotal += this.toFiniteNumber(summary.acceptanceTotal);
      costTotal += this.toFiniteNumber(summary.costTotal);

      const ogp = this.toFiniteNumber(summary.orderGrossProfit);
      if (ogp !== 0 || 'orderGrossProfit' in summary) {
        // 新快照：取 snapshot 中存的值
        orderGrossProfit += ogp;
      } else {
        // 旧快照兼容：从 contractRowsJson 回算
        orderGrossProfit += await this.calculateSnapshotOrderGrossProfitFallback(
          pkg,
          s.contractRowsJson,
        );
      }
    }

    const grossProfit = orderGrossProfit; // 强制等于 orderGrossProfit

    // 全年的比例基于全年累计值重新计算
    const costRate = completionTotal !== 0 ? costTotal / completionTotal : 0;
    const costIncomeRate = orderGrossProfit !== 0 ? costTotal / orderGrossProfit : 0;
    const netProfit = orderGrossProfit - costTotal;
    const netProfitRate = completionTotal !== 0 ? netProfit / completionTotal : 0;

    const safe = (v: number) => (Number.isFinite(v) ? v : 0);

    return {
      completionTotal,
      acceptanceTotal,
      costTotal,
      orderGrossProfit,
      grossProfit,
      costRate: safe(costRate),
      costIncomeRate: safe(costIncomeRate),
      netProfit,
      netProfitRate: safe(netProfitRate),
    };
  }

  /**
   * 获取指定月度的填报数据（草稿或最新快照）
   *
   * 锁定逻辑：
   * - 已提交月份（存在快照）→ isLocked=true，数据来自快照只读
   * - 存在有效解锁授权（month_unlock_grants 且未过期）→ isLocked=false，可编辑
   * - 其他情况 → isLocked=false，可编辑
   */
  async getMonthData(packageId: number, monthNo: number, user: any) {
    const pkg = await this.findPackageOrThrow(packageId);
    this.verifyCityOwnership(pkg, user);

    // 已有快照且无有效解锁 → 跳过懒加载初始化（提交月走 read-only）
    const existingSnapshot = await this.snapshotRepo.findOne({
      where: { packageId, belongMonth: monthNo },
      select: ['id'],
    });
    if (existingSnapshot) {
      const activeGrant = await this.unlockGrantRepo.findOne({
        where: { packageId, monthNo, expiresAt: MoreThan(new Date()) },
        select: ['id'],
      });
      const isLocked = !activeGrant;
      if (isLocked) {
        // 已锁定提交月 → 只查已有行，不自动初始化
        const contractRows = await this.contractRowRepo.find({
          where: { packageId, monthNo },
        });
        const costRowsPromise = this.costRowRepo.find({ where: { packageId, monthNo } });
        const maintenanceRowsPromise = this.maintenanceRowRepo.find({ where: { packageId, monthNo } });
        const [costRows, maintenanceRows] = await Promise.all([costRowsPromise, maintenanceRowsPromise]);

        return this.assembleMonthResponse(pkg, monthNo, contractRows, costRows, maintenanceRows, true, '该月已提交，如需修改请联系管理员申请解锁');
      }
    }

    // 查询 3 张行表的草稿数据
    const existingContractRows = await this.contractRowRepo.find({
      where: { packageId, monthNo },
      order: { id: 'ASC' },
    });

    // 过滤：仅保留合同仍存在且未软删除的行
    const existingContractIds = existingContractRows
      .map((row) => Number(row.contractId))
      .filter((id) => Number.isFinite(id));

    const activeContracts = existingContractIds.length > 0
      ? await this.contractRepo.find({
          where: { id: In(existingContractIds), isDeleted: SoftDeleteFlag.NOT_DELETED },
          select: ['id'],
        })
      : [];

    const activeContractIdSet = new Set(activeContracts.map((c) => Number(c.id)));

    let resolvedContractRows = existingContractRows.filter((row) =>
      activeContractIdSet.has(Number(row.contractId)),
    );

    // 无有效合同行时从合同分配自动初始化
    if (resolvedContractRows.length === 0) {
      const allocations = await this.allocationRepo.find({
        where: { cityId: pkg.cityId },
      });
      if (allocations.length > 0) {
        const allocContractIds = allocations.map((a) => Number(a.contractId));
        const contracts = await this.contractRepo.find({
          where: { id: In(allocContractIds), isDeleted: SoftDeleteFlag.NOT_DELETED },
        });
        const contractMap = new Map(contracts.map((c) => [c.id, c]));

        const newRows: ContractMonthRowEntity[] = [];
        for (const alloc of allocations) {
          const cId = Number(alloc.contractId);
          const contract = contractMap.get(cId);
          if (contract) {
            newRows.push(
              this.contractRowRepo.create({
                packageId,
                contractId: cId,
                contractCodeSnapshot: contract.contractCode,
                contractNameSnapshot: contract.contractName,
                cityAllocationId: alloc.id,
                monthNo,
                completionAmount: 0,
                acceptanceAmount: 0,
                isLocked: ContractRowLockStatus.UNLOCKED,
                lockReason: null,
              }),
            );
          }
        }
        if (newRows.length > 0) {
          await this.contractRowRepo.save(newRows);
          const allRows = await this.contractRowRepo.find({
            where: { packageId, monthNo },
            order: { id: 'ASC' },
          });
          // 重新验证所有行的合同有效性（re-read 会包含旧脏行）
          const allContractIds = allRows
            .map((row) => Number(row.contractId))
            .filter((id) => Number.isFinite(id));
          const validContracts = allContractIds.length > 0
            ? await this.contractRepo.find({
                where: { id: In(allContractIds), isDeleted: SoftDeleteFlag.NOT_DELETED },
                select: ['id'],
              })
            : [];
          const validIdSet = new Set(validContracts.map((c) => Number(c.id)));
          resolvedContractRows = allRows.filter((row) =>
            validIdSet.has(Number(row.contractId)),
          );
        }
      }
    }

    const [costRows, maintenanceRows] = await Promise.all([
      this.costRowRepo.find({ where: { packageId, monthNo } }),
      this.maintenanceRowRepo.find({ where: { packageId, monthNo } }),
    ]);

    // 检查是否已有提交快照（已提交=锁定基础状态）
    const snapshot = existingSnapshot || await this.snapshotRepo.findOne({
      where: { packageId, belongMonth: monthNo },
      select: ['id'],
    });

    let isLocked = false;
    let lockReason: string | null = null;

    if (snapshot) {
      const activeGrant = await this.unlockGrantRepo.findOne({
        where: {
          packageId,
          monthNo,
          expiresAt: MoreThan(new Date()),
        },
        select: ['id'],
      });

      if (!activeGrant) {
        isLocked = true;
        lockReason = '该月已提交，如需修改请联系管理员申请解锁';
      }
    }

    return this.assembleMonthResponse(pkg, monthNo, resolvedContractRows, costRows, maintenanceRows, isLocked, lockReason);
  }

  /**
   * 组装 getMonthData 的统一响应结构
   */
  private assembleMonthResponse(
    pkg: AnnualPackageEntity,
    monthNo: number,
    contractRows: ContractMonthRowEntity[],
    costRows: any[],
    maintenanceRows: any[],
    isLocked: boolean,
    lockReason: string | null,
  ) {
    return {
      packageId: pkg.id,
      cityId: pkg.cityId,
      reportYear: pkg.reportYear,
      status: pkg.status,
      monthNo,
      contractRows: contractRows.map((r) => ({
        contractId: r.contractId,
        contractCode: r.contractCodeSnapshot,
        contractName: r.contractNameSnapshot,
        completionAmount: r.completionAmount,
        acceptanceAmount: r.acceptanceAmount,
      })),
      costRows: costRows.map((r) => ({
        costCategoryCode: r.costCategoryCode,
        amount: r.amount,
      })),
      maintenanceRow:
        maintenanceRows.length > 0
          ? {
              invoiceTotalPrevYear: maintenanceRows[0].invoiceTotalPrevYear,
              invoiceMonthCountPrevYear: maintenanceRows[0].invoiceMonthCountPrevYear,
              invoiceTotalCurrentYear: maintenanceRows[0].invoiceTotalCurrentYear,
            }
          : null,
      isLocked,
      lockReason,
    };
  }

  /**
   * 获取只读历史月数据（来自快照，不可编辑）
   */
  async getReadOnlySnapshot(packageId: number, monthNo: number, user: any) {
    const pkg = await this.findPackageOrThrow(packageId);
    this.verifyCityOwnership(pkg, user);

    const snapshot = await this.snapshotRepo.findOne({
      where: { packageId, belongMonth: monthNo },
    });

    if (!snapshot) {
      return {
        packageId,
        monthNo,
        isSubmitted: false,
        snapshot: null,
      };
    }

    return {
      packageId,
      monthNo,
      isSubmitted: true,
      snapshot: {
        summary: snapshot.summaryJson,
        contractRows: snapshot.contractRowsJson,
        costRows: snapshot.costRowsJson,
        maintenanceRows: snapshot.maintenanceRowsJson,
        submittedAt: snapshot.actualSubmittedAt,
        isOverdue: snapshot.isOverdue === 1,
      },
    };
  }

  /**
   * 草稿保存（upsert 语义，真正写库）
   *
   * 合同行处理：
   * - 通过 contractId 从 contracts 表查询真实的 contractCode 和 contractName
   * - 将其作为快照存入 contract_code_snapshot / contract_name_snapshot
   * - 确保即使后续合同被修改/删除，历史填报数据不受影响
   */
  async draftSave(packageId: number, dto: DraftSaveRequest, user: any) {
    const pkg = await this.findPackageOrThrow(packageId);
    this.verifyCityOwnership(pkg, user);

    // 检查当月是否已提交且无有效解锁授权
    const existingSnapshot = await this.snapshotRepo.findOne({
      where: { packageId, belongMonth: dto.monthNo },
    });
    if (existingSnapshot) {
      const activeGrant = await this.unlockGrantRepo.findOne({
        where: { packageId, monthNo: dto.monthNo, expiresAt: MoreThan(new Date()) },
      });
      if (!activeGrant) {
        throw new BadRequestException('该月已提交，如需修改请联系管理员申请解锁');
      }
    }

    // 收集所有合同 ID，批量查询合同信息（注意: DTO 中的 contractId 来自 JSON → string）
    const rawContractIds = (dto.contractRows || []).map((r) => r.contractId).filter(Boolean);
    const contractIds = rawContractIds.map((id) => Number(id));
    const contractsMap = new Map<number, ContractEntity>();
    if (contractIds.length > 0) {
      const contracts = await this.contractRepo.find({
        where: { id: In(contractIds) },
      });
      for (const c of contracts) {
        contractsMap.set(c.id, c);
      }
    }

    // 1. Upsert 合同行（用真实合同 code/name 做快照）
    for (const row of dto.contractRows || []) {
      const contract = contractsMap.get(Number(row.contractId));

      if (!contract) {
        throw new BadRequestException(
          `合同 #${row.contractId} 不存在或已删除，无法保存填报数据`,
        );
      }

      const codeSnapshot = contract.contractCode;
      const nameSnapshot = contract.contractName;

      const existing = await this.contractRowRepo.findOne({
        where: {
          packageId,
          contractCodeSnapshot: codeSnapshot,
          monthNo: dto.monthNo,
        },
      });

      if (existing) {
        existing.completionAmount = row.completionAmount;
        existing.acceptanceAmount = row.acceptanceAmount;
        await this.contractRowRepo.save(existing);
      } else {
        await this.contractRowRepo.save(
          this.contractRowRepo.create({
            packageId,
            contractId: row.contractId,
            contractCodeSnapshot: codeSnapshot,
            contractNameSnapshot: nameSnapshot,
            monthNo: dto.monthNo,
            completionAmount: row.completionAmount,
            acceptanceAmount: row.acceptanceAmount,
            isLocked: 0,
          }),
        );
      }
    }

    // 2. Upsert 费用行（按 costCategoryCode）
    for (const row of dto.costRows || []) {
      const existing = await this.costRowRepo.findOne({
        where: {
          packageId,
          monthNo: dto.monthNo,
          costCategoryCode: row.costCategoryCode,
        },
      });

      if (existing) {
        existing.amount = row.amount;
        await this.costRowRepo.save(existing);
      } else {
        await this.costRowRepo.save(
          this.costRowRepo.create({
            packageId,
            monthNo: dto.monthNo,
            costCategoryCode: row.costCategoryCode,
            amount: row.amount,
          }),
        );
      }
    }

    // 3. Upsert 维保行（单条）
    if (dto.maintenanceRow) {
      const existing = await this.maintenanceRowRepo.findOne({
        where: { packageId, monthNo: dto.monthNo },
      });

      if (existing) {
        Object.assign(existing, {
          invoiceTotalPrevYear: dto.maintenanceRow.invoiceTotalPrevYear || 0,
          invoiceMonthCountPrevYear: dto.maintenanceRow.invoiceMonthCountPrevYear || 0,
          invoiceTotalCurrentYear: dto.maintenanceRow.invoiceTotalCurrentYear || 0,
        });
        await this.maintenanceRowRepo.save(existing);
      } else {
        await this.maintenanceRowRepo.save(
          this.maintenanceRowRepo.create({
            packageId,
            monthNo: dto.monthNo,
            invoiceTotalPrevYear: dto.maintenanceRow.invoiceTotalPrevYear || 0,
            invoiceMonthCountPrevYear: dto.maintenanceRow.invoiceMonthCountPrevYear || 0,
            invoiceTotalCurrentYear: dto.maintenanceRow.invoiceTotalCurrentYear || 0,
          }),
        );
      }
    }

    // 更新包的最后修改信息
    await this.packageRepo.update(packageId, {
      lastUpdatedBy: user.userId,
      lastUpdatedAt: new Date(),
    } as any);

    return {
      success: true,
      packageId,
      monthNo: dto.monthNo,
      savedAt: new Date().toISOString(),
    };
  }

  /**
   * 提交预览（仅校验 + 计算汇总，不写库）
   */
  async submitPreview(packageId: number, dto: DraftSaveRequest, user: any): Promise<SubmitPreviewResponse> {
    const pkg = await this.findPackageOrThrow(packageId);
    this.verifyCityOwnership(pkg, user);

    // 校验
    this.validateSubmission(dto);

    // 使用统一公式引擎计算
    const summary = await this.calculateBusinessSummary(
      packageId,
      dto.monthNo,
      dto.contractRows,
      dto.costRows,
    );

    return {
      belongMonth: dto.monthNo,
      ...summary,
      isOverdue: this.isMonthOverdue(dto.monthNo),
    };
  }

  /**
   * 正式提交：校验通过 → 写入 3 张行表 → 生成不可变快照 → 记录操作日志 → 更新包状态
   */
  async submitMonth(packageId: number, dto: DraftSaveRequest, user: any) {
    const pkg = await this.findPackageOrThrow(packageId);
    this.verifyCityOwnership(pkg, user);

    // 1. 校验
    this.validateSubmission(dto);

    // 2. 先执行 draftSave（确保 3 张行表数据是最新的）
    await this.draftSave(packageId, dto, user);

    // 3. 使用统一公式引擎计算 summaryJson
    const isOverdue = this.isMonthOverdue(dto.monthNo);
    const summary = await this.calculateBusinessSummary(
      packageId,
      dto.monthNo,
      dto.contractRows,
      dto.costRows,
    );

    const snapshot = this.snapshotRepo.create({
      packageId,
      cityId: pkg.cityId,
      reportYear: pkg.reportYear,
      belongMonth: dto.monthNo,
      actualSubmittedAt: new Date(),
      isOverdue: isOverdue ? 1 : 0,
      summaryJson: {
        ...summary,
        isOverdue,
      },
      contractRowsJson: dto.contractRows,
      costRowsJson: dto.costRows,
      maintenanceRowsJson: dto.maintenanceRow || null,
      createdBy: user.userId,
    });

    // 如果同月已有快照则替换（先查旧快照ID，再删后插）
    const oldSnapshot = await this.snapshotRepo.findOne({
      where: { packageId, belongMonth: dto.monthNo },
      select: ['id'],
    });
    const oldSnapshotId = oldSnapshot?.id ?? null;

    if (oldSnapshotId) {
      await this.snapshotRepo.delete({ id: oldSnapshotId });
    }
    const savedSnapshot = await this.snapshotRepo.save(snapshot);

    // 记录快照替换审计日志（如果有旧快照被替换）
    if (oldSnapshotId) {
      await this.operationLogRepo.save(
        this.operationLogRepo.create({
          operatorUserId: user.userId,
          operatorCityId: user.cityId || null,
          actionType: 'snapshot_replaced',
          targetType: 'month_snapshot',
          targetId: String(savedSnapshot.id),
          summaryText: `城市 ${pkg.cityId} ${pkg.reportYear} 年 ${dto.monthNo} 月快照替换：old #${oldSnapshotId} → new #${savedSnapshot.id}`,
          beforeDataJson: { snapshotId: oldSnapshotId },
          afterDataJson: { snapshotId: savedSnapshot.id },
          resultStatus: 'success',
        }),
      );
    }

    // 4. 更新包状态为 submitted
    await this.packageRepo.update(packageId, {
      status: PackageStatus.SUBMITTED,
      lastUpdatedBy: user.userId,
      lastUpdatedAt: new Date(),
    } as any);

    // 5. 记录操作日志
    await this.operationLogRepo.save(
      this.operationLogRepo.create({
        operatorUserId: user.userId,
        operatorCityId: user.cityId || null,
        actionType: 'submit_month',
        targetType: 'month_snapshot',
        targetId: String(savedSnapshot.id),
        summaryText: `城市 ${pkg.cityId} 提交 ${pkg.reportYear} 年第 ${dto.monthNo} 月报表${isOverdue ? '（逾期）' : ''}`,
        beforeDataJson: null,
        afterDataJson: {
          packageId,
          monthNo: dto.monthNo,
          isOverdue,
          completionTotal: snapshot.summaryJson.completionTotal,
          costTotal: snapshot.summaryJson.costTotal,
        },
        resultStatus: 'success',
      }),
    );

    return {
      success: true,
      packageId,
      monthNo: dto.monthNo,
      submittedAt: new Date().toISOString(),
      snapshotId: savedSnapshot.id,
    };
  }

  // ============================================================
  // Admin 管理方法
  // ============================================================

  /**
   * 获取所有城市报表包列表（含月度上下文）
   */
  async listAllPackages(): Promise<PaginatedResponse<AdminPackageItem>> {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    // 使用 JOIN 从数据库直接获取城市名称，避免 TypeORM bigint→string 类型不匹配
    const rawRows = await this.packageRepo
      .createQueryBuilder('pkg')
      .leftJoin(CityEntity, 'city', 'city.id = pkg.cityId')
      .select([
        'pkg.id AS id',
        'pkg.city_id AS cityId',
        'city.name AS cityName',
        'pkg.report_year AS reportYear',
        'pkg.status AS status',
        'pkg.last_updated_by AS lastUpdatedBy',
        'pkg.last_updated_at AS lastUpdatedAt',
        'pkg.created_at AS createdAt',
        'pkg.updated_at AS updatedAt',
      ])
      .where('pkg.report_year = :year', { year: currentYear })
      .orderBy('pkg.city_id', 'ASC')
      .getRawMany();

    // 批量查询当月快照和提交计数
    const submittedCityIds = new Set<number>();
    const snapshotCounts = new Map<number, number>();

    const snapshots = await this.snapshotRepo
      .createQueryBuilder('s')
      .select(['s.cityId', 's.belongMonth'])
      .where('s.reportYear = :year', { year: currentYear })
      .getMany();

    for (const s of snapshots) {
      if (s.belongMonth === currentMonth) {
        submittedCityIds.add(s.cityId);
      }
      snapshotCounts.set(
        s.cityId,
        (snapshotCounts.get(s.cityId) || 0) + 1,
      );
    }

    const items: AdminPackageItem[] = rawRows.map((row) => ({
      id: Number(row.id),
      cityId: Number(row.cityId),
      cityName: row.cityName ?? `城市#${row.cityId}`,
      reportYear: Number(row.reportYear),
      status: row.status,
      currentMonthSubmitted: submittedCityIds.has(Number(row.cityId)),
      submittedMonthCount: snapshotCounts.get(Number(row.cityId)) || 0,
      lastUpdatedBy: row.lastUpdatedBy ? Number(row.lastUpdatedBy) : null,
      lastUpdatedAt: row.lastUpdatedAt?.toISOString() ?? null,
      createdAt: row.createdAt?.toISOString() ?? '',
      updatedAt: row.updatedAt?.toISOString() ?? '',
    }));

    return { items, total: items.length, page: 1, pageSize: items.length };
  }

  /**
   * 退回报表包到草稿
   */
  async returnToDraft(
    packageId: number,
    dto: ReturnToDraftRequest,
    user: any,
  ): Promise<{ success: boolean; message: string }> {
    const pkg = await this.findPackageOrThrow(packageId);

    if (pkg.status !== PackageStatus.SUBMITTED) {
      throw new BadRequestException(`报表包 #${packageId} 当前非已提交状态，无法退回`);
    }

    await this.packageRepo.update(packageId, {
      status: PackageStatus.DRAFT,
      lastUpdatedAt: new Date(),
    } as any);

    await this.operationLogRepo.save(
      this.operationLogRepo.create({
        operatorUserId: user?.userId ?? 0,
        actionType: 'return_to_draft',
        targetType: 'annual_report_package',
        targetId: String(packageId),
        summaryText: `管理员退回报表包 #${packageId}（城市 ${pkg.cityId}, ${pkg.reportYear} 年 ${dto.monthNo} 月）：${dto.reason}`,
        resultStatus: 'success',
      }),
    );

    return { success: true, message: `报表包 #${packageId} 已退回到草稿状态` };
  }

  /**
   * 解锁历史月份
   */
  async unlockMonths(
    packageId: number,
    dto: UnlockMonthsRequest,
    user: any,
  ): Promise<{ success: boolean; message: string; unlockedMonths: number[] }> {
    const pkg = await this.findPackageOrThrow(packageId);

    const grants = dto.months.map((monthNo) =>
      this.unlockGrantRepo.create({
        packageId,
        monthNo,
        expiresAt: new Date(dto.expiresAt),
        grantedBy: user?.userId ?? 0,
        reason: dto.reason ?? null,
      }),
    );

    await this.unlockGrantRepo.save(grants);

    await this.operationLogRepo.save(
      this.operationLogRepo.create({
        operatorUserId: user?.userId ?? 0,
        actionType: 'unlock_months',
        targetType: 'month_unlock_grant',
        targetId: String(packageId),
        summaryText: `管理员解锁报表包 #${packageId}（城市 ${pkg.cityId}）月份 [${dto.months.join(', ')}]，有效期至 ${dto.expiresAt}`,
        resultStatus: 'success',
      }),
    );

    return {
      success: true,
      message: `已解锁 ${dto.months.length} 个月份`,
      unlockedMonths: dto.months,
    };
  }

  /**
   * 开放当月新增合同填报权限（仅当前月）
   *
   * 规则：
   * 1. 合同必须属于该地市分配 → 否则 400
   * 2. 重复调用幂等 → 200 提示已开放
   * 3. 仅当月可用 → 非当月 400
   * 4. 年份+月份双校验 → reportYear 必须等于当前年份
   */
  async openCurrentMonthContract(
    packageId: number,
    dto: OpenCurrentMonthContractRequest,
    user: any,
  ): Promise<{ success: boolean; message: string }> {
    const pkg = await this.findPackageOrThrow(packageId);

    // 年份 + 月份双校验
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    if (pkg.reportYear !== currentYear || dto.monthNo !== currentMonth) {
      throw new BadRequestException(
        `openCurrentMonthContract 仅支持当前月（${currentYear}年${currentMonth}月）。` +
        '历史月份修正请使用 unlock-months 接口。',
      );
    }

    // 规则 1：合同归属校验
    const allocation = await this.allocationRepo.findOne({
      where: { contractId: dto.contractId, cityId: pkg.cityId },
    });
    if (!allocation) {
      throw new BadRequestException(
        `合同 #${dto.contractId} 未分配给城市 #${pkg.cityId}，无法开放填报权限`,
      );
    }

    // 查找或创建当月合同行
    let row = await this.contractRowRepo.findOne({
      where: {
        packageId,
        contractId: dto.contractId,
        monthNo: dto.monthNo,
      },
    });

    if (row) {
      // 规则 2：幂等性
      if (row.isLocked === ContractRowLockStatus.UNLOCKED) {
        const hasData = row.completionAmount > 0 || row.acceptanceAmount > 0;
        return {
          success: true,
          message: hasData
            ? '该合同当月已开放且存在填报数据'
            : '该合同当月已处于开放状态，无需重复操作',
        };
      }

      // 锁定 → 解锁
      row.isLocked = ContractRowLockStatus.UNLOCKED;
      row.lockReason = null;
    } else {
      // 行不存在 → 补录（初始值 0）
      const contract = await this.contractRepo.findOne({
        where: { id: dto.contractId, isDeleted: SoftDeleteFlag.NOT_DELETED },
      });
      if (!contract) {
        throw new NotFoundException(`合同 #${dto.contractId} 不存在或已删除`);
      }

      row = this.contractRowRepo.create({
        packageId,
        contractId: dto.contractId,
        contractCodeSnapshot: contract.contractCode,
        contractNameSnapshot: contract.contractName,
        cityAllocationId: allocation.id,
        monthNo: dto.monthNo,
        completionAmount: 0,
        acceptanceAmount: 0,
        isLocked: ContractRowLockStatus.UNLOCKED,
        lockReason: null,
      });
    }

    await this.contractRowRepo.save(row);

    await this.operationLogRepo.save(
      this.operationLogRepo.create({
        operatorUserId: user?.userId ?? 0,
        actionType: 'admin_open_contract',
        targetType: 'contract_month_row',
        targetId: String(row.id),
        summaryText: `管理员开放合同 #${dto.contractId} 在城市 #${pkg.cityId} ${pkg.reportYear} 年 ${dto.monthNo} 月的填报权限`,
        resultStatus: 'success',
      }),
    );

    return {
      success: true,
      message: `合同 #${dto.contractId} 在 ${dto.monthNo} 月的填报权限已开放`,
    };
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 统一经营测算公式引擎
   *
   * 公式口径：
   * - completionTotal = sum(contractRows.completionAmount)
   * - acceptanceTotal = sum(contractRows.acceptanceAmount)
   * - costTotal = sum(costRows.amount)
   * - orderGrossProfit = sum(contractRow.completionAmount × allocation.rate)
   * - grossProfit = orderGrossProfit（保留旧字段名，值等于新口径）
   * - costRate = costTotal / completionTotal
   * - costIncomeRate = costTotal / orderGrossProfit
   * - netProfit = orderGrossProfit - costTotal
   * - netProfitRate = netProfit / completionTotal
   *
   * 除法保护：分母为 0 时返回 0，不返回 NaN / Infinity
   *
   * allocation.rate 查询规则：
   *   allocation.cityId = package.cityId
   *   allocation.contractId = row.contractId
   */
  private async calculateBusinessSummary(
    packageId: number,
    monthNo: number,
    contractRows: { contractId: number; completionAmount: number; acceptanceAmount: number }[],
    costRows: { amount: number }[],
  ): Promise<{
    completionTotal: number;
    acceptanceTotal: number;
    costTotal: number;
    orderGrossProfit: number;
    grossProfit: number;
    costRate: number;
    costIncomeRate: number;
    netProfit: number;
    netProfitRate: number;
  }> {
    const pkg = await this.findPackageOrThrow(packageId);

    // 收集所有 contractId
    const contractIds = contractRows.map((r) => Number(r.contractId)).filter((id) => id > 0);

    // 批量查询 allocation（cityId + contractId）
    const allocations = contractIds.length > 0
      ? await this.allocationRepo.find({
          where: {
            cityId: pkg.cityId,
            contractId: In(contractIds),
          },
        })
      : [];
    const allocMap = new Map(allocations.map((a) => [Number(a.contractId), a]));

    const completionTotal = contractRows.reduce((s, r) => s + Number(r.completionAmount || 0), 0);
    const acceptanceTotal = contractRows.reduce((s, r) => s + Number(r.acceptanceAmount || 0), 0);
    const costTotal = costRows.reduce((s, r) => s + Number(r.amount || 0), 0);

    // 订单毛利 = sum(completionAmount × allocation.rate)
    let orderGrossProfit = 0;
    for (const row of contractRows) {
      const contractId = Number(row.contractId);
      const alloc = allocMap.get(contractId);
      if (!alloc) {
        throw new BadRequestException(
          `合同 #${contractId} 未配置地市分配费率，无法计算订单毛利`,
        );
      }
      orderGrossProfit += Number(row.completionAmount || 0) * Number(alloc.rate);
    }

    const grossProfit = orderGrossProfit; // 保留旧字段名，值等于新口径

    // 除法保护：分母为 0 则返回 0
    const costRate = completionTotal !== 0 ? costTotal / completionTotal : 0;
    const costIncomeRate = orderGrossProfit !== 0 ? costTotal / orderGrossProfit : 0;
    const netProfit = orderGrossProfit - costTotal;
    const netProfitRate = completionTotal !== 0 ? netProfit / completionTotal : 0;

    const safe = (v: number) => (isFinite(v) ? v : 0);

    return {
      completionTotal,
      acceptanceTotal,
      costTotal,
      orderGrossProfit,
      grossProfit,
      costRate: safe(costRate),
      costIncomeRate: safe(costIncomeRate),
      netProfit,
      netProfitRate: safe(netProfitRate),
    };
  }

  /**
   * 安全数字转换：所有从 JSON 读取的数字必须经过此函数
   * - 非数字 / undefined / null / NaN / Infinity 统一返回 0
   */
  private toFiniteNumber(value: unknown): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * 类型守卫：判断 unknown 是否为 SnapshotContractRowLike 结构
   */
  private isSnapshotContractRowLike(value: unknown): value is SnapshotContractRowLike {
    return typeof value === 'object' && value !== null;
  }

  /**
   * 旧快照兼容：从 contractRowsJson 回算 orderGrossProfit
   *
   * 用于年度汇总中旧快照没有 orderGrossProfit 字段的情况。
   * 从 contractRowsJson 读取 contractId + completionAmount，
   * 用 package.cityId + contractId 查 allocation.rate 重新计算。
   *
   * 缺失 allocation 时不抛错，按 0 处理（年度汇总不应因旧数据崩溃）。
   * 与 calculateBusinessSummary 不同——后者对新提交严格抛 400。
   */
  private async calculateSnapshotOrderGrossProfitFallback(
    pkg: AnnualPackageEntity,
    contractRowsJson: unknown,
  ): Promise<number> {
    if (!Array.isArray(contractRowsJson) || contractRowsJson.length === 0) {
      return 0;
    }

    // 用类型守卫过滤出结构正确的行
    const rows = contractRowsJson.filter((row): row is SnapshotContractRowLike =>
      this.isSnapshotContractRowLike(row),
    );

    if (rows.length === 0) return 0;

    const contractIds = rows
      .map((row) => Number(row.contractId))
      .filter((id) => Number.isFinite(id) && id > 0);

    const allocations = contractIds.length > 0
      ? await this.allocationRepo.find({
          where: {
            cityId: pkg.cityId,
            contractId: In(contractIds),
          },
        })
      : [];
    const allocMap = new Map(allocations.map((a) => [Number(a.contractId), a]));

    let total = 0;
    for (const row of rows) {
      const contractId = Number(row.contractId);
      if (!Number.isFinite(contractId) || contractId <= 0) continue;

      const completionAmount = this.toFiniteNumber(row.completionAmount);
      const alloc = allocMap.get(contractId);

      if (!alloc) {
        // 旧快照兼容：缺失 allocation 时无法补算，按 0 处理
        // 新提交场景不会走此分支（calculateBusinessSummary 严格校验）
        continue;
      }

      total += completionAmount * Number(alloc.rate);
    }

    return total;
  }

  private async findPackageOrThrow(id: number): Promise<AnnualPackageEntity> {
    const pkg = await this.packageRepo.findOne({ where: { id } });
    if (!pkg) {
      throw new NotFoundException(`报表包 #${id} 不存在`);
    }
    return pkg;
  }

  /**
   * 地市归属校验
   *
   * city_user 只能访问和操作自己所属地市的包（package.cityId === user.cityId）
   * system_admin 不受此限制
   * 校验失败时抛出 ForbiddenException（HTTP 403）
   */
  private verifyCityOwnership(pkg: AnnualPackageEntity, user: any): void {
    // system_admin 跳过归属校验
    if (user.role === Role.SYSTEM_ADMIN) {
      return;
    }

    const userCityId = user.cityId;
    if (!userCityId || pkg.cityId !== userCityId) {
      throw new ForbiddenException(
        `无权访问该报表包：当前用户城市 ID=${userCityId ?? '未绑定'}，目标包所属城市 ID=${pkg.cityId}`,
      );
    }
  }

  /**
   * 提交前的业务校验
   */
  private validateSubmission(dto: DraftSaveRequest): void {
    if (!dto.monthNo || dto.monthNo < 1 || dto.monthNo > 12) {
      throw new BadRequestException('monthNo 必须为 1-12');
    }

    if (!dto.contractRows || dto.contractRows.length === 0) {
      throw new BadRequestException('至少需要一行合同填报数据');
    }

    // 校验每行合同数据
    for (const row of dto.contractRows) {
      if (row.completionAmount < 0) {
        throw new BadRequestException(`合同行 #${row.contractId}: 完工金额不能小于 0`);
      }
      if (row.acceptanceAmount > row.completionAmount) {
        throw new BadRequestException(`合同行 #${row.contractId}: 审定金额不能大于完工金额`);
      }
    }

    // 校验费用类别完整性（必须包含所有 7 类别）
    if (dto.costRows && dto.costRows.length > 0) {
      const inputCodes = new Set(dto.costRows.map((r) => r.costCategoryCode));
      for (const code of VALID_COST_CATEGORY_CODES) {
        if (!inputCodes.has(code)) {
          throw new BadRequestException(`缺少费用类别: ${code}`);
        }
      }
    }
  }

  /**
   * 判断当月是否已过截止日期
   *
   * 规则：
   * - 截止日期默认为每月 10 号 18:00（可通过城市配置覆盖）
   * - 当前日期 > 当月截止日 18:00 → 当月及之前所有未提交月份均视为逾期
   * - 当前月份之前的月份必然逾期
   * - 当月是否逾期取决于当前时间是否已过截止点
   */
  private isMonthOverdue(monthNo: number): boolean {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // JS month is 0-based

    // 过去的月份必然逾期
    if (monthNo < currentMonth) {
      return true;
    }

    // 未来月份不逾期
    if (monthNo > currentMonth) {
      return false;
    }

    // 当月：判断是否已过截止时间（默认每月10号18:00）
    const deadline = new Date(currentYear, currentMonth - 1, DEFAULT_DEADLINE_DAY, DEFAULT_DEADLINE_HOUR, 0, 0);
    return now > deadline;
  }
}
