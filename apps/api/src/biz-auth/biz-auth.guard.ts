import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * biz 认证守卫（AuthGuard('biz-jwt')）
 * 挂在 biz 控制器路由上（路由需同时标 @Public() 以跳过全局旧 JWT guard）。
 * 通过后 request.bizAuth 为 BizAuthContext（含权限码与数据范围）。
 */
@Injectable()
export class BizAuthGuard extends AuthGuard('biz-jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const result = (await super.canActivate(context)) as boolean;
      // passport 将 validate() 返回值挂在 request.user；同步到 request.bizAuth 供装饰器/守卫使用
      const request = context.switchToHttp().getRequest();
      if (request.user) request.bizAuth = request.user;
      return result;
    } catch {
      throw new UnauthorizedException('未登录或登录已过期');
    }
  }
}
