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

    // 查询 3 张行表的草稿数据
    const contractRows = await this.contractRowRepo.find({
      where: { packageId, monthNo },
    });

    // 无合同行时从合同分配自动初始化
    let resolvedContractRows = contractRows;
    if (contractRows.length === 0) {
      const allocations = await this.allocationRepo.find({
        where: { cityId: pkg.cityId },
      });
      if (allocations.length > 0) {
        // 注意: allocation.contractId 是 bigint → JS string；contract.id 是 PrimaryGeneratedColumn → number
        const contractIds = allocations.map((a) => Number(a.contractId));
        const contracts = await this.contractRepo.find({
          where: { id: In(contractIds) },
        });
        const contractMap = new Map(contracts.map((c) => [c.id, c]));

        const newRows: ContractMonthRowEntity[] = [];
        for (const alloc of allocations) {
          const contract = contractMap.get(Number(alloc.contractId));
          if (contract && !contract.isDeleted) {
            newRows.push(
              this.contractRowRepo.create({
                packageId,
                contractId: alloc.contractId,
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
          resolvedContractRows = newRows;
        }
      }
    }

    // 数据一致性：过滤掉已软删除合同的旧月度行（预防脏数据）
    if (resolvedContractRows.length > 0) {
      const rowContractIds = resolvedContractRows.map((r) => Number(r.contractId));
      const validContracts = await this.contractRepo.find({
        where: { id: In(rowContractIds), isDeleted: SoftDeleteFlag.NOT_DELETED },
        select: ['id'],
      });
      const validIdSet = new Set(validContracts.map((c) => Number(c.id)));
      resolvedContractRows = resolvedContractRows.filter((r) =>
        validIdSet.has(Number(r.contractId)),
      );
    }

    const costRows = await this.costRowRepo.find({
      where: { packageId, monthNo },
    });
    const maintenanceRows = await this.maintenanceRowRepo.find({
      where: { packageId, monthNo },
    });

    // 检查是否已有提交快照（已提交=锁定基础状态）
    const existingSnapshot = await this.snapshotRepo.findOne({
      where: { packageId, belongMonth: monthNo },
    });

    let isLocked = false;
    let lockReason: string | null = null;

    if (existingSnapshot) {
      // 已提交过 → 默认锁定，检查是否有有效解锁授权
      const activeGrant = await this.unlockGrantRepo.findOne({
        where: {
          packageId,
          monthNo,
          expiresAt: MoreThan(new Date()),
        },
      });

      if (!activeGrant) {
        isLocked = true;
        lockReason = '该月已提交，如需修改请联系管理员申请解锁';
      }
      // 有有效授权 → 保持 isLocked=false，可编辑
    }

    return {
      packageId: pkg.id,
      cityId: pkg.cityId,
      reportYear: pkg.reportYear,
      status: pkg.status,
      monthNo,
      contractRows: resolvedContractRows.map((r) => ({
        contractId: r.contractId,
        contractCode: r.contractCodeSnapshot,
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

    // 计算汇总（正确公式：grossProfit = completionTotal - costTotal）
    const completionTotal = dto.contractRows.reduce((sum, r) => sum + (r.completionAmount || 0), 0);
    const acceptanceTotal = dto.contractRows.reduce((sum, r) => sum + (r.acceptanceAmount || 0), 0);
    const costTotal = dto.costRows.reduce((sum, r) => sum + (r.amount || 0), 0);

    return {
      belongMonth: dto.monthNo,
      completionTotal,
      acceptanceTotal,
      costTotal,
      grossProfit: completionTotal - costTotal,
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

    // 3. 生成不可变快照（JSON 序列化全部数据）
    const isOverdue = this.isMonthOverdue(dto.monthNo);
    const snapshot = this.snapshotRepo.create({
      packageId,
      cityId: pkg.cityId,
      reportYear: pkg.reportYear,
      belongMonth: dto.monthNo,
      actualSubmittedAt: new Date(),
      isOverdue: isOverdue ? 1 : 0,
      summaryJson: {
        completionTotal: dto.contractRows.reduce((s, r) => s + (r.completionAmount || 0), 0),
        acceptanceTotal: dto.contractRows.reduce((s, r) => s + (r.acceptanceAmount || 0), 0),
        costTotal: dto.costRows.reduce((s, r) => s + (r.amount || 0), 0),
        grossProfit:
          dto.contractRows.reduce((s, r) => s + (r.completionAmount || 0), 0) -
          dto.costRows.reduce((s, r) => s + (r.amount || 0), 0),
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

    const packages = await this.packageRepo.find({
      where: { reportYear: currentYear },
    });

    const cities = await this.cityRepo.find();
    const cityMap = new Map(cities.map((c) => [c.id, c.name]));

    // 批量查询当月快照
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

    const items: AdminPackageItem[] = packages.map((pkg) => ({
      id: pkg.id,
      cityId: pkg.cityId,
      cityName: cityMap.get(pkg.cityId) ?? `城市#${pkg.cityId}`,
      reportYear: pkg.reportYear,
      status: pkg.status,
      currentMonthSubmitted: submittedCityIds.has(pkg.cityId),
      submittedMonthCount: snapshotCounts.get(pkg.cityId) || 0,
      lastUpdatedBy: pkg.lastUpdatedBy,
      lastUpdatedAt: pkg.lastUpdatedAt?.toISOString() ?? null,
      createdAt: pkg.createdAt.toISOString(),
      updatedAt: pkg.updatedAt.toISOString(),
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
