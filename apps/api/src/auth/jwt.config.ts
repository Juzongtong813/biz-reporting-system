import { ConfigService } from '@nestjs/config';

const JWT_SECRET_ERROR_PREFIX = '[AUTH_CONFIG] JWT_SECRET is required and must not be empty';
const DEFAULT_JWT_ISSUER = 'biz-reporting-api';
const DEFAULT_JWT_AUDIENCE = 'biz-reporting-clients';

function normalizeJwtSecret(
  value: unknown,
  nodeEnv: unknown,
  deployEnv: unknown,
): string {
  const secret = typeof value === 'string' ? value.trim() : '';
  if (!secret) {
    const runtime = typeof nodeEnv === 'string' && nodeEnv.trim() ? nodeEnv.trim() : 'unspecified';
    const deployment = typeof deployEnv === 'string' && deployEnv.trim() ? deployEnv.trim() : 'unspecified';
    throw new Error(`${JWT_SECRET_ERROR_PREFIX} (NODE_ENV=${runtime}, DEPLOY_ENV=${deployment})`);
  }
  return secret;
}

/** 在 ConfigModule 初始化期间执行，确保任何模块连接外部资源前认证配置已通过。 */
export function validateAuthEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  normalizeJwtSecret(config.JWT_SECRET, config.NODE_ENV, config.DEPLOY_ENV);
  return config;
}

/** JwtModule 与 JwtStrategy 共用同一个无回退密钥读取入口。 */
export function requireJwtSecret(config: ConfigService): string {
  return normalizeJwtSecret(
    config.get<unknown>('JWT_SECRET'),
    config.get<unknown>('NODE_ENV'),
    config.get<unknown>('DEPLOY_ENV'),
  );
}

/** 签发与验证共用同一 issuer（生产由 C-03 校验必填；非生产使用默认值保持本地可用）。 */
export function requireJwtIssuer(config: ConfigService): string {
  return config.get<string>('JWT_ISSUER')?.trim() || DEFAULT_JWT_ISSUER;
}

/** 签发与验证共用同一 audience（生产由 C-03 校验必填；非生产使用默认值保持本地可用）。 */
export function requireJwtAudience(config: ConfigService): string {
  return config.get<string>('JWT_AUDIENCE')?.trim() || DEFAULT_JWT_AUDIENCE;
}
