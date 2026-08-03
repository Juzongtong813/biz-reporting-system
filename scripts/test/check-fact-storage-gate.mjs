import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const modulePath = path.resolve('apps/api/dist/facts/fact-source-storage.config.js');
const { assertProductionFactSourceStorage, PRODUCTION_FACT_SOURCE_STORAGE_ROOT } = await import(pathToFileURL(modulePath));
const production = { NODE_ENV: 'production' };

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
console.log(`FACT_SOURCE_STORAGE_GATE_OK root=${PRODUCTION_FACT_SOURCE_STORAGE_ROOT}`);
