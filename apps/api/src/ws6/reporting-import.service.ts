/**
 * 城市报表导入解析器（历史补录）
 *
 * 解析上传的合同订单明细 Excel，按管理员指定的城市+年份，
 * 将月度立项完工金额/验收审定金额写入 report_contract_monthly_rows。
 *
 * Excel 列结构（合同订单明细表）：
 *   Col 0: 地市（移动/铁塔等运营商）
 *   Col 1: 合同名称
 *   Col 2: 合同编码
 *   Col 3-4:  年累计 — 立项完工金额 / 验收审定金额
 *   Col 5-28: 1月~12月 — 每月 × 立项完工金额 / 验收审定金额
 *   Row 1: 表头行1（地市/合同名称/合同编码/年累计/1月/2月...）
 *   Row 2: 表头行2（立项完工金额/验收审定金额...）
 *   Row 3+: 数据行
 */
import * as XLSX from 'xlsx';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ContractEntity } from '../contracts/contract.entity';
import { ContractMonthRowEntity } from '../packages/contract-month-row.entity';
import { AnnualPackageEntity } from '../packages/annual-package.entity';
import { AllocationEntity } from '../contracts/allocation.entity';
import { PackageStatus } from '@biz-reporting/shared-types';

/** 单行解析结果 */
interface ParsedReportingRow {
  contractCode: string;
  contractName: string;
  /** monthNo -> { completionAmount, acceptanceAmount } */
  monthlyData: Record<number, { completionAmount: number; acceptanceAmount: number }>;
  excelRow: number;
}

export interface ReportingPreviewResult {
  contracts: Array<{
    contractCode: string;
    contractName: string;
    monthsWithData: number[];
    excelRow: number;
  }>;
  totalRows: number;
  errors: Array<{ row: number; message: string }>;
}

export interface ReportingExecuteResult {
  successCount: number;
  failCount: number;
  errors: Array<{ row: number; message: string }>;
}

@Injectable()
export class ReportingImportService {
  private readonly logger = new Logger(ReportingImportService.name);

  constructor(
    @InjectRepository(ContractEntity)
    private readonly contractRepo: Repository<ContractEntity>,
    @InjectRepository(ContractMonthRowEntity)
    private readonly monthRowRepo: Repository<ContractMonthRowEntity>,
    @InjectRepository(AnnualPackageEntity)
    private readonly packageRepo: Repository<AnnualPackageEntity>,
    @InjectRepository(AllocationEntity)
    private readonly allocationRepo: Repository<AllocationEntity>,
  ) {}

  /** 解析并返回预览结果（不写入 DB） */
  async preview(fileBuffer: Buffer): Promise<ReportingPreviewResult> {
    const parsed = this.parseBuffer(fileBuffer);
    return {
      contracts: parsed.rows.map((r) => ({
        contractCode: r.contractCode,
        contractName: r.contractName,
        monthsWithData: Object.keys(r.monthlyData).map(Number).sort((a, b) => a - b),
        excelRow: r.excelRow,
      })),
      totalRows: parsed.totalRows,
      errors: parsed.errors,
    };
  }

  /**
   * 执行导入：将解析的数据写入目标城市的 annual_report_packages + report_contract_monthly_rows
   * @param filePath 临时文件路径
   * @param cityId 目标城市 ID（管理员指定）
   * @param reportYear 目标年份
   * @param operatorUserId 操作人
   */
  async execute(
    fileBuffer: Buffer,
    cityId: number,
    reportYear: number,
    operatorUserId: number,
  ): Promise<ReportingExecuteResult> {
    const parsed = this.parseBuffer(fileBuffer);
    const result: ReportingExecuteResult = { successCount: 0, failCount: 0, errors: [...parsed.errors] };

    if (parsed.rows.length === 0) {
      if (result.errors.length === 0) {
        result.errors.push({ row: 0, message: '没有可导入的数据行' });
      }
      return result;
    }

    // 1. 查找或创建年度包
    let pkg = await this.packageRepo.findOne({
      where: { cityId, reportYear },
    });
    if (!pkg) {
      pkg = this.packageRepo.create({
        cityId,
        reportYear,
        status: PackageStatus.DRAFT,
        lastUpdatedBy: operatorUserId,
      });
      pkg = await this.packageRepo.save(pkg);
    }

    // 2. 批量查合同（IN 查询，避免 OR 数组写法）
    const contractCodes = [...new Set(parsed.rows.map((r) => r.contractCode))];
    const contracts = contractCodes.length > 0
      ? await this.contractRepo.find({ where: { contractCode: In(contractCodes) } })
      : [];
    const contractMap = new Map(contracts.map((c) => [c.contractCode, c]));

    // 3. 查该城市的所有分配
    const contractIds = contracts.map((c) => c.id);
    const allocations = contractIds.length > 0
      ? await this.allocationRepo.find({ where: { contractId: In(contractIds), cityId } })
      : [];
    const allocByContractId = new Map<number, AllocationEntity>();
    for (const a of allocations) {
      allocByContractId.set(a.contractId, a);
    }

    // 4. 逐行写入月份数据
    for (const row of parsed.rows) {
      const contract = contractMap.get(row.contractCode);
      if (!contract) {
        result.errors.push({ row: row.excelRow, message: `合同 ${row.contractCode} 不存在，跳过` });
        result.failCount++;
        continue;
      }

      const alloc = allocByContractId.get(contract.id);
      if (!alloc) {
        result.errors.push({ row: row.excelRow, message: `合同 ${row.contractCode} 未分配到此城市，跳过` });
        result.failCount++;
        continue;
      }

      // 逐月写入
      for (const [monthNoStr, data] of Object.entries(row.monthlyData)) {
        const monthNo = Number(monthNoStr);
        try {
          // 查找是否已有该月数据
          const existing = await this.monthRowRepo.findOne({
            where: {
              packageId: pkg.id,
              contractCodeSnapshot: row.contractCode,
              monthNo,
            },
          });

          if (existing) {
            // 更新
            existing.completionAmount = data.completionAmount;
            existing.acceptanceAmount = data.acceptanceAmount;
            await this.monthRowRepo.save(existing);
          } else {
            // 新建
            const monthRow = this.monthRowRepo.create({
              packageId: pkg.id,
              contractId: contract.id,
              contractCodeSnapshot: row.contractCode,
              contractNameSnapshot: row.contractName,
              cityAllocationId: alloc.id,
              monthNo,
              completionAmount: data.completionAmount,
              acceptanceAmount: data.acceptanceAmount,
            });
            await this.monthRowRepo.save(monthRow);
          }
          result.successCount++;
        } catch (err) {
          result.errors.push({
            row: row.excelRow,
            message: `合同 ${row.contractCode} 第${monthNo}月写入失败: ${err instanceof Error ? err.message : String(err)}`,
          });
          result.failCount++;
        }
      }
    }

    return result;
  }

  // ==================== 内部解析 ====================

  /** 月份列起始索引：Col 5 = 1月-立项完工金额, Col 6 = 1月-验收审定金额 */
  private readonly MONTH_COL_START = 5;
  /** 每月占 2 列（立项完工金额 + 验收审定金额） */
  private readonly COLS_PER_MONTH = 2;

  private parseBuffer(fileBuffer: Buffer): {
    rows: ParsedReportingRow[];
    errors: Array<{ row: number; message: string }>;
    totalRows: number;
  } {
    const rows: ParsedReportingRow[] = [];
    const errors: Array<{ row: number; message: string }> = [];

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    } catch (err) {
      errors.push({ row: 0, message: `无法读取文件: ${err instanceof Error ? err.message : String(err)}` });
      return { rows, errors, totalRows: 0 };
    }

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows: (unknown[] | undefined)[] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

    // 数据行从第 3 行开始（跳过 2 行表头）
    const DATA_START_ROW = 2; // 0-based index, row 3 in Excel

    for (let i = DATA_START_ROW; i < rawRows.length; i++) {
      const raw = rawRows[i];
      if (!raw) continue;
      const excelRow = i + 1; // Excel 行号（1-based）

      const contractCode = String(raw[2] ?? '').trim();
      if (!contractCode) {
        errors.push({ row: excelRow, message: '合同编码为空，跳过' });
        continue;
      }

      const contractName = String(raw[1] ?? '').trim() || contractCode;

      // 解析月度数据
      const monthlyData: Record<number, { completionAmount: number; acceptanceAmount: number }> = {};
      for (let m = 1; m <= 12; m++) {
        const compIdx = this.MONTH_COL_START + (m - 1) * this.COLS_PER_MONTH;
        const acceptIdx = compIdx + 1;

        const compVal = this.toNumber(raw[compIdx]);
        const acceptVal = this.toNumber(raw[acceptIdx]);

        // 只在有数据时记录（不为空且 > 0）
        if (compVal !== null || acceptVal !== null) {
          monthlyData[m] = {
            completionAmount: compVal ?? 0,
            acceptanceAmount: acceptVal ?? 0,
          };
        }
      }

      rows.push({
        contractCode,
        contractName,
        monthlyData,
        excelRow,
      });
    }

    return { rows, errors, totalRows: rawRows.length };
  }

  private toNumber(val: unknown): number | null {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return Math.round(val * 100) / 100;
    if (typeof val === 'string') {
      const n = Number(val.replace(/,/g, ''));
      return isNaN(n) ? null : Math.round(n * 100) / 100;
    }
    return null;
  }
}
