import path from 'node:path';

export const PRODUCTION_FACT_SOURCE_STORAGE_ROOT = '/mnt/fact-source-files';

export function resolveFactSourceStorageRoot(env: NodeJS.ProcessEnv, dirname: string): string {
  return path.resolve(env.FACT_SOURCE_STORAGE_ROOT || path.join(dirname, '..', '..', 'data', 'fact-source-files'));
}

export function assertProductionFactSourceStorage(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  mountInfo?: string,
): void {
  if (String(env.NODE_ENV).toLowerCase() !== 'production') return;
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
