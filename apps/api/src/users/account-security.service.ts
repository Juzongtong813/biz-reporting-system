import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import {
  ChangeOwnPasswordRequest,
  CreateManagedUserRequest,
  CreateManagedUserResponse,
  CreateWechatInvitationResponse,
  ResetManagedUserPasswordResponse,
  Role,
  UpdateManagedUserRoleRequest,
  UserStatus,
} from '@biz-reporting/shared-types';
import { UserEntity } from './user.entity';
import { CityEntity } from '../cities/city.entity';
import { WechatInvitationEntity } from './wechat-invitation.entity';
import { OperationLogEntity } from '../common/entities/operation-log.entity';

export interface SecurityActor {
  userId: number;
  role: Role | string;
  cityId: number | null;
}

@Injectable()
export class AccountSecurityService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(CityEntity) private readonly cities: Repository<CityEntity>,
    @InjectRepository(WechatInvitationEntity) private readonly invitations: Repository<WechatInvitationEntity>,
    @InjectRepository(OperationLogEntity) private readonly logs: Repository<OperationLogEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async createAccount(dto: CreateManagedUserRequest, actor: SecurityActor): Promise<CreateManagedUserResponse> {
    this.assertRoot(actor);
    if (dto.role === Role.ROOT_ADMIN) throw new BadRequestException('根账号只能通过显式提升工具建立');
    this.assertManagedRole(dto.role);
    const username = this.normalizeUsername(dto.username);
    if (await this.users.findOne({ where: { username } })) throw new ConflictException('用户名已被使用');
    const cityId = await this.resolveCity(dto.role, dto.cityId);
    const temporaryPassword = this.generateTemporaryPassword();
    const user = await this.users.save(this.users.create({
      username,
      name: this.normalizeName(dto.name),
      role: dto.role,
      cityId,
      openid: null,
      passwordHash: await bcrypt.hash(temporaryPassword, 12),
      status: UserStatus.ENABLED,
      authVersion: 1,
      mustChangePassword: true,
    }));
    await this.audit(actor, 'account_create', user.id, null, { role: user.role, cityId: user.cityId, username: user.username });
    return { user: this.toListItem(user), temporaryPassword };
  }

  async resetPassword(userId: number, actor: SecurityActor): Promise<ResetManagedUserPasswordResponse> {
    this.assertRoot(actor);
    const user = await this.findUserForSecurity(userId);
    const temporaryPassword = this.generateTemporaryPassword();
    await this.users.update(user.id, {
      passwordHash: await bcrypt.hash(temporaryPassword, 12),
      mustChangePassword: true,
      authVersion: user.authVersion + 1,
    });
    await this.audit(actor, 'account_password_reset', user.id, { authVersion: user.authVersion }, { authVersion: user.authVersion + 1, mustChangePassword: true });
    return { userId: user.id, temporaryPassword };
  }

  async updateStatus(userId: number, status: UserStatus, actor: SecurityActor) {
    this.assertRoot(actor);
    const user = await this.findUserForSecurity(userId);
    if (user.role === Role.ROOT_ADMIN && status !== UserStatus.ENABLED) throw new ForbiddenException('根账号不可禁用');
    await this.users.update(user.id, { status, authVersion: user.authVersion + 1 });
    await this.audit(actor, 'account_status_change', user.id, { status: user.status }, { status });
    return this.toListItem((await this.findUserForSecurity(user.id)));
  }

  async updateRole(userId: number, dto: UpdateManagedUserRoleRequest, actor: SecurityActor) {
    this.assertRoot(actor);
    const user = await this.findUserForSecurity(userId);
    if (user.role === Role.ROOT_ADMIN) throw new ForbiddenException('根账号不可降级或变更范围');
    if (dto.role === Role.ROOT_ADMIN) throw new BadRequestException('根账号只能通过显式提升工具建立');
    this.assertManagedRole(dto.role);
    const cityId = await this.resolveCity(dto.role, dto.cityId);
    await this.users.update(user.id, { role: dto.role, cityId, authVersion: user.authVersion + 1 });
    await this.audit(actor, 'account_role_change', user.id, { role: user.role, cityId: user.cityId }, { role: dto.role, cityId });
    return this.toListItem((await this.findUserForSecurity(user.id)));
  }

  async updateCity(userId: number, cityId: number, actor: SecurityActor) {
    this.assertRoot(actor);
    const user = await this.findUserForSecurity(userId);
    if (user.role === Role.ROOT_ADMIN) throw new ForbiddenException('根账号不可绑定地市');
    if (user.role !== Role.CITY_USER) throw new BadRequestException('只有地市用户可以绑定地市');
    const resolvedCityId = await this.resolveCity(Role.CITY_USER, cityId);
    await this.users.update(user.id, { cityId: resolvedCityId, authVersion: user.authVersion + 1 });
    await this.audit(actor, 'account_city_change', user.id, { cityId: user.cityId }, { cityId: resolvedCityId });
    return this.toListItem((await this.findUserForSecurity(user.id)));
  }

  async createWechatInvitation(userId: number, actor: SecurityActor): Promise<CreateWechatInvitationResponse> {
    this.assertRoot(actor);
    const user = await this.findUserForSecurity(userId);
    if (user.role !== Role.CITY_USER || user.status !== UserStatus.ENABLED || !user.cityId) {
      throw new BadRequestException('仅可为已启用且已绑定地市的地市用户签发邀请');
    }
    const invitationToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await this.invitations.save(this.invitations.create({
      userId: user.id,
      tokenHash: this.hashToken(invitationToken),
      expiresAt,
      usedAt: null,
      createdBy: actor.userId,
    }));
    await this.audit(actor, 'wechat_invitation_create', user.id, null, { expiresAt: expiresAt.toISOString() });
    return { userId: user.id, invitationToken, expiresAt: expiresAt.toISOString() };
  }

  async consumeWechatInvitation(invitationToken: string, openid: string): Promise<UserEntity> {
    const tokenHash = this.hashToken(invitationToken);
    return this.dataSource.transaction(async (manager) => {
      const inviteRepo = manager.getRepository(WechatInvitationEntity);
      const userRepo = manager.getRepository(UserEntity);
      const invite = await inviteRepo.findOne({ where: { tokenHash } });
      if (!invite || invite.usedAt || invite.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedException('微信绑定邀请无效或已过期');
      }
      const claimed = await inviteRepo.createQueryBuilder()
        .update(WechatInvitationEntity)
        .set({ usedAt: new Date() })
        .where('id = :id AND used_at IS NULL AND expires_at > :now', { id: invite.id, now: new Date() })
        .execute();
      if (claimed.affected !== 1) throw new UnauthorizedException('微信绑定邀请无效或已过期');
      const user = await userRepo.findOne({ where: { id: invite.userId } });
      if (!user || user.role !== Role.CITY_USER || user.status !== UserStatus.ENABLED || !user.cityId) {
        throw new UnauthorizedException('微信绑定邀请对应账号不可用');
      }
      const other = await userRepo.findOne({ where: { openid } });
      if (other && other.id !== user.id) throw new ConflictException('该微信身份已绑定其他账号');
      if (user.openid && user.openid !== openid) throw new ConflictException('该账号已绑定其他微信身份');
      await userRepo.update(user.id, { openid, authVersion: user.authVersion + 1 });
      const logRepo = manager.getRepository(OperationLogEntity);
      await logRepo.save(logRepo.create({
        operatorUserId: user.id,
        operatorCityId: user.cityId,
        actionType: 'wechat_identity_bind',
        targetType: 'user',
        targetId: String(user.id),
        summaryText: 'WeChat identity bound through one-time invitation',
        beforeDataJson: { openidBound: Boolean(user.openid) },
        afterDataJson: { openidBound: true, invitationId: invite.id },
        resultStatus: 'success',
      }));
      const updated = await userRepo.findOne({ where: { id: user.id } });
      if (!updated) throw new NotFoundException('绑定后的用户不存在');
      return updated;
    });
  }

  async changeOwnPassword(actor: SecurityActor, dto: ChangeOwnPasswordRequest): Promise<void> {
    if (dto.newPassword !== dto.confirmPassword) throw new BadRequestException('两次输入的新密码不一致');
    this.validatePassword(dto.newPassword);
    const user = await this.findUserForSecurity(actor.userId);
    if (!user.passwordHash) throw new BadRequestException('当前账号尚未配置密码，请联系 root_admin 获取临时密码');
    if (!await bcrypt.compare(dto.currentPassword, user.passwordHash)) throw new UnauthorizedException('原密码错误');
    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) throw new BadRequestException('新密码不能与原密码相同');
    await this.users.update(user.id, {
      passwordHash: await bcrypt.hash(dto.newPassword, 12),
      mustChangePassword: false,
      authVersion: user.authVersion + 1,
    });
    await this.audit(actor, 'own_password_change', user.id, { authVersion: user.authVersion }, { authVersion: user.authVersion + 1, mustChangePassword: false });
  }

  async auditLogout(actor: SecurityActor): Promise<void> {
    await this.audit(actor, 'logout', actor.userId, null, { sessionEnded: true });
  }

  async rootReadiness(): Promise<{ count: number; ready: boolean }> {
    const count = await this.users.count({ where: { role: Role.ROOT_ADMIN } });
    return { count, ready: count === 1 };
  }

  private async findUserForSecurity(id: number): Promise<UserEntity> {
    const user = await this.users.findOne({
      where: { id },
      select: ['id', 'role', 'name', 'cityId', 'openid', 'username', 'passwordHash', 'status', 'authVersion', 'mustChangePassword', 'registerAt', 'lastLoginAt'],
    });
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }

  private assertRoot(actor: SecurityActor): void {
    if (actor.role !== Role.ROOT_ADMIN) throw new ForbiddenException('仅 root_admin 可执行此操作');
  }

  private assertManagedRole(role: Role): void {
    if (![Role.CONTRACT_MANAGER, Role.SYSTEM_ADMIN, Role.CITY_USER].includes(role)) throw new BadRequestException('目标角色不合法');
  }

  private async resolveCity(role: Role, value: number | null | undefined): Promise<number | null> {
    if (role !== Role.CITY_USER) return null;
    const cityId = Number(value);
    if (!Number.isInteger(cityId) || cityId <= 0) throw new BadRequestException('地市用户必须绑定有效地市');
    if (!await this.cities.findOne({ where: { id: cityId, isDeleted: 0 } })) throw new BadRequestException('目标地市不存在');
    return cityId;
  }

  private normalizeUsername(value: string): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.length > 100) throw new BadRequestException('用户名长度不合法');
    return normalized;
  }

  private normalizeName(value: string): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.length > 100) throw new BadRequestException('姓名长度不合法');
    return normalized;
  }

  private validatePassword(value: string): void {
    if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw new BadRequestException('密码长度必须为 8-128 位');
  }

  private generateTemporaryPassword(): string {
    return `${randomBytes(18).toString('base64url')}!7a`;
  }

  private hashToken(token: string): string {
    if (typeof token !== 'string' || token.length < 32) throw new UnauthorizedException('微信绑定邀请无效或已过期');
    return createHash('sha256').update(token).digest('hex');
  }

  private toListItem(user: UserEntity) {
    return {
      id: user.id,
      role: user.role,
      name: user.name,
      cityId: user.cityId,
      cityName: null,
      status: user.status,
      registerAt: user.registerAt?.toISOString?.() ?? new Date().toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString?.() ?? null,
      mustChangePassword: Boolean(user.mustChangePassword),
    };
  }

  private async audit(actor: SecurityActor, actionType: string, targetId: number, beforeDataJson: unknown, afterDataJson: unknown) {
    await this.logs.save(this.logs.create({
      operatorUserId: actor.userId,
      operatorCityId: actor.cityId,
      actionType,
      targetType: 'user',
      targetId: String(targetId),
      summaryText: actionType,
      beforeDataJson,
      afterDataJson,
      resultStatus: 'success',
    }));
  }
}
