import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@biz-reporting/shared-types';
import type {
  UserListItem,
  UserListResponse,
  UpdateUserStatusRequest,
  RebindUserCityRequest,
  PaginationParams,
} from '@biz-reporting/shared-types';
import type { Request as ExpressRequest } from 'express';
import { UsersService } from './users.service';

interface AuthenticatedRequest extends ExpressRequest {
  user: { userId: number; role: string; cityId: number | null };
}

@ApiTags('Admin - 用户管理')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: '获取用户列表' })
  async list(@Query() params: PaginationParams): Promise<UserListResponse> {
    return this.usersService.list(params);
  }

  @Patch(':userId/status')
  @ApiOperation({ summary: '启用/禁用用户' })
  @ApiResponse({ status: 200, description: '状态更新成功' })
  async updateStatus(
    @Param('userId') userId: number,
    @Body() dto: UpdateUserStatusRequest,
  ): Promise<UserListItem> {
    return this.usersService.updateStatus(userId, dto.status);
  }

  @Patch(':userId/city')
  @ApiOperation({ summary: '重新绑定城市用户到其他城市' })
  @ApiResponse({ status: 200, description: '绑定成功' })
  async rebindCity(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: number,
    @Body() dto: RebindUserCityRequest,
  ): Promise<UserListItem> {
    return this.usersService.rebindCity(userId, dto.cityId, req.user.userId);
  }
}
