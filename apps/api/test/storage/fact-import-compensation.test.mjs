/**
 * C-1/C-2 — 补偿删除四场景测试（任务 C6，伪存储/伪 DB，无凭据、无网络）。
 *
 * 覆盖（对应 C-1 验收判据 3-6 / C-2 验收判据 2-3 / 设计 §6.3）：
 *  - 成功：事务 COMMIT → delete 未被调用
 *  - 失败：store 成功 + 事务抛错（ROLLBACK）→ deduplicated=false 且无 DB 引用 → delete 调用 1 次，DB 无批次行
 *  - 重复：deduplicated=true → delete 未被调用（对象可能被其它批次引用）
 *  - 补偿失败：delete 抛错 → operation_log 写 fact_source_object_orphaned，原始业务错误仍向上抛
 *  - D-5 护栏：DB 仍有引用 → delete 未被调用
 *  - C-3.5：ws6 应用层幂等——同 sha256 + 业务键重复提交返回同一 jobId
 *
 * 执行：node apps/api/test/storage/fact-import-compensation.test.mjs（node:test，零新增依赖）
 *      或经 pnpm test:unit（run-unit.mjs 注册）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const API_ROOT = path.join(REPO_ROOT, 'apps', 'api');
const apiRequire = createRequire(path.join(API_ROOT, 'package.json'));

let compiledRoot = null;
let tempRoot = null;

function compileCurrentSrc() {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-c-compensation-'));
  compiledRoot = path.join(tempRoot, 'compiled');
  process.env.NODE_PATH = [
    path.join(API_ROOT, 'node_modules'),
    path.join(REPO_ROOT, 'node_modules'),
    process.env.NODE_PATH,
  ].filter(Boolean).join(path.delimiter);
  Module._initPaths();
  apiRequire('reflect-metadata');
  const tsc = apiRequire.resolve('typescript/bin/tsc');
  execFileSync(
    process.execPath,
    [tsc, '-p', path.join(API_ROOT, 'tsconfig.v3-check.json'), '--noEmit', 'false', '--declaration', 'false', '--outDir', compiledRoot, '--pretty', 'false'],
    { cwd: REPO_ROOT, stdio: 'pipe' },
  );
}

function compiled(rel) {
  return apiRequire(path.join(compiledRoot, 'apps', 'api', 'src', rel));
}

function makeHash(buffer) {
  const { createHash } = apiRequire('node:crypto');
  return createHash('sha256').update(buffer).digest('hex');
}

function makeXlsxBuffer() {
  const XLSX = apiRequire('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([
    ['成本类别', '日期', '事由', '金额', '合同编号'],
    ['人工费', '2026-01-15', '测试事由', '100', 'C001'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function makeEvidence({ deduplicated = false, size = 0 } = {}) {
  const sha = 'a'.repeat(64);
  return {
    storageKey: `${sha.slice(0, 2)}/${sha}`,
    size,
    sha256: sha,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    storedAt: new Date(),
    deduplicated,
  };
}

/** 记录 delete / operation_log 调用的伪存储。 */
function makeFakeStorage(evidence, deleteImpl) {
  const calls = { deleteCount: 0, deletedKeys: [] };
  return {
    calls,
    store: async () => evidence,
    read: async () => Buffer.from(''),
    exists: async () => true,
    delete: async (key) => {
      calls.deleteCount += 1;
      calls.deletedKeys.push(key);
      if (deleteImpl) return deleteImpl(key);
      return undefined;
    },
  };
}

let FactImportService;
let Ws6Service;

before(() => {
  compileCurrentSrc();
  FactImportService = compiled('facts/fact-import.service.js').FactImportService;
  Ws6Service = compiled('ws6/ws6.service.js').Ws6Service;
});

after(() => {
  if (tempRoot && fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

/** 构造 FactImportService：事务抛错（写库失败）。 */
function makeFactImportService({ evidence, transactionError, deleteImpl, stillReferenced = false }) {
  const operationLogs = [];
  const logRepo = {
    create: (x) => x,
    save: async (x) => { operationLogs.push(x); return x; },
  };
  const batchRepo = {
    // completedBatch（带 status 条件）→ null；anyRowReferences（仅 fileSha256）→ 按 stillReferenced
    findOne: async ({ where }) => {
      if (where && typeof where === 'object' && 'status' in where) return null;
      return stillReferenced ? { id: 999 } : null;
    },
    create: (x) => x,
    save: async (x) => x,
  };
  const dataSource = {
    query: async () => stillReferenced ? [{ id: 1 }] : [],
    transaction: async () => {
      if (transactionError) throw transactionError;
      throw new Error('TRANSACTION_NOT_MOCKED');
    },
  };
  const storage = makeFakeStorage(evidence, deleteImpl);
  return {
    service: new FactImportService(
      batchRepo,                       // batchRepo
      { findOne: async () => ({ id: 1, name: '济南' }) }, // cityRepo
      { find: async () => [{ id: 1, contractCode: 'C001' }] }, // contractRepo
      { find: async () => [{ contractId: 1 }] },          // allocationRepo
      { create: (x) => x, save: async (x) => [x], update: async () => ({}) }, // sourceRowRepo
      { create: (x) => x, save: async (x) => [x] },       // costFactRepo
      { create: (x) => x, save: async (x) => [x] },       // orderFactRepo
      { create: (x) => x, save: async (x) => [x] },       // versionRepo
      logRepo,                                             // operationLogRepo
      storage,                                             // sourceFiles
      dataSource,                                          // dataSource
    ),
    storage,
    operationLogs,
  };
}

function costImportFile() {
  return { buffer: makeXlsxBuffer(), originalname: 'compensation.xlsx' };
}

test('C-1 成功：事务 COMMIT → delete 未被调用（evidence 保留）', async () => {
  // 成功路径由既有集成测试覆盖（import-job-storage / facts-v31 等）。
  // 此处验证：store 返回 deduplicated=false，但事务不抛错时补偿不触发。
  const evidence = makeEvidence({ deduplicated: false, size: 100 });
  const storage = makeFakeStorage(evidence);
  // 不抛错的 transaction 由调用方 mock 为正常 manager；这里直接验证补偿 helper 逻辑：
  // 无事务异常时 persistCostBatch 不会进入 catch。
  // 我们用一个可成功的 manager 替身验证 delete 未被调用。
  const okManager = {
    getRepository: () => ({
      findOne: async () => null,
      create: (x) => x,
      save: async (x) => x,
      delete: async () => undefined,
      update: async () => ({ affected: 0 }),
    }),
  };
  const serviceWithOkTx = new FactImportService(
    { findOne: async () => null, create: (x) => x, save: async (x) => x },
    { findOne: async () => ({ id: 1, name: '济南' }) },
    { find: async () => [{ id: 1, contractCode: 'C001' }] },
    { find: async () => [{ contractId: 1 }] },
    { create: (x) => x, save: async (x) => [x], update: async () => ({}) },
    { create: (x) => x, save: async (x) => [x] },
    { create: (x) => x, save: async (x) => [x] },
    { create: (x) => x, save: async (x) => [x] },
    { create: (x) => x, save: async (x) => x },
    storage,
    { query: async () => [], transaction: async (cb) => cb(okManager) },
  );
  const result = await serviceWithOkTx.importCost(costImportFile(), { userId: 1, cityId: 1 }, 'standard_cost');
  assert.ok(result, '成功路径应返回结果');
  assert.equal(storage.calls.deleteCount, 0, '成功路径不得调用 delete');
});

test('C-1 失败：store 成功 + 事务抛错 → delete 调用 1 次，DB 无批次行（C-2.1）', async () => {
  const evidence = makeEvidence({ deduplicated: false, size: 100 });
  const { service, storage, operationLogs } = makeFactImportService({
    evidence,
    transactionError: new Error('DB_WRITE_FAILED'),
  });
  await assert.rejects(
    service.importCost(costImportFile(), { userId: 1, cityId: 1 }, 'standard_cost'),
    /DB_WRITE_FAILED/,
    '原始业务错误应向上抛出（不吞）',
  );
  assert.equal(storage.calls.deleteCount, 1, 'deduplicated=false 且无引用时应补偿删除 1 次');
  assert.equal(storage.calls.deletedKeys[0], evidence.storageKey);
  const compensated = operationLogs.filter((log) => log.actionType === 'fact_source_object_compensated');
  assert.equal(compensated.length, 1, '补偿删除应写 operation_log（fact_source_object_compensated）');
  assert.equal(compensated[0].resultStatus, 'success');
});

test('C-1 重复：deduplicated=true → delete 未被调用（C-2.2）', async () => {
  const evidence = makeEvidence({ deduplicated: true, size: 100 });
  const { service, storage, operationLogs } = makeFactImportService({
    evidence,
    transactionError: new Error('DB_WRITE_FAILED'),
  });
  await assert.rejects(service.importCost(costImportFile(), { userId: 1, cityId: 1 }, 'standard_cost'), /DB_WRITE_FAILED/);
  assert.equal(storage.calls.deleteCount, 0, 'deduplicated=true 不得删除（对象可能被其它批次引用）');
  const skipped = operationLogs.filter((log) => log.actionType === 'fact_source_object_compensation_skipped');
  assert.equal(skipped.length, 1, '应写 skipped 日志');
  assert.equal(skipped[0].summaryText, 'SOURCE_FILE_COMPENSATION_SKIPPED_DEDUPLICATED');
});

test('C-1 补偿失败：delete 抛错 → operation_log 写 fact_source_object_orphaned，原始错误仍上抛（C-2.3）', async () => {
  const evidence = makeEvidence({ deduplicated: false, size: 100 });
  const { service, storage, operationLogs } = makeFactImportService({
    evidence,
    transactionError: new Error('DB_WRITE_FAILED'),
    deleteImpl: async () => { throw new Error('COS_DELETE_FAILED'); },
  });
  await assert.rejects(
    service.importCost(costImportFile(), { userId: 1, cityId: 1 }, 'standard_cost'),
    /DB_WRITE_FAILED/,
    'delete 失败时原始业务错误仍应向上抛出',
  );
  assert.equal(storage.calls.deleteCount, 1);
  const orphan = operationLogs.filter((log) => log.actionType === 'fact_source_object_orphaned');
  assert.equal(orphan.length, 1, 'delete 失败应写 orphan 标记');
  assert.equal(orphan[0].resultStatus, 'failed');
  assert.equal(orphan[0].summaryText, 'SOURCE_FILE_ORPHAN_OBJECT');
  assert.ok(String(orphan[0].afterDataJson?.reason ?? '').includes('COS_DELETE_FAILED'));
});

test('C-1 D-5 护栏：DB 仍有引用 → delete 未被调用（SOURCE_FILE_COMPENSATION_SKIPPED_STILL_REFERENCED）', async () => {
  const evidence = makeEvidence({ deduplicated: false, size: 100 });
  const { service, storage, operationLogs } = makeFactImportService({
    evidence,
    transactionError: new Error('DB_WRITE_FAILED'),
    stillReferenced: true,
  });
  await assert.rejects(service.importCost(costImportFile(), { userId: 1, cityId: 1 }, 'standard_cost'), /DB_WRITE_FAILED/);
  assert.equal(storage.calls.deleteCount, 0, 'DB 仍有引用时不得删除');
  const skipped = operationLogs.filter((log) => log.actionType === 'fact_source_object_compensation_skipped');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].summaryText, 'SOURCE_FILE_COMPENSATION_SKIPPED_STILL_REFERENCED');
});

test('C-2 ws6：store 成功 + save 失败 → delete 调用 1 次（C-2.1 ws6 侧）', async () => {
  const evidence = makeEvidence({ deduplicated: false, size: 42 });
  const storage = makeFakeStorage(evidence);
  const operationLogs = [];
  const importJobRepo = {
    create: (x) => x,
    save: async () => { throw new Error('IMPORT_JOB_SAVE_FAILED'); },
    findOne: async () => null, // 幂等查重无命中
  };
  const service = new Ws6Service(
    importJobRepo, {}, {}, {}, {}, {}, {},
    { find: async () => [] }, { find: async () => [] },
    { create: (x) => x, save: async (x) => { operationLogs.push(x); return x; } },
    {}, {}, storage,
  );
  const payload = Buffer.from('C2 compensation payload', 'utf8');
  const sha = makeHash(payload);
  await assert.rejects(
    service.createImportJob({
      jobType: 'CITY_REPORTING',
      operatorUserId: 1,
      cityId: 1,
      reportYear: 2026,
      sourceFileName: 'job.xlsx',
      sourceFileBuffer: payload,
    }),
    /IMPORT_JOB_SAVE_FAILED/,
    'save 失败原始错误应上抛',
  );
  assert.equal(storage.calls.deleteCount, 1, 'ws6 save 失败应补偿删除');
  assert.equal(storage.calls.deletedKeys[0], evidence.storageKey);
  assert.equal(operationLogs.filter((log) => log.actionType === 'fact_source_object_compensated').length, 1);
  void sha;
});

test('C-2 ws6：deduplicated=true → delete 未被调用', async () => {
  const evidence = makeEvidence({ deduplicated: true, size: 42 });
  const storage = makeFakeStorage(evidence);
  const importJobRepo = {
    create: (x) => x,
    save: async () => { throw new Error('IMPORT_JOB_SAVE_FAILED'); },
    findOne: async () => null,
  };
  const service = new Ws6Service(
    importJobRepo, {}, {}, {}, {}, {}, {},
    { find: async () => [] }, { find: async () => [] },
    { create: (x) => x, save: async () => undefined },
    {}, {}, storage,
  );
  await assert.rejects(
    service.createImportJob({
      jobType: 'CITY_REPORTING',
      operatorUserId: 1,
      cityId: 1,
      reportYear: 2026,
      sourceFileName: 'job.xlsx',
      sourceFileBuffer: Buffer.from('dup payload', 'utf8'),
    }),
    /IMPORT_JOB_SAVE_FAILED/,
  );
  assert.equal(storage.calls.deleteCount, 0, 'deduplicated=true 不得删除');
});

test('C-2 ws6：补偿失败（delete 抛错）→ orphan 标记 + 原始错误上抛', async () => {
  const evidence = makeEvidence({ deduplicated: false, size: 42 });
  const storage = makeFakeStorage(evidence, async () => { throw new Error('COS_DELETE_FAILED'); });
  const operationLogs = [];
  const importJobRepo = {
    create: (x) => x,
    save: async () => { throw new Error('IMPORT_JOB_SAVE_FAILED'); },
    findOne: async () => null,
  };
  const service = new Ws6Service(
    importJobRepo, {}, {}, {}, {}, {}, {},
    { find: async () => [] }, { find: async () => [] },
    { create: (x) => x, save: async (x) => { operationLogs.push(x); return x; } },
    {}, {}, storage,
  );
  await assert.rejects(
    service.createImportJob({
      jobType: 'CITY_REPORTING',
      operatorUserId: 1,
      cityId: 1,
      reportYear: 2026,
      sourceFileName: 'job.xlsx',
      sourceFileBuffer: Buffer.from('comp fail payload', 'utf8'),
    }),
    /IMPORT_JOB_SAVE_FAILED/,
  );
  assert.equal(storage.calls.deleteCount, 1);
  const orphan = operationLogs.filter((log) => log.actionType === 'fact_source_object_orphaned');
  assert.equal(orphan.length, 1, 'ws6 补偿失败应写 orphan 标记');
  assert.equal(orphan[0].resultStatus, 'failed');
});

test('C-3.5 ws6：应用层幂等——同 sha256 + 业务键重复提交返回同一 jobId，不重复 store/save', async () => {
  const existingJob = {
    id: 77,
    jobType: 'CITY_REPORTING',
    operatorUserId: 1,
    cityId: 1,
    reportYear: 2026,
    status: 'PENDING',
    sourceFileStorageKey: 'aa/aaaa',
  };
  const storage = makeFakeStorage(makeEvidence({ deduplicated: false, size: 10 }));
  let saveCalls = 0;
  const importJobRepo = {
    create: (x) => x,
    save: async (x) => { saveCalls += 1; return x; },
    findOne: async () => existingJob,
  };
  const operationLogs = [];
  const service = new Ws6Service(
    importJobRepo, {}, {}, {}, {}, {}, {},
    { find: async () => [] }, { find: async () => [] },
    { create: (x) => x, save: async (x) => { operationLogs.push(x); return x; } },
    {}, {}, storage,
  );
  const payload = Buffer.from('idempotent payload', 'utf8');
  const saved = await service.createImportJob({
    jobType: 'CITY_REPORTING',
    operatorUserId: 1,
    cityId: 1,
    reportYear: 2026,
    sourceFileName: 'idem.xlsx',
    sourceFileBuffer: payload,
  });
  assert.equal(saved.id, 77, '幂等命中应返回同一 jobId');
  assert.equal(saveCalls, 0, '幂等命中不得重复 save');
  assert.equal(storage.calls.deleteCount, 0);
  assert.equal(operationLogs.filter((log) => log.actionType === 'import_upload').length, 1, '幂等命中应写 audit');
});
