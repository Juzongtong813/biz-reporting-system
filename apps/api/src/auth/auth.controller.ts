import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  AdminLoginRequest,
  WechatRegisterRequest,
  WechatLoginRequest,
} from '@biz-reporting/shared-types';

// Swagger @ApiResponse 需要 class（运行时值），不能用 interface
class LoginResponseDto {
  token: string;
  user: { id: number; role: string; name: string; cityId: number | null };
}

@ApiTags('Auth - 认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '管理员登录（用户名+密码）' })
  @ApiResponse({ status: 200, description: '登录成功', type: LoginResponseDto })
  @ApiResponse({ status: 401, description: '用户名或密码错误' })
  async adminLogin(@Body() dto: AdminLoginRequest): Promise<LoginResponseDto> {
    return this.authService.adminLogin(dto);
  }

  @Post('wechat/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '微信用户注册（首次登录自动注册）' })
  @ApiResponse({ status: 201, description: '注册成功', type: LoginResponseDto })
  async wechatRegister(@Body() dto: WechatRegisterRequest): Promise<LoginResponseDto> {
    return this.authService.wechatRegister(dto);
  }

  @Post('wechat/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '微信用户登录（已有用户）' })
  @ApiResponse({ status: 200, description: '登录成功', type: LoginResponseDto })
  @ApiResponse({ status: 404, description: '用户不存在，请先注册' })
  async wechatLogin(@Body() dto: WechatLoginRequest): Promise<LoginResponseDto> {
    return this.authService.wechatLogin(dto);
  }
}
