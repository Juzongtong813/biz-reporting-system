import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('auth_wechat_invitations')
export class WechatInvitationEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('idx_auth_wechat_invitation_user')
  @Column({ name: 'user_id', type: 'bigint' })
  userId: number;

  @Column({ name: 'token_hash', type: 'varchar', length: 64, unique: true })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'datetime', nullable: true })
  usedAt: Date | null;

  @Column({ name: 'created_by', type: 'bigint' })
  createdBy: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
