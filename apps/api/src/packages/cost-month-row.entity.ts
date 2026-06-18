import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * 费用月度填报行实体
 * 对应 DDL report_cost_monthly_rows 表
 *
 * 唯一约束: package_id + month_no + cost_category_code
 */
@Entity('report_cost_monthly_rows')
export class CostMonthRowEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'package_id', type: 'bigint' })
  packageId: number;

  @Column({ name: 'month_no', type: 'tinyint' })
  monthNo: number;

  @Column({ name: 'cost_category_code', type: 'varchar', length: 50 })
  costCategoryCode: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  amount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
