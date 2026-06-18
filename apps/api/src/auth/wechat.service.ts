import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

interface JsCode2SessionResponse {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

/**
 * 微信小程序登录凭证校验服务
 *
 * 调用微信官方 jscode2session 接口：
 * GET https://api.weixin.qq.com/sns/jscode2session
 *   ?appid=APPID&secret=SECRET&js_code=CODE&grant_type=authorization_code
 *
 * 模式选择（三态）：
 *
 * ┌─────────────────┬────────────┬────────────┬──────────────┐
 * │ NODE_ENV        │ WECHAT_APPID│WECHAT_SECRET│ 行为         │
 * ├─────────────────┼────────────┼────────────┼──────────────┤
 * │ production      │ 已配置     │ 已配置      │ 真实 code2session │
 * │ production      │ 缺失       │ 缺失        │ 🚫 抛错拒绝   │
 * │ 非 production   │ 已配置     │ 已配置      │ 真实 code2session │
 * │ 非 production   │ 缺失       │ 缺失        │ mock（配合    │
 * │                 │            │            │ WECHAT_LOGIN_ │
 * │                 │            │            │ MODE=mock）   │
 * └─────────────────┴────────────┴────────────┴──────────────┘
 *
 * 安全规则：
 * - 生产环境禁止任何 mock 路径
 * - 非生产环境必须显式设置 WECHAT_LOGIN_MODE=mock 才能启用 mock
 * - 缺少 appid/secret 时，不再静默降级
 */
@Injectable()
export class WechatService {
  private readonly logger = new Logger(WechatService.name);
  private readonly appid: string | undefined;
  private readonly secret: string | undefined;
  private readonly nodeEnv: string;
  private readonly loginMode: string | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.appid = this.configService.get<string>('WECHAT_APPID');
    this.secret = this.configService.get<string>('WECHAT_SECRET');
    this.nodeEnv = this.configService.get<string>('NODE_ENV') || 'development';
    this.loginMode = this.configService.get<string>('WECHAT_LOGIN_MODE');

    if (this.appid && this.secret) {
      this.logger.log('微信 code2session: 已配置 appid/secret，使用真实接口');
    } else {
      const isProduction = this.nodeEnv === 'production';
      if (isProduction) {
        this.logger.error(
          '微信 code2session: 生产环境缺少 WECHAT_APPID/WECHAT_SECRET，' +
          '微信登录功能将不可用',
        );
      } else {
        const mockEnabled = this.loginMode === 'mock';
        if (mockEnabled) {
          this.logger.warn(
            '微信 code2session: 非生产环境 + WECHAT_LOGIN_MODE=mock，' +
            '使用 mock 模式，不会调用真实微信接口',
          );
        } else {
          this.logger.error(
            '微信 code2session: 缺少 WECHAT_APPID/WECHAT_SECRET 且未设置 ' +
            'WECHAT_LOGIN_MODE=mock（仅限开发环境），微信登录功能将不可用',
          );
        }
      }
    }
  }

  /**
   * 检查是否允许 mock 模式
   */
  private isMockAllowed(): boolean {
    // 生产环境永远不允许 mock
    if (this.nodeEnv === 'production') return false;
    // 非生产环境需要显式启用
    return this.loginMode === 'mock';
  }

  /**
   * 将 wx.login() 返回的 code 兑换为 openid
   *
   * @param code 微信登录临时凭证（wx.login 返回值）
   * @returns openid（微信用户唯一标识）
   * @throws UnauthorizedException 如果 code 无效或微信接口返回错误
   */
  async code2Session(code: string): Promise<string> {
    // 检查凭证是否完备
    const credentialsMissing = !this.appid || !this.secret;

    if (credentialsMissing) {
      if (this.isMockAllowed()) {
        this.logger.debug(`[mock] code=${code} → mock_openid_${code}`);
        return `mock_openid_${code}`;
      }

      // 生产环境缺少凭证 → 抛错
      // 开发环境缺少凭证且未启用 mock → 抛错
      const isProduction = this.nodeEnv === 'production';
      const msg = isProduction
        ? '微信登录服务未配置，请联系管理员'
        : '缺少 WECHAT_APPID/WECHAT_SECRET，本地开发请设置 WECHAT_LOGIN_MODE=mock';
      this.logger.error(`微信登录拒绝: ${msg}`);
      throw new UnauthorizedException(msg);
    }

    // 凭证完备 → 调用微信官方接口
    const url = 'https://api.weixin.qq.com/sns/jscode2session';
    const params = {
      appid: this.appid,
      secret: this.secret,
      js_code: code,
      grant_type: 'authorization_code',
    };

    try {
      const response = await firstValueFrom(
        this.httpService.get<JsCode2SessionResponse>(url, { params }),
      );
      const data = response.data;

      if (data.errcode && data.errcode !== 0) {
        this.logger.error(`jscode2session 错误: errcode=${data.errcode}, errmsg=${data.errmsg}`);
        throw new UnauthorizedException(`微信登录失败: ${data.errmsg || `errcode=${data.errcode}`}`);
      }

      if (!data.openid) {
        throw new UnauthorizedException('微信登录失败: 未获取到 openid');
      }

      this.logger.debug(`[wechat] code=${code} → openid=${data.openid}`);
      return data.openid;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      this.logger.error(`jscode2session 网络请求失败: ${(err as Error).message}`);
      throw new UnauthorizedException('微信登录服务暂不可用，请稍后重试');
    }
  }
}
