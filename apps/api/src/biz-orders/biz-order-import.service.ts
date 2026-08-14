import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {
  ORDER_TEMPLATE_COLUMNS, ORDER_TEMPLATE_COLUMN_COUNT, ORDER_TEMPLATE_SHEET_COUNT,
  ORDER_TEMPLATE_COLUMN_INDEX_MAP, ORDER_FILE_MAX_BYTES, ORDER_FILE_MAX_ROWS, ORDER_FILE_ALLOWED_EXT,
  OrderBatchStatus,
} from '@biz-reporting/shared-types';
import { readWorkbookSafe } from '../common/files/workbook-policy';
import { BizOrderImportBatchEntity } from '../orders/biz-order-import-batch.entity';
import { BizOrderRowEntity } from '../orders/biz-order-row.entity';
import { BizOrderImportErrorEntity } from '../orders/biz-order-import-error.entity';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizContractFeeRateEntity } from '../contracts/biz-contract-fee-rate.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { CityEntity } from '../main-data/city.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { BizContractsService } from '../biz-contracts/biz-contracts.service';

interface PendingRow {
  sourceRowNo: number;
  raw: string[];
  provinceId: string | null;
  cityId: string | null;
  contractId: string | null;
  orderTimeStd: Date | null;
  businessMonth: string | null;
  completionAmountFen: number | null;
  feeRateSnapshotBp: number | null;
  grossProfitFen: number | null;
  error?: { type: string; field: string; message: string };
}

/**
 * 订单域服务（新基线 M4）
 * 基线：01 §5 / 04 §4 / 05 / 07 TABLE 5
 * 关键规则：
 *  - 仅 super_admin/admin 上传；.xlsx、单工作表、≤50MB、≤20 万行；
 *  - 34 列模板列名/列数/顺序严格匹配；上传即导入确认（无内容审核）；
 *  - 整批校验：任一错误 → FAILED 零业务行写入 + 错误报告；
 *  - 请求幂等（idempotency_key）+ 文件哈希+最大下单时间防重（DB 唯一约束）；
 *  - 不做业务去重；正/零/负金额全部入账；两级超额不阻断导入（标识动态计算）；
 *  - 批次作废/恢复仅 super_admin；原始行永久保留；临时文件任务结束后删除。
 */
@Injectable()
export class BizOrderImportService {
  constructor(
    @InjectRepository(BizOrderImportBatchEntity)
    private readonly batchRepo: Repository<BizOrderImportBatchEntity>,
    @InjectRepository(BizOrderRowEntity)
    private readonly rowRepo: Repository<BizOrderRowEntity>,
    @InjectRepository(BizOrderImportErrorEntity)
    private readonly errorRepo: Repository<BizOrderImportErrorEntity>,
    @InjectRepository(BizContractEntity)
    private readonly contractRepo: Repository<BizContractEntity>,
    @InjectRepository(BizContractCityAllocationEntity)
    private readonly allocRepo: Repository<BizContractCityAllocationEntity>,
    @InjectRepository(BizContractFeeRateEntity)
    private readonly feeRateRepo: Repository<BizContractFeeRateEntity>,
    @InjectRepository(ProvinceEntity)
    private readonly provinceRepo: Repository<ProvinceEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(BizOperationLogEntity)
    private readonly opLogRepo: Repository<BizOperationLogEntity>,
    private readonly dataSource: DataSource,
    private readonly contracts: BizContractsService,
  ) {}

  private async recordOp(operatorId: string, actionType: string, targetId: string, resultStatus = 'success'): Promise<void> {
    await this.opLogRepo.save({
      id: randomUUID(), operatorUserId: operatorId, actionType,
      targetType: 'order_batch', targetId, resultStatus,
    });
  }

  /** 保存上传文件到受控临时目录（FACT_SOURCE_STORAGE_ROOT 或系统临时目录） */
  private saveTempFile(buffer: Buffer, batchId: string): { filePath: string; fileHash: string } {
    const root = process.env.FACT_SOURCE_STORAGE_ROOT || tmpdir();
    const dir = path.join(root, 'order-uploads');
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${batchId}${ORDER_FILE_ALLOWED_EXT}`);
    const hash = createHash('sha256').update(buffer).digest('hex');
    writeFileSync(filePath, buffer);
    return { filePath, fileHash: hash };
  }

  /** 上传：创建批次（PARSING）→ 后台解析；返回批次 ID 供轮询 */
  async upload(authUserId: string, file: Express.Multer.File, idempotencyKey: string): Promise<BizOrderImportBatchEntity> {
    if (!file) throw new BadRequestException('缺少上传文件');
    const filename = (file.originalname ?? 'upload.xlsx').trim();
    if (!filename.toLowerCase().endsWith(ORDER_FILE_ALLOWED_EXT)) throw new BadRequestException('仅支持 .xlsx 文件');
    const maxBytes = Number(process.env.ORDER_UPLOAD_MAX_BYTES || ORDER_FILE_MAX_BYTES);
    if (!file.buffer || file.buffer.length > maxBytes) throw new BadRequestException('文件超过 50MB 上限');

    // 幂等：相同请求键返回原批次
    const existing = await this.batchRepo.findOneBy({ idempotencyKey });
    if (existing) return existing;

    // 保存临时文件（校验失败时也删除）
    const tempBatchId = randomUUID();
    const { filePath, fileHash } = this.saveTempFile(file.buffer, tempBatchId);

    // 解析最小元数据：最大下单时间（防重第二指纹）
    let maxOrderTime: Date | null = null;
    try {
      const wb = readWorkbookSafe(file.buffer, { maxRowsPerSheet: ORDER_FILE_MAX_ROWS + 1 });
      maxOrderTime = this.extractMaxOrderTime(wb);
    } catch (e) {
      rmSync(filePath, { force: true });
      throw e;
    }

    // 重复文件：文件哈希 + 最大下单时间（两者均相同才阻止；DB 唯一约束兜底）
    const dup = await this.batchRepo.findOneBy({ fileHash, maxOrderTime: maxOrderTime ?? undefined });
    if (dup) {
      rmSync(filePath, { force: true });
      throw new BadRequestException(`重复文件：已存在批次 ${dup.id}（相同文件与最大下单时间）`);
    }

    const batch = await this.batchRepo.save({
      id: randomUUID(),
      filename,
      fileHash,
      maxOrderTime,
      idempotencyKey,
      status: OrderBatchStatus.PARSING,
      totalRows: 0,
      importedRows: 0,
      uploadedBy: authUserId,
      tempFilePath: filePath,
    });

    // 后台异步解析（单实例进程内任务；幂等与唯一约束保障重试安全）
    void this.processBatch(batch.id).catch((err: unknown) => {
      void this.failBatch(batch.id, err instanceof Error ? err.message : String(err));
    });
    return batch;
  }

  /** 后台解析：结构校验 → 整批校验 → 全过才写入（零业务行部分写入） */
  private async processBatch(batchId: string): Promise<void> {
    const batch = await this.batchRepo.findOneBy({ id: batchId });
    if (!batch || batch.status !== OrderBatchStatus.PARSING) return;

    const filePath = batch.tempFilePath;
    if (!filePath || !existsSync(filePath)) {
      await this.failBatch(batchId, '临时文件缺失');
      return;
    }

    let wb: XLSX.WorkBook;
    try {
      wb = readWorkbookSafe(readFileSync(filePath), { maxRowsPerSheet: ORDER_FILE_MAX_ROWS + 1 });
    } catch (e) {
      await this.failBatch(batchId, e instanceof Error ? e.message : '文件解析失败');
      return;
    }

    // 1. 结构校验：单工作表 + 34 列 + 表头严格匹配
    const structureError = this.assertTemplateStructure(wb);
    if (structureError) {
      await this.failBatch(batchId, structureError);
      return;
    }

    // 2. 预加载映射
    const provinceByName = new Map<string, string>();
    for (const p of await this.provinceRepo.find()) provinceByName.set(p.name, p.id);
    const cityByProvinceName = new Map<string, string>();
    for (const c of await this.cityRepo.find()) cityByProvinceName.set(`${c.provinceId}|${c.name}`, c.id);
    const contractByNo = new Map<string, { id: string; provinceId: string }>();
    for (const c of await this.contractRepo.find()) contractByNo.set(c.contractNo, { id: c.id, provinceId: c.provinceId });
    const allocSet = new Set<string>();
    for (const a of await this.allocRepo.find({ where: { status: 'active' } })) allocSet.add(`${a.contractId}|${a.cityId}`);
    const feeRatesByContractCity = new Map<string, BizContractFeeRateEntity[]>();
    for (const f of await this.feeRateRepo.find()) {
      const key = `${f.contractId}|${f.cityId}`;
      const list = feeRatesByContractCity.get(key) ?? [];
      list.push(f);
      feeRatesByContractCity.set(key, list);
    }

    // 3. 逐行解析 + 校验
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
    const dataRows = rows.slice(1); // 去掉表头
    if (dataRows.length > ORDER_FILE_MAX_ROWS) {
      await this.failBatch(batchId, `数据行数 ${dataRows.length} 超过 20 万行上限`);
      return;
    }
    if (dataRows.length === 0) {
      await this.failBatch(batchId, '文件无数据行');
      return;
    }

    const pending: PendingRow[] = [];
    const errors: Array<{ type: string; rowNo: number | null; field: string | null; message: string }> = [];

    dataRows.forEach((row, idx) => {
      const sourceRowNo = idx + 2;
      const raw = Array.isArray(row) ? row.map((v) => (v === null || v === undefined ? '' : String(v).trim())) : [];
      if (raw.length === 0 || raw.every((v) => v === '')) return; // 跳过空行
      if (raw.length !== ORDER_TEMPLATE_COLUMN_COUNT) {
        errors.push({ type: 'structure', rowNo: sourceRowNo, field: null, message: `行宽 ${raw.length} 不等于 34 列` });
        return;
      }
      const p: PendingRow = { sourceRowNo, raw, provinceId: null, cityId: null, contractId: null, orderTimeStd: null, businessMonth: null, completionAmountFen: null, feeRateSnapshotBp: null, grossProfitFen: null };

      const provinceName = raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['省份名称']];
      const cityName = raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['地市名称']];
      const contractNo = raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['合同编号']];
      const orderTimeRaw = raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['下单时间']];
      const amountRaw = raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['含税总金额']];

      const provinceId = provinceName ? provinceByName.get(provinceName) : undefined;
      if (!provinceName || !provinceId) { p.error = { type: 'province', field: '省份名称', message: `省份「${provinceName || ''}」无法映射` }; pending.push(p); return; }
      p.provinceId = provinceId;

      const cityId = cityName ? cityByProvinceName.get(`${provinceId}|${cityName}`) : undefined;
      if (!cityName || !cityId) { p.error = { type: 'city', field: '地市名称', message: `地市「${cityName || ''}」无法映射到省份` }; pending.push(p); return; }
      p.cityId = cityId;

      const contract = contractNo ? contractByNo.get(contractNo) : undefined;
      if (!contractNo || !contract) { p.error = { type: 'contract', field: '合同编号', message: `合同「${contractNo || ''}」不存在` }; pending.push(p); return; }
      p.contractId = contract.id;
      if (contract.provinceId !== provinceId) { p.error = { type: 'contract', field: '合同编号', message: `合同「${contractNo}」不属于该省份` }; pending.push(p); return; }

      if (!allocSet.has(`${contract.id}|${cityId}`)) { p.error = { type: 'alloc', field: '地市名称', message: `合同「${contractNo}」未分配该地市` }; pending.push(p); return; }

      const orderTime = this.parseOrderTime(orderTimeRaw);
      if (!orderTime) { p.error = { type: 'time', field: '下单时间', message: `下单时间「${orderTimeRaw || ''}」无法解析` }; pending.push(p); return; }
      p.orderTimeStd = orderTime;
      p.businessMonth = `${orderTime.getFullYear()}-${String(orderTime.getMonth() + 1).padStart(2, '0')}`;

      // F 列金额：空/非数值 → 错误；正/零/负全部入账（DEV-034）
      const amount = amountRaw === '' ? NaN : Number(amountRaw);
      if (!Number.isFinite(amount)) { p.error = { type: 'amount', field: '含税总金额', message: `金额「${amountRaw}」不是有效数值` }; pending.push(p); return; }
      p.completionAmountFen = Math.round(amount * 100);

      // 费率快照：≤ 业务月份的最大生效费率
      const rates = feeRatesByContractCity.get(`${contract.id}|${cityId}`) ?? [];
      const effective = rates.filter((r) => r.effectiveMonth <= p.businessMonth!).sort((a, b) => b.effectiveMonth.localeCompare(a.effectiveMonth))[0];
      if (!effective) { p.error = { type: 'rate', field: '管理费率', message: `合同「${contractNo}」地市在 ${p.businessMonth} 无生效费率` }; pending.push(p); return; }
      p.feeRateSnapshotBp = effective.rateBp;
      p.grossProfitFen = Math.round((p.completionAmountFen * effective.rateBp) / 10000);

      pending.push(p);
    });

    for (const p of pending) if (p.error) errors.push({ type: p.error.type, rowNo: p.sourceRowNo, field: p.error.field, message: p.error.message });

    // 4. 任一错误 → FAILED 零写入 + 错误报告
    if (errors.length > 0) {
      await this.failBatch(batchId, `校验失败 ${errors.length} 条`, errors);
      return;
    }

    // 5. 全过 → 事务插入 + IMPORTED
    batch.totalRows = pending.length;
    batch.importedRows = pending.length;
    await this.dataSource.transaction(async (manager) => {
      // SQLite/MySQL 变量数上限：300 行 × ~60 列 = 18k 参数，兼容 SQLITE_MAX_VARIABLE_NUMBER
      const chunk = 300;
      for (let i = 0; i < pending.length; i += chunk) {
        const slice = pending.slice(i, i + chunk);
        await manager.createQueryBuilder().insert().into(BizOrderRowEntity).values(
          slice.map((p) => ({
            id: randomUUID(),
            batchId,
            sourceRowNo: p.sourceRowNo,
            provinceName: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['省份名称']] || null,
            cityName: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['地市名称']] || null,
            purchaseOrderNo: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['采购订单编号']] || null,
            supplierName: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['供应商名称']] || null,
            orderMainStatus: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['订单主状态']] || null,
            taxInclusiveAmountRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['含税总金额']] || null,
            materialName: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['物料名称']] || null,
            materialCode: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['物料编码']] || null,
            contractNoRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['合同编号']] || null,
            netPriceRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['净价']] || null,
            freightRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['运保费']] || null,
            constructionRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['建安费']] || null,
            feeType: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['费用类型']] || null,
            taxRateRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['税率']] || null,
            taxAmountRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['税额']] || null,
            taxInclusiveUnitPriceRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['含税单价']] || null,
            quantityRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['采购数量']] || null,
            unit: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['计量单位']] || null,
            receiverNameEnc: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['收货人']] || null,
            receiverPhoneEnc: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['收货人联系方式']] || null,
            receiverAddressEnc: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['收货人详细地址']] || null,
            notifier: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['通知人']] || null,
            orderTimeRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['下单时间']] || null,
            noticeTimeRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['通知时间']] || null,
            postscript: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['附言信息']] || null,
            projectCode: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['项目编号']] || null,
            projectName: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['项目名称']] || null,
            siteCode: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['站址编号']] || null,
            siteInfo: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['站址信息']] || null,
            receiptStatus: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['收货状态']] || null,
            productName: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['商品名称']] || null,
            productCode: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['商品编号']] || null,
            sourceTagFlag: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['物料源头贴签标识']] || null,
            resampleFlag: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['是否补样订单']] || null,
            provinceId: p.provinceId,
            cityId: p.cityId,
            contractId: p.contractId,
            orderTimeStd: p.orderTimeStd,
            businessMonth: p.businessMonth,
            completionAmountFen: p.completionAmountFen,
            feeRateSnapshotBp: p.feeRateSnapshotBp,
            grossProfitFen: p.grossProfitFen,
            cityOverrunFlag: false,
            contractOverrunFlag: false,
            isVoid: false,
            sourceRowJson: p.raw,
          })),
        ).execute();
      }
      batch.status = OrderBatchStatus.IMPORTED;
      await manager.save(batch);
    });

    this.cleanupTempFile(batch);
  }

  /** 批次失败：零写入（从未插入行）→ 状态 FAILED + 错误报告 + 删除临时文件 */
  private async failBatch(batchId: string, reason: string, errors: Array<{ type: string; rowNo: number | null; field: string | null; message: string }> = []): Promise<void> {
    const batch = await this.batchRepo.findOneBy({ id: batchId });
    if (!batch) return;
    if (errors.length > 0) {
      // 错误报告分块保存，避免超 SQLite/MySQL 变量数上限（7 万行级失败文件）
      const entities = errors.map((e) => ({
        id: randomUUID(), batchId, errorType: e.type, rowNo: e.rowNo, field: e.field, message: e.message,
      }));
      for (let i = 0; i < entities.length; i += 300) {
        await this.errorRepo.save(entities.slice(i, i + 300));
      }
    }
    batch.status = OrderBatchStatus.FAILED;
    batch.failureReason = reason.slice(0, 2000);
    await this.batchRepo.save(batch);
    this.cleanupTempFile(batch);
  }

  /** 删除临时文件（任务结束），保留路径供异常审计 */
  private cleanupTempFile(batch: BizOrderImportBatchEntity): void {
    if (batch.tempFilePath && existsSync(batch.tempFilePath)) {
      rmSync(batch.tempFilePath, { force: true });
    }
  }

  /** 结构校验：单工作表 + 34 列 + 表头逐一严格匹配 */
  private assertTemplateStructure(wb: XLSX.WorkBook): string | null {
    if (wb.SheetNames.length !== ORDER_TEMPLATE_SHEET_COUNT) {
      return `文件必须包含 ${ORDER_TEMPLATE_SHEET_COUNT} 个工作表（当前 ${wb.SheetNames.length}）`;
    }
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
    const header = (rows[0] ?? []).map((v) => String(v).trim());
    if (header.length !== ORDER_TEMPLATE_COLUMN_COUNT) {
      return `表头列数 ${header.length} 不等于 ${ORDER_TEMPLATE_COLUMN_COUNT}`;
    }
    for (let i = 0; i < ORDER_TEMPLATE_COLUMN_COUNT; i++) {
      if (header[i] !== ORDER_TEMPLATE_COLUMNS[i]) {
        return `第 ${i + 1} 列表头「${header[i]}」与冻结模板「${ORDER_TEMPLATE_COLUMNS[i]}」不一致`;
      }
    }
    return null;
  }

  /** 解析下单时间（兼容 Excel 日期序列号/字符串） */
  private parseOrderTime(raw: string): Date | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    // 字符串日期
    if (/^\d{4}[-/.]/.test(trimmed)) {
      const parsed = new Date(trimmed);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    // Excel 日期序列号（25569 = 1970-01-01 的 Excel 序列号）
    const num = Number(trimmed);
    if (Number.isFinite(num) && num > 20000 && num < 60000) {
      return new Date(Math.round((num - 25569) * 86400 * 1000));
    }
    return null;
  }

  /** 提取文件内最大下单时间（防重第二指纹） */
  private extractMaxOrderTime(wb: XLSX.WorkBook): Date | null {
    if (wb.SheetNames.length !== 1) return null;
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
    const header = (rows[0] ?? []).map((v) => String(v).trim());
    const colIdx = header.findIndex((h) => h === '下单时间');
    if (colIdx < 0) return null;
    let max: Date | null = null;
    for (let i = 1; i < rows.length; i++) {
      const cell = rows[i]?.[colIdx];
      const raw = cell === null || cell === undefined ? '' : String(cell).trim();
      const d = this.parseOrderTime(raw);
      if (d && (!max || d.getTime() > max.getTime())) max = d;
    }
    return max;
  }

  // ================= 查询与作废/恢复 =================

  async listBatches(): Promise<BizOrderImportBatchEntity[]> {
    return this.batchRepo.find({ order: { createdAt: 'DESC' } });
  }

  async batchDetail(id: string): Promise<{ batch: BizOrderImportBatchEntity; errors: BizOrderImportErrorEntity[]; rowCount: number }> {
    const batch = await this.batchRepo.findOneBy({ id });
    if (!batch) throw new NotFoundException('批次不存在');
    const errors = await this.errorRepo.findBy({ batchId: id });
    const rowCount = await this.rowRepo.countBy({ batchId: id });
    return { batch, errors, rowCount };
  }

  /** 批次作废（仅 super_admin）：原始行 is_void=true 退出统计；保留行/账号/时间 */
  async voidBatch(authUserId: string, isSuperAdmin: boolean, id: string, reason: string): Promise<void> {
    if (!isSuperAdmin) throw new ForbiddenException('仅 super_admin 可作废订单批次');
    if (!reason?.trim()) throw new BadRequestException('作废原因必填');
    const batch = await this.batchRepo.findOneBy({ id });
    if (!batch) throw new NotFoundException('批次不存在');
    if (batch.status !== OrderBatchStatus.IMPORTED) throw new BadRequestException('仅已导入批次可作废');
    await this.dataSource.transaction(async (manager) => {
      await manager.update(BizOrderRowEntity, { batchId: id }, { isVoid: true, voidReason: reason });
      batch.status = OrderBatchStatus.VOIDED;
      batch.voidedBy = authUserId;
      batch.voidedAt = new Date();
      batch.voidReason = reason;
      await manager.save(batch);
    });
    await this.recordOp(authUserId, 'order_batch.void', id);
  }

  /** 批次恢复（仅 super_admin）：恢复原始行统计 */
  async restoreBatch(authUserId: string, isSuperAdmin: boolean, id: string): Promise<void> {
    if (!isSuperAdmin) throw new ForbiddenException('仅 super_admin 可恢复订单批次');
    const batch = await this.batchRepo.findOneBy({ id });
    if (!batch) throw new NotFoundException('批次不存在');
    if (batch.status !== OrderBatchStatus.VOIDED) throw new BadRequestException('仅已作废批次可恢复');
    await this.dataSource.transaction(async (manager) => {
      await manager.update(BizOrderRowEntity, { batchId: id }, { isVoid: false, voidReason: null });
      batch.status = OrderBatchStatus.IMPORTED;
      batch.voidedBy = null;
      batch.voidedAt = null;
      batch.voidReason = null;
      batch.restoredAt = new Date();
      await manager.save(batch);
    });
    await this.recordOp(authUserId, 'order_batch.restore', id);
  }

  /** 订单行列表（敏感列脱敏：无 SENSITIVE_ORDER_PERMISSION 时遮罩） */
  async listRows(filter: { batchId?: string; cityId?: string; overrun?: 'city' | 'contract' | 'any' }, sensitive: boolean) {
    const qb = this.rowRepo.createQueryBuilder('r');
    if (filter.batchId) qb.andWhere('r.batchId = :batchId', { batchId: filter.batchId });
    if (filter.cityId) qb.andWhere('r.cityId = :cityId', { cityId: filter.cityId });
    if (filter.overrun === 'city') qb.andWhere('r.cityOverrunFlag = 1');
    if (filter.overrun === 'contract') qb.andWhere('r.contractOverrunFlag = 1');
    if (filter.overrun === 'any') qb.andWhere('(r.cityOverrunFlag = 1 OR r.contractOverrunFlag = 1)');
    const rows = await qb.orderBy('r.sourceRowNo', 'ASC').limit(500).getMany();
    return rows.map((r) => ({
      id: r.id,
      batchId: r.batchId,
      sourceRowNo: r.sourceRowNo,
      purchaseOrderNo: r.purchaseOrderNo,
      supplierName: r.supplierName,
      projectName: r.projectName,
      cityName: r.cityName,
      businessMonth: r.businessMonth,
      completionAmountFen: r.completionAmountFen != null ? Number(r.completionAmountFen) : null,
      feeRateSnapshotBp: r.feeRateSnapshotBp,
      grossProfitFen: r.grossProfitFen != null ? Number(r.grossProfitFen) : null,
      isVoid: r.isVoid,
      receiverPhone: sensitive ? r.receiverPhoneEnc : this.maskPhone(r.receiverPhoneEnc),
      receiverAddress: sensitive ? r.receiverAddressEnc : this.maskAddress(r.receiverAddressEnc),
    }));
  }

  private maskPhone(v: string | null): string | null {
    if (!v || v.length < 7) return v;
    return `${v.slice(0, 3)}****${v.slice(-4)}`;
  }

  private maskAddress(v: string | null): string | null {
    if (!v) return null;
    return v.length <= 6 ? '****' : `${v.slice(0, 3)}****${v.slice(-3)}`;
  }
}
