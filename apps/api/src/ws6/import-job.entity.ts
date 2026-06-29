import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * 导入任务实体
 * 对应 DDL import_jobs 表
 */
@Entity('import_jobs')
export class ImportJobEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'job_type', type: 'varchar', length: 32 })
  jobType: string;

  @Column({ name: 'operator_user_id', type: 'bigint' })
  operatorUserId: number;

  @Column({ name: 'city_id', type: 'bigint', nullable: true })
  cityId: number | null;

  @Column({ type: 'varchar', length: 32 })
  status: string;

  @Column({ name: 'source_file_url', type: 'varchar', length: 500 })
  sourceFileUrl: string;

  @Column({ name: 'source_file_base64', type: 'longtext', nullable: true })
  sourceFileBase64: string | null;

  @Column({ name: 'source_file_name', type: 'varchar', length: 255, nullable: true })
  sourceFileName: string | null;

  @Column({ name: 'parsed_summary_json', type: 'json', nullable: true })
  parsedSummaryJson: Record<string, unknown> | null;

  @Column({ name: 'diff_summary_json', type: 'json', nullable: true })
  diffSummaryJson: Record<string, unknown> | null;

  @Column({ name: 'error_summary_json', type: 'json', nullable: true })
  errorSummaryJson: Record<string, unknown> | null;

  @Column({ name: 'confirmed_at', type: 'datetime', nullable: true })
  confirmedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
