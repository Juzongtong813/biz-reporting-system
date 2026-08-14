import { BadRequestException, Body, Controller, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizPermissionsGuard } from '../biz-auth/biz-permissions.guard';
import { BizPermissions } from '../biz-auth/biz-permissions.decorator';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizOrderImportService } from './biz-order-import.service';
import { BizPermissionCode, ORDER_FILE_MAX_BYTES, SENSITIVE_ORDER_PERMISSION } from '@biz-reporting/shared-types';

/**
 * 订单域 API（新基线 M4）
 * 基线：01 §5 / 02 TABLE 4 —— 上传仅 super_admin/admin；作废/恢复仅 super_admin。
 */
@Controller('biz/orders')
@Public()
@UseGuards(BizAuthGuard, BizPermissionsGuard)
export class BizOrdersController {
  constructor(private readonly service: BizOrderImportService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    // 默认 50MB 业务约束；ORDER_UPLOAD_MAX_BYTES 仅供性能验收放宽（生产不设置）
    limits: { fileSize: Number(process.env.ORDER_UPLOAD_MAX_BYTES || ORDER_FILE_MAX_BYTES) },
  }))
  @BizPermissions(BizPermissionCode.OPERATION_ORDER_UPLOAD)
  async upload(
    @BizAuthUser() auth: BizAuthContext,
    @UploadedFile() file: Express.Multer.File,
    @Body('idempotencyKey') idempotencyKey?: string,
  ) {
    const key = (idempotencyKey ?? '').trim() || undefined;
    if (!key) throw new BadRequestException('缺少幂等键 idempotencyKey');
    const batch = await this.service.upload(auth.userId, file, key);
    return { batchId: batch.id, status: batch.status };
  }

  @Get('batches')
  @BizPermissions(BizPermissionCode.OPERATION_ORDER_READ)
  async batches() {
    return { items: await this.service.listBatches() };
  }

  @Get('batches/:id')
  @BizPermissions(BizPermissionCode.OPERATION_ORDER_READ)
  async batchDetail(@Param('id') id: string) {
    return this.service.batchDetail(id);
  }

  @Post('batches/:id/void')
  @BizPermissions(BizPermissionCode.OPERATION_ORDER_BATCH_VOID)
  async voidBatch(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() body: { reason?: string }) {
    await this.service.voidBatch(auth.userId, auth.isSuperAdmin, id, body?.reason ?? '');
    return { ok: true };
  }

  @Post('batches/:id/restore')
  @BizPermissions(BizPermissionCode.OPERATION_ORDER_BATCH_RESTORE)
  async restoreBatch(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    await this.service.restoreBatch(auth.userId, auth.isSuperAdmin, id);
    return { ok: true };
  }

  @Get('rows')
  @BizPermissions(BizPermissionCode.OPERATION_ORDER_READ)
  async rows(
    @BizAuthUser() auth: BizAuthContext,
    @Query('batchId') batchId?: string,
    @Query('cityId') cityId?: string,
    @Query('overrun') overrun?: 'city' | 'contract' | 'any',
  ) {
    const sensitive = auth.isSuperAdmin || auth.permissionCodes.has(SENSITIVE_ORDER_PERMISSION);
    const items = await this.service.listRows({ batchId, cityId, overrun }, sensitive);
    return { items };
  }
}
