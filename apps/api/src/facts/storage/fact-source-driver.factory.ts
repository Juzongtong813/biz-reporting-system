/**
 * 驱动装配工厂（设计 §4.4 driver 选择逻辑）。
 *
 * 职责：把"环境变量 → 具体 driver 实例"这段装配逻辑收敛到一处，
 * 让 `FactSourceFileStorageService`（唯一 Nest 注入点）与
 * `FactSourceDriverModule`（唯一 Nest 装配点）共用同一条路径。
 *
 * ⚠️ 禁止隐式回退：driver 由 `resolveStorageDriver()` 严格判定；
 * production 未显式声明 `FACT_SOURCE_STORAGE_DRIVER` 即启动失败。
 *
 * ⚠️ 部署顺序提示（B → D 阶段衔接）：
 * 本文件生效后，production 必须显式提供 `FACT_SOURCE_STORAGE_DRIVER`。
 * 该变量的部署侧落地属 D 阶段（D6 环境样例与部署配置），
 * **在 D 阶段完成前不得将本分支部署至 production。**
 */
import path from 'node:path';
import { resolveFactSourceStorageRoot } from '../fact-source-storage.config';
import { CosFactSourceDriver } from './cos-fact-source-driver';
import { createCosClient } from './cos-client.factory';
import { EnvCredentialProvider, CredentialProvider } from './credential.provider';
import { FactSourceDriver } from './fact-source-driver.interface';
import { LocalFactSourceDriver } from './local-fact-source-driver';
import {
  COS_READINESS_PROBE_TIMEOUT_MS,
  FactSourceStorageDriverKind,
  resolveCosConfig,
  resolveStorageDriver,
} from './storage-driver.config';

/**
 * `facts` 目录的绝对路径。
 *
 * `resolveFactSourceStorageRoot(env, dirname)` 的 dirname 语义是"由该目录向上两级定位
 * `apps/api/data`"，历史调用点是 `apps/api/src/facts/fact-source-file-storage.service.ts`。
 * 本文件位于 `apps/api/src/facts/storage/`，因此需显式回退一级，保证默认 root 不漂移。
 */
export const FACTS_MODULE_DIRNAME = path.resolve(__dirname, '..');

export interface CreateFactSourceDriverOptions {
  /** 覆盖 facts 目录（仅测试使用） */
  factsDirname?: string;
  /** 覆盖凭据提供者（仅测试与联调使用；生产走 `EnvCredentialProvider`） */
  credentialProvider?: CredentialProvider;
}

/** 构造 Local driver（不读取任何 COS 配置）。 */
export function createLocalFactSourceDriver(
  env: NodeJS.ProcessEnv,
  factsDirname: string = FACTS_MODULE_DIRNAME,
): LocalFactSourceDriver {
  return new LocalFactSourceDriver(resolveFactSourceStorageRoot(env, factsDirname));
}

/**
 * 构造 COS driver。
 * 会惰性加载 `cos-nodejs-sdk-v5`，但**不发起任何网络请求**。
 */
export function createCosFactSourceDriver(
  env: NodeJS.ProcessEnv,
  credentialProvider?: CredentialProvider,
): CosFactSourceDriver {
  const config = resolveCosConfig(env);
  const provider = credentialProvider ?? new EnvCredentialProvider(env);
  const client = createCosClient(config, provider);
  return new CosFactSourceDriver(client, {
    objectPrefix: config.objectPrefix,
    probeTimeoutMs: COS_READINESS_PROBE_TIMEOUT_MS,
  });
}

/** 依 `FACT_SOURCE_STORAGE_DRIVER` 选择并构造 driver。 */
export function createFactSourceDriver(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateFactSourceDriverOptions = {},
): FactSourceDriver {
  const kind: FactSourceStorageDriverKind = resolveStorageDriver(env);
  if (kind === 'local') {
    return createLocalFactSourceDriver(env, options.factsDirname ?? FACTS_MODULE_DIRNAME);
  }
  return createCosFactSourceDriver(env, options.credentialProvider);
}
