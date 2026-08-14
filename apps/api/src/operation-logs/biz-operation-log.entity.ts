import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * 最小操作日志（新基线 biz_operation_logs）
 * 基线：01 §3.4 / 02 §7 / 07 TABLE 7
 * 关键规则：永久保存操作类型、业务对象、操作账号和操作时间；
 * 不保存字段修改前后值；业务对象须保留自身状态字段（审核状态/作废状态等）。
 */
@Entity('biz_operation_logs')
@Index('idx_biz_op_log_created_at', ['createdAt'])
@Index('idx_biz_op_log_user', ['operatorUserId'])
@Index('idx_biz_op_log_target', ['targetType', 'targetId'])
export class BizOperationLogEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 操作账号 UUID（biz_users） */
  @Column({ name: 'operator_user_id', type: 'varchar', length: 36 })
  operatorUserId: string;

  /** 操作类型（如 contract.void / order_batch.void / offline.approve / cost.void） */
  @Column({ name: 'action_type', type: 'varchar', length: 64 })
  actionType: string;

  /** 业务对象类型（contract / order_batch / offline_completion / cost_entry / user / permission） */
  @Column({ name: 'target_type', type: 'varchar', length: 64 })
  targetType: string;

  /** 业务对象 UUID */
  @Column({ name: 'target_id', type: 'varchar', length: 36 })
  targetId: string;

  /** 操作结果：success / rejected / failed */
  @Column({ name: 'result_status', type: 'varchar', length: 16, default: 'success' })
  resultStatus: string;

  /** 操作时间（UTC 存储，页面按 UTC+8 显示） */
  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
