import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 合同实体（新基线 biz_contracts）
 * 基线：01 §4 / 03 / 04 §2 / 07 TABLE 4
 * 关键规则：
 *  - 真实合同号全局唯一（业务唯一），系统内部使用 UUID 主键；
 *  - 金额统一整数分（BIGINT），含税合同额为进度唯一分母；
 *  - 合同额仅草稿阶段可修正，生效后永久锁定（amountLocked=true 后禁止修改）；
 *  - 状态机：draft → active → completed / voided；附加标签存 tags（不替代主状态）；
 *  - 补充合同使用自身真实合同号与独立额度，可选 parent_contract_id 关联主合同；
 *  - 合同不可物理删除，只能作废。
 */
@Entity('biz_contracts')
@Index('idx_biz_contracts_status', ['status'])
@Index('idx_biz_contracts_province', ['provinceId'])
@Index('idx_biz_contracts_parent', ['parentContractId'])
export class BizContractEntity {
  /** 系统内部 UUID（对普通用户不可见） */
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 真实合同号，全局唯一（业务唯一键） */
  @Index({ unique: true })
  @Column({ name: 'contract_no', type: 'varchar', length: 100 })
  contractNo: string;

  /** 合同名称 */
  @Column({ name: 'contract_name', type: 'varchar', length: 255 })
  contractName: string;

  /** 含税合同金额（分）。合同进度/剩余额度/满额判定的唯一金额分母 */
  @Column({ name: 'tax_inclusive_amount_fen', type: 'bigint' })
  taxInclusiveAmountFen: number;

  /** 不含税合同金额（分，补充信息，可为空） */
  @Column({ name: 'tax_exclusive_amount_fen', type: 'bigint', nullable: true })
  taxExclusiveAmountFen: number | null;

  /** 所属省份 UUID（合同只归属一个省份，只能分配到该省地市） */
  @Column({ name: 'province_id', type: 'varchar', length: 36 })
  provinceId: string;

  /** 合同开始日期（完整日期） */
  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate: string | null;

  /** 合同结束日期（完整日期；到期判定使用到日） */
  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string | null;

  /** 主状态：draft / active / completed / voided（ContractStatus） */
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: string;

  /** 附加标签 JSON 数组（ContractTag：expiring/expired/nearly_full/overfull/pending_complete/progress_changed） */
  @Column({ type: 'json', nullable: true })
  tags: string[] | null;

  /** 合同额锁定标记：生效后 true，永久拒绝修改合同额 */
  @Column({ name: 'amount_locked', type: 'boolean', default: false })
  amountLocked: boolean;

  /** 作废时的汇总选择（VoidSummaryChoice：exclude_current/retain_history），作废时必填 */
  @Column({ name: 'void_summary_choice', type: 'varchar', length: 24, nullable: true })
  voidSummaryChoice: string | null;

  /** 补充合同可选关联主合同 UUID（仅用于关系查看，不继承额度/费率） */
  @Column({ name: 'parent_contract_id', type: 'varchar', length: 36, nullable: true })
  parentContractId: string | null;

  /** 并发版本号（后保存覆盖/条件更新） */
  @Column({ name: 'version_no', type: 'int', default: 1 })
  versionNo: number;

  /** 创建人 UUID（biz_users） */
  @Column({ name: 'created_by', type: 'varchar', length: 36 })
  createdBy: string;

  /** 更新人 UUID（biz_users） */
  @Column({ name: 'updated_by', type: 'varchar', length: 36 })
  updatedBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
