/**
 * 合同导入解析器
 *
 * 解析上传的 Excel 文件，提取合同信息并写入 contracts / contract_city_allocations 表。
 *
 * 列映射（按表头名称匹配，不依赖列位置）：
 *   甲方合同编号 → contractCode
 *   合同名称     → contractName
 *   合同金额（含税，万元）→ contractAmount（万元→元）
 *   税率         → rate
 *   签订日期     → signDate
 *   合同到期时间 → expireDate
 *   地市         → 城市（去括号匹配 + 多城市拆分，金额均分）
 */
import * as XLSX from 'xlsx';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ContractEntity } from '../contracts/contract.entity';
import { AllocationEntity } from '../contracts/allocation.entity';
import { CityEntity } from '../cities/city.entity';

/** 单行解析结果（含城市拆分后信息） */
export interface ParsedContractRow {
  contractCode: string;
  contractName: string;
  contractAmount: number;    // 元 (已从万元转换)
  rate: number | null;
  signDate: Date | null;
  expireDate: Date | null;
  cityNames: string[];       // 去括号+拆分后的城市名列表
  excelRow: number;          // Excel 行号（用于报错）
}

export interface ContractImportResult {
  contracts: Array<{ contractCode: string; contractName: string; amount: number; cityCount: number; status: string }>;
  errors: Array<{ row: number; message: string }>;
  totalRows: number;
  successCount: number;
  failCount: number;
}

/**
 * 表头名 → 逻辑字段映射（支持别名）
 * 当前支持的两种模板：
 *   1) 原模板（铁塔合同台账）：甲方合同编号 / 合同名称 / 合同金额（含税，万元）...
 *   2) 合同明细汇总：合同编码 / 合同名称 / 合同金额(万元) / 到期时间 ...
 */
const HEADER_MAP: Record<string, string> = {
  '甲方\n合同编号': 'contractCode',
  '甲方合同编号': 'contractCode',
  '合同编码': 'contractCode',
  '合同名称': 'contractName',
  '合同金额\n（含税，万元）': 'contractAmount',
  '合同金额（含税，万元）': 'contractAmount',
  '合同金额(万元)': 'contractAmount',
  '税率': 'rate',
  '签订日期': 'signDate',
  '合同到期时间': 'expireDate',
  '到期时间': 'expireDate',
  '地市': 'city',
};

@Injectable()
export class ContractImportService {
  private readonly logger = new Logger(ContractImportService.name);

  constructor(
    @InjectRepository(ContractEntity)
    private readonly contractRepo: Repository<ContractEntity>,
    @InjectRepository(AllocationEntity)
    private readonly allocationRepo: Repository<AllocationEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
  ) {}

  /** 解析并返回预览结果（不写入 DB） */
  async preview(fileBuffer: Buffer): Promise<ContractImportResult> {
    const parsed = this.parseBuffer(fileBuffer);
    return this.toResult(parsed);
  }

  /** 解析并执行导入（预览确认后触发） */
  async execute(fileBuffer: Buffer, operatorUserId: number): Promise<ContractImportResult> {
    const parsed = this.parseBuffer(fileBuffer);

    // 收集所有城市名 → 批量查 cities 表
    const allCityNames = [...new Set(parsed.rows.flatMap((r) => r.cityNames))];
    const cities = await this.cityRepo.find({ where: { name: In(allCityNames) } });
    const cityMap = new Map(cities.map((c) => [c.name, c]));

    let successCount = 0;
    let failCount = 0;

    for (const row of parsed.rows) {
      try {
        // 检查合同是否已存在
        const existing = await this.contractRepo.findOne({
          where: { contractCode: row.contractCode },
        });
        if (existing) {
          parsed.errors.push({ row: row.excelRow, message: `合同 ${row.contractCode} 已存在，跳过` });
          failCount++;
          continue;
        }

        // 1. 创建合同
        const contract = this.contractRepo.create({
          contractCode: row.contractCode,
          contractName: row.contractName,
          contractAmount: row.contractAmount,
          rate: row.rate ?? 0,
          signDate: row.signDate,
          expireDate: row.expireDate,
          createdBy: operatorUserId,
          updatedBy: operatorUserId,
        });
        const saved = await this.contractRepo.save(contract);

        // 2. 创建地市分配
        const validCities = row.cityNames
          .map((name) => cityMap.get(name))
          .filter((c): c is CityEntity => c !== undefined);

        if (validCities.length === 0) {
          parsed.errors.push({ row: row.excelRow, message: `合同 ${row.contractCode} 无匹配城市，已创建合同但未分配` });
          failCount++;
          continue;
        }

        const perCityAmount = Math.round((row.contractAmount / validCities.length) * 100) / 100;
        const allocations = validCities.map((city) =>
          this.allocationRepo.create({
            contractId: saved.id,
            cityId: city.id,
            cityContractAmount: perCityAmount,
            rate: row.rate ?? 0,
          }),
        );
        await this.allocationRepo.save(allocations);
        successCount++;
      } catch (err) {
        parsed.errors.push({ row: row.excelRow, message: `合同 ${row.contractCode} 写入失败: ${err instanceof Error ? err.message : String(err)}` });
        failCount++;
      }
    }

    return {
      contracts: parsed.rows.map((r) => ({
        contractCode: r.contractCode,
        contractName: r.contractName,
        amount: r.contractAmount,
        cityCount: r.cityNames.length,
        status: 'completed',
      })),
      errors: parsed.errors,
      totalRows: parsed.totalRows,
      successCount,
      failCount,
    };
  }

  /** 从缓存的解析结果执行写入（跳过文件解析，直接落库） */
  async executeFromCache(
    contracts: Array<{ contractCode: string; contractName?: string; amount?: number; cityCount?: number }>,
    operatorUserId: number,
  ): Promise<ContractImportResult> {
    const result: ContractImportResult = {
      contracts: [],
      errors: [],
      totalRows: contracts.length,
      successCount: 0,
      failCount: 0,
    };

    let successCount = 0;
    let failCount = 0;

    for (const c of contracts) {
      try {
        const existing = await this.contractRepo.findOne({
          where: { contractCode: c.contractCode },
        });
        if (existing) {
          result.errors.push({ row: 0, message: `合同 ${c.contractCode} 已存在，跳过` });
          failCount++;
          continue;
        }

        const contract = this.contractRepo.create({
          contractCode: c.contractCode,
          contractName: c.contractName || c.contractCode,
          contractAmount: c.amount ?? 0,
          rate: 0,
          createdBy: operatorUserId,
          updatedBy: operatorUserId,
        });
        await this.contractRepo.save(contract);
        successCount++;
      } catch (err) {
        result.errors.push({ row: 0, message: `合同 ${c.contractCode} 写入失败: ${err instanceof Error ? err.message : String(err)}` });
        failCount++;
      }
    }

    result.contracts = contracts.map((c) => ({
      contractCode: c.contractCode,
      contractName: c.contractName || c.contractCode,
      amount: c.amount ?? 0,
      cityCount: c.cityCount ?? 0,
      status: 'completed',
    }));
    result.successCount = successCount;
    result.failCount = failCount;
    return result;
  }

  // ==================== 内部 ====================

  private parseBuffer(fileBuffer: Buffer): {
    rows: ParsedContractRow[];
    errors: Array<{ row: number; message: string }>;
    totalRows: number;
  } {
    const rows: ParsedContractRow[] = [];
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
    // 用 header:1 读原始行数组，跳过合并标题行
    const rawRows: (unknown[] | undefined)[] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

    // 找到真正的表头行（必须包含 "合同编码" 或 "甲方合同编号" 等关键词）
    let headerRowIndex = -1;
    const headerKeywords = ['合同编码', '甲方合同编号', '合同名称'];
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!row) continue;
      const rowStr = row.map((v) => String(v ?? '')).join('');
      if (headerKeywords.some((kw) => rowStr.includes(kw))) {
        headerRowIndex = i;
        break;
      }
    }

    if (headerRowIndex === -1) {
      errors.push({ row: 0, message: '无法识别表头行，请确认文件包含"合同编码"或"甲方合同编号"列' });
      return { rows, errors, totalRows: 0 };
    }

    // 构建列名映射：列索引 → 逻辑字段名
    const headerRow = rawRows[headerRowIndex] || [];
    const colMap = new Map<number, string>();
    for (let c = 0; c < headerRow.length; c++) {
      const headerName = String(headerRow[c] ?? '').replace(/\n/g, '').trim();
      if (!headerName) continue;
      for (const [key, mapped] of Object.entries(HEADER_MAP)) {
        if (key === headerName) {
          colMap.set(c, mapped);
          break;
        }
      }
    }

    // 解析数据行
    for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
      const raw = rawRows[i];
      if (!raw) continue;
      const excelRow = i + 1; // Excel 行号（1-based）

      // 将原始数组 + colMap 转成 { fieldName: value } 对象
      const obj: Record<string, unknown> = {};
      for (const [colIdx, fieldName] of colMap) {
        obj[fieldName] = raw[colIdx] ?? null;
      }

      try {
        const contractCode = this.strVal(obj, 'contractCode');
        if (!contractCode) {
          errors.push({ row: excelRow, message: '甲方合同编号为空，跳过' });
          continue;
        }

        const contractName = this.strVal(obj, 'contractName') || contractCode;
        const amountWan = this.numVal(obj, 'contractAmount');
        const contractAmount = amountWan !== null ? Math.round(amountWan * 10000 * 100) / 100 : 0;
        const rate = this.numVal(obj, 'rate');
        const signDate = this.dateVal(obj, 'signDate');
        const expireDate = this.dateVal(obj, 'expireDate');
        const cityRaw = this.strVal(obj, 'city') || '';

        // 地市解析
        const cityNames = this.parseCities(cityRaw);

        rows.push({
          contractCode,
          contractName,
          contractAmount,
          rate,
          signDate,
          expireDate,
          cityNames,
          excelRow,
        });
      } catch (err) {
        errors.push({ row: excelRow, message: `解析失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    return { rows, errors, totalRows: rawRows.length };
  }

  /** 转为外部 ContractImportResult */
  private toResult(parsed: {
    rows: ParsedContractRow[];
    errors: Array<{ row: number; message: string }>;
    totalRows: number;
  }): ContractImportResult {
    return {
      contracts: parsed.rows.map((r) => ({
        contractCode: r.contractCode,
        contractName: r.contractName,
        amount: r.contractAmount,
        cityCount: r.cityNames.length,
        status: 'previewed',
      })),
      errors: parsed.errors,
      totalRows: parsed.totalRows,
      successCount: parsed.rows.length,
      failCount: parsed.errors.length,
    };
  }

  /** 解析地市列：去括号 → 按分隔符拆分 */
  private parseCities(raw: string): string[] {
    const stripped = raw.replace(/[（(][^)）]*[)）]/g, '').trim();
    return stripped.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
  }

  // ---- 类型转换辅助 ----
  private strVal(obj: Record<string, unknown>, key: string): string | null {
    for (const [header, mapped] of Object.entries(HEADER_MAP)) {
      if (mapped === key) {
        const v = obj[header];
        if (v !== null && v !== undefined) return String(v).trim();
      }
    }
    const v = obj[key];
    if (v !== null && v !== undefined) return String(v).trim();
    return null;
  }

  private numVal(obj: Record<string, unknown>, key: string): number | null {
    const s = this.strVal(obj, key);
    if (s === null) return null;
    const n = Number(s);
    return isNaN(n) ? null : n;
  }

  private dateVal(obj: Record<string, unknown>, key: string): Date | null {
    for (const [header, mapped] of Object.entries(HEADER_MAP)) {
      if (mapped === key) {
        const v = obj[header];
        if (v instanceof Date) return v;
        if (typeof v === 'number') {
          const d = new Date((v - 25569) * 86400 * 1000);
          return isNaN(d.getTime()) ? null : d;
        }
        if (typeof v === 'string') {
          const d = new Date(v);
          return isNaN(d.getTime()) ? null : d;
        }
      }
    }
    const v = obj[key];
    if (v instanceof Date) return v;
    return null;
  }
}
