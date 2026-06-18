import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * 合同月度填报行实体
 * 对应 DDL report_contract_monthly_rows 表
 *
 * 唯一约束: package_id + contract_code_snapshot + month_no
 */
@Entity('report_contract_monthly_rows')
export class ContractMonthRowEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'package_id', type: 'bigint' })
  packageId: number;

  @Column({ name: 'contract_id', type: 'bigint', nullable: true })
  contractId: number | null;

  @Column({ name: 'contract_code_snapshot', type: 'varchar', length: 100 })
  contractCodeSnapshot: string;

  @Column({ name: 'contract_name_snapshot', type: 'varchar', length: 255 })
  contractNameSnapshot: string;

  @Column({ name: 'city_allocation_id', type: 'bigint', nullable: true })
  cityAllocationId: number | null;

  @Column({ name: 'month_no', type: 'tinyint' })
  monthNo: number;

  @Column({ name: 'completion_amount', type: 'decimal', precision: 18, scale: 2, default: 0 })
  completionAmount: number;

  @Column({ name: 'acceptance_amount', type: 'decimal', precision: 18, scale: 2, default: 0 })
  acceptanceAmount: number;

  @Column({ name: 'is_locked', type: 'tinyint', width: 1, default: 0 })
  isLocked: number;

  @Column({ name: 'lock_reason', type: 'varchar', length: 100, nullable: true })
  lockReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
