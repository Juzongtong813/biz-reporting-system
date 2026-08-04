import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const modulePath = path.resolve('apps/api/dist/facts/fact-source-storage.config.js');
const { assertProductionFactSourceStorage, PRODUCTION_FACT_SOURCE_STORAGE_ROOT } = await import(pathToFileURL(modulePath));
const production = { NODE_ENV: 'production' };

// ────────── local 分支（旧 CFS 挂载校验，保留回滚路径）──────────
assert.throws(() => assertProductionFactSourceStorage(production, 'linux', ''), /FACT_SOURCE_STORAGE_ROOT_REQUIRED/);
assert.throws(() => assertProductionFactSourceStorage({ ...production, FACT_SOURCE_STORAGE_ROOT: 'relative/files' }, 'linux', ''), /MUST_BE_ABSOLUTE/);
assert.throws(() => assertProductionFactSourceStorage({ ...production, FACT_SOURCE_STORAGE_ROOT: '/var/tmp/files' }, 'linux', ''), /MUST_EQUAL/);
assert.throws(() => assertProductionFactSourceStorage({ ...production, FACT_SOURCE_STORAGE_ROOT: PRODUCTION_FACT_SOURCE_STORAGE_ROOT }, 'linux', ''), /MOUNT_NOT_FOUND/);
assert.doesNotThrow(() => assertProductionFactSourceStorage(
  { ...production, FACT_SOURCE_STORAGE_ROOT: PRODUCTION_FACT_SOURCE_STORAGE_ROOT },
  'linux',
  `36 25 0:32 / ${PRODUCTION_FACT_SOURCE_STORAGE_ROOT} rw,relatime - fuse.cosfs cosfs rw`,
));
assert.doesNotThrow(() => assertProductionFactSourceStorage({ NODE_ENV: 'test' }, 'win32'));

// ────────── cos 分支（D4，Codex PG-20260805-COS-D-CORRECTION）──────────
// driver=cos：不读 mountinfo、不要求 FACT_SOURCE_STORAGE_ROOT —— 生产无挂载根必须通过
assert.doesNotThrow(() => assertProductionFactSourceStorage(
  { ...production, FACT_SOURCE_STORAGE_DRIVER: 'cos' },
  'linux',
  '', // 无 mountinfo
), 'cos driver 生产环境无挂载根应通过（COS SDK 直连）');
// driver 显式传入 cos（构造注入形态）
assert.doesNotThrow(() => assertProductionFactSourceStorage(production, 'linux', '', 'cos'),
  'cos driver（显式参数）生产环境应通过');
// local 分支仍须校验（无挂载根必须失败）
assert.throws(() => assertProductionFactSourceStorage(production, 'linux', '', 'local'), /FACT_SOURCE_STORAGE_ROOT_REQUIRED/);

console.log(`FACT_SOURCE_STORAGE_GATE_OK driver=cos|local root=${PRODUCTION_FACT_SOURCE_STORAGE_ROOT}`);
