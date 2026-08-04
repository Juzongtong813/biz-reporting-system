import path from 'node:path';

export const PRODUCTION_FACT_SOURCE_STORAGE_ROOT = '/mnt/fact-source-files';

export type FactSourceStorageDriverMode = 'local' | 'cos';

export function resolveFactSourceStorageRoot(env: NodeJS.ProcessEnv, dirname: string): string {
  return path.resolve(env.FACT_SOURCE_STORAGE_ROOT || path.join(dirname, '..', '..', 'data', 'fact-source-files'));
}

/**
 * 解析生产存储驱动语义（D1）。
 * - 显式 `FACT_SOURCE_STORAGE_DRIVER=cos` → 'cos'
 * - 其余（含缺失、'local'）→ 'local'（保留旧 CFS 回滚路径）
 */
export function resolveProductionStorageDriver(env: NodeJS.ProcessEnv): FactSourceStorageDriverMode {
  return String(env.FACT_SOURCE_STORAGE_DRIVER ?? '').trim().toLowerCase() === 'cos' ? 'cos' : 'local';
}

/**
 * 生产源文件存储强校验（D1：增加 driver 语义）。
 *
 * - driver=cos：**不读取 mountinfo、不要求 FACT_SOURCE_STORAGE_ROOT**。
 *   COS SDK 直连方案下文件落在私有桶，不依赖本地持久挂载。
 * - driver=local：保留旧 CFS 挂载校验（mountinfo + FACT_SOURCE_STORAGE_ROOT），
 *   保留原错误码（FACT_SOURCE_STORAGE_ROOT_REQUIRED_IN_PRODUCTION 等），作为回滚路径。
 */
export function assertProductionFactSourceStorage(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  mountInfo?: string,
  driver?: FactSourceStorageDriverMode,
): void {
  if (String(env.NODE_ENV).toLowerCase() !== 'production') return;
  const resolvedDriver = driver ?? resolveProductionStorageDriver(env);
  if (resolvedDriver === 'cos') return; // COS 方案不依赖 CFS 挂载

  const configured = env.FACT_SOURCE_STORAGE_ROOT?.trim();
  if (!configured) throw new Error('FACT_SOURCE_STORAGE_ROOT_REQUIRED_IN_PRODUCTION');
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  if (!pathApi.isAbsolute(configured)) throw new Error('FACT_SOURCE_STORAGE_ROOT_MUST_BE_ABSOLUTE');
  if (pathApi.normalize(configured) !== PRODUCTION_FACT_SOURCE_STORAGE_ROOT) {
    throw new Error(`FACT_SOURCE_STORAGE_ROOT_MUST_EQUAL_${PRODUCTION_FACT_SOURCE_STORAGE_ROOT}`);
  }
  if (platform === 'linux' && !isMountedAt(mountInfo || '', PRODUCTION_FACT_SOURCE_STORAGE_ROOT)) {
    throw new Error('FACT_SOURCE_STORAGE_PERSISTENT_MOUNT_NOT_FOUND');
  }
}

function isMountedAt(mountInfo: string, expectedPath: string): boolean {
  return mountInfo.split('\n').some((line) => {
    const fields = line.trim().split(' ');
    return fields.length > 5 && decodeMountPath(fields[4]) === expectedPath;
  });
}

function decodeMountPath(value: string): string {
  return value.replace(/\\040/g, ' ').replace(/\\011/g, '\t').replace(/\\012/g, '\n').replace(/\\134/g, '\\');
}
