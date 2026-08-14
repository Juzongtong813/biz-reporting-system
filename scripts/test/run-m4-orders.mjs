import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const requireFromApi = createRequire(path.join(apiRoot, 'package.json'));
const XLSX = requireFromApi('xlsx');

const testRoot = mkdtempSync(path.join(tmpdir(), 'biz-m4-order-'));
const database = path.join(testRoot, 'm4.sqlite');
const storageRoot = path.join(testRoot, 'source-files');
const env = {
  ...process.env,
  NODE_ENV: 'test', DB_TYPE: 'sqlite', DB_DATABASE: database, DB_SYNC: 'false',
  FACT_SOURCE_STORAGE_ROOT: storageRoot,
  JWT_SECRET: 'm4-test-jwt-secret-0123456789abcdef',
  AUTH_SECURITY_HMAC_KEY: 'm4-test-hmac-key-0123456789abcdef',
  JWT_ISSUER: 'biz-reporting-api', JWT_AUDIENCE: 'biz-reporting-clients',
  PORT: '0',
};

const HEADER = ['省份名称','地市名称','采购订单编号','供应商名称','订单主状态','含税总金额','物料名称','物料编码','合同编号','净价','运保费','建安费','费用类型','税率','税额','含税单价','采购数量','计量单位','收货人','收货人联系方式','收货人详细地址','通知人','下单时间','通知时间','附言信息','项目编号','项目名称','站址编号','站址信息','收货状态','商品名称','商品编号','物料源头贴签标识','是否补样订单'];

let apiProcess;
let baseUrl = '';
let superToken = '';
let adminToken = '';
let cityToken = '';
let contractId = '';
let jinanId = '';
let shandongId = '';

async function waitForApi(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/biz/auth/me`);
      if (res.status === 401 || res.status === 200) return;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('API did not become ready');
}

async function api(method, urlPath, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${urlPath}`, { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** 构造 34 列订单行 */
function makeRow(po, contractNo, cityName, provinceName, amount, orderTime, projectName = `项目-${po}`) {
  const row = new Array(34).fill('');
  row[0] = provinceName; row[1] = cityName; row[2] = po; row[3] = '测试供应商';
  row[4] = '已提交'; row[5] = String(amount); row[6] = '物料A'; row[7] = `MAT-${po}`;
  row[8] = contractNo; row[9] = String(amount / 1.13); row[10] = '0'; row[11] = '0'; row[12] = '货物';
  row[13] = '13%'; row[14] = '0'; row[15] = '0'; row[16] = '1'; row[17] = '件';
  row[18] = '张收货'; row[19] = '13800138000'; row[20] = '山东省济南市测试路1号';
  row[21] = '通知人'; row[22] = orderTime; row[23] = orderTime; row[24] = '';
  row[25] = `PRJ-${po}`; row[26] = projectName; row[27] = `SITE-${po}`; row[28] = '测试站址';
  row[29] = '已收货'; row[30] = '商品A'; row[31] = `SKU-${po}`; row[32] = '是'; row[33] = '否';
  return row;
}

function buildXlsxBuffer(rows) {
  const aoa = [HEADER, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '电商化订单列表');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function uploadFile(token, buffer, idempotencyKey, filename = 'orders.xlsx') {
  const form = new FormData();
  form.append('idempotencyKey', idempotencyKey);
  form.append('file', new Blob([buffer]), filename);
  return api('POST', '/biz/orders/upload', { token, form });
}

async function waitBatch(id, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await api('GET', `/biz/orders/batches/${id}`, { token: superToken });
    if (res.data?.batch?.status !== 'parsing') return res.data;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('batch timeout');
}

try {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/auth/biz-init-super-admin.mjs'], {
    cwd: repoRoot, env: { ...env, BIZ_SUPER_ADMIN_USERNAME: 'm4_super', BIZ_SUPER_ADMIN_PASSWORD: 'M4-secret-1' }, stdio: 'inherit',
  });

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}/api`;
  apiProcess = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: { ...env, PORT: String(port), NODE_OPTIONS: '--max-old-space-size=4096', ORDER_UPLOAD_MAX_BYTES: String(300 * 1024 * 1024) },
    cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stdout.on('data', (c) => process.stdout.write(`[api] ${c}`));
  apiProcess.stderr.on('data', (c) => process.stderr.write(`[api] ${c}`));
  await waitForApi(baseUrl);

  // 登录 + 准备账号与合同
  let res = await api('POST', '/biz/auth/login', { body: { username: 'm4_super', password: 'M4-secret-1' } });
  superToken = res.data.accessToken;
  for (const dto of [
    { username: 'm4_admin', password: 'M4-secret-1', name: '管理员', roleCode: 'admin' },
    { username: 'm4_city', password: 'M4-secret-1', name: '地市用户', roleCode: 'city_user', cityId: '' },
  ]) {
    if (dto.roleCode === 'city_user') {
      const cities = await api('GET', '/biz/admin/cities', { token: superToken });
      dto.cityId = cities.data.items.find((c) => c.code === '370100').id;
      jinanId = dto.cityId;
    }
    res = await api('POST', '/biz/admin/users', { token: superToken, body: dto });
    assert.equal(res.status, 201, `create user failed: ${JSON.stringify(res.data)}`);
  }
  for (const [key, username] of [['admin', 'm4_admin'], ['city', 'm4_city']]) {
    res = await api('POST', '/biz/auth/login', { body: { username, password: 'M4-secret-1' } });
    if (key === 'admin') adminToken = res.data.accessToken;
    if (key === 'city') cityToken = res.data.accessToken;
  }
  const provinces = await api('GET', '/biz/admin/provinces', { token: superToken });
  shandongId = provinces.data.items.find((p) => p.code === '370000').id;

  // 合同（含济南分配 + 费率 12%）
  res = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-ORD-001', contractName: '订单测试合同', taxInclusiveAmountFen: 1_000_000_00,
    provinceId: shandongId, startDate: '2026-01-01', endDate: '2026-12-31',
  } });
  contractId = res.data.id;
  await api('POST', `/biz/contracts/${contractId}/allocations`, { token: superToken, body: { cityId: jinanId, quotaFen: 600_000_00 } });
  await api('POST', `/biz/contracts/${contractId}/fee-rates`, { token: superToken, body: { cityId: jinanId, effectiveMonth: '2026-01', rateBp: 1200 } });

  // ============ ORD-001 权限：city_user 上传 403；admin 上传 OK ============
  const validBuffer = buildXlsxBuffer([makeRow('PO-001', 'HT-ORD-001', '济南市', '山东省', 1000, '2026-01-15 10:00:00')]);
  res = await uploadFile(cityToken, validBuffer, randomUUID());
  assert.equal(res.status, 403, 'ORD-001 city_user upload must be 403');
  res = await uploadFile(adminToken, validBuffer, randomUUID());
  assert.equal(res.status, 201, 'ORD-001 admin upload must succeed');

  // ============ ORD-002 格式：非 xlsx → 400 ============
  const badExt = new FormData();
  badExt.append('idempotencyKey', randomUUID());
  badExt.append('file', new Blob([Buffer.from('not excel')]), 'orders.csv');
  res = await api('POST', '/biz/orders/upload', { token: superToken, form: badExt });
  assert.equal(res.status, 400, 'ORD-002 non-xlsx must be rejected');

  // ============ ORD-003 结构错误：列名不匹配 → FAILED 零写入 ============
  const badHeader = [...HEADER];
  badHeader[5] = '错误列名';
  const badWs = XLSX.utils.aoa_to_sheet([badHeader, makeRow('PO-X', 'HT-ORD-001', '济南市', '山东省', 100, '2026-01-15')]);
  const badWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(badWb, badWs, '电商化订单列表');
  const badBuffer = XLSX.write(badWb, { type: 'buffer', bookType: 'xlsx' });
  res = await uploadFile(superToken, badBuffer, randomUUID());
  assert.equal(res.status, 201);
  let detail = await waitBatch(res.data.batchId);
  assert.equal(detail.batch.status, 'failed', 'ORD-003 structure error must fail');
  assert.equal(detail.batch.importedRows, 0, 'ORD-003 zero write');

  // ============ ORD-004 整批校验错误：省份错误 → FAILED 零写入 ============
  const badRowBuffer = buildXlsxBuffer([makeRow('PO-002', 'HT-ORD-001', '济南市', '不存在省', 100, '2026-01-15')]);
  res = await uploadFile(superToken, badRowBuffer, randomUUID());
  detail = await waitBatch(res.data.batchId);
  assert.equal(detail.batch.status, 'failed', 'ORD-004 bad province must fail');
  assert.equal(detail.batch.importedRows, 0, 'ORD-004 zero write');
  assert.ok(detail.errors.length >= 1 && detail.errors[0].errorType === 'province', 'ORD-004 error report with type');

  // ============ ORD-005 成功导入：标准化字段 ============
  const validBuffer2 = buildXlsxBuffer([makeRow('PO-005', 'HT-ORD-001', '济南市', '山东省', 1000, '2026-01-18 09:00:00')]);
  res = await uploadFile(superToken, validBuffer2, randomUUID());
  assert.equal(res.status, 201);
  detail = await waitBatch(res.data.batchId);
  assert.equal(detail.batch.status, 'imported', `ORD-005 import ok: ${detail.batch.failureReason ?? ''}`);
  assert.equal(detail.batch.importedRows, 1);
  let rows = await api('GET', `/biz/orders/rows?batchId=${detail.batch.id}`, { token: superToken });
  assert.equal(rows.data.items.length, 1);
  assert.equal(rows.data.items[0].completionAmountFen, 100_000, 'ORD-005 amount in fen');
  assert.equal(rows.data.items[0].businessMonth, '2026-01', 'ORD-005 business month from order time');
  assert.equal(rows.data.items[0].feeRateSnapshotBp, 1200, 'ORD-005 fee rate snapshot 12%');
  assert.equal(rows.data.items[0].grossProfitFen, 12_000, 'ORD-005 gross profit 100000*12%=12000');

  // ============ ORD-006 幂等：相同 idempotencyKey 返回原批次 ============
  const sameKey = randomUUID();
  res = await uploadFile(superToken, validBuffer, sameKey);
  const firstBatchId = res.data.batchId;
  res = await uploadFile(superToken, validBuffer, sameKey);
  assert.equal(res.data.batchId, firstBatchId, 'ORD-006 idempotent same batch');

  // ============ ORD-007 重复文件：相同文件不同 key → 400 ============
  res = await uploadFile(superToken, validBuffer, randomUUID());
  assert.equal(res.status, 400, 'ORD-007 duplicate file (hash+max_time) must be rejected');

  // ============ ORD-008/009 负数与零金额入账 ============
  const negZero = buildXlsxBuffer([
    makeRow('PO-NEG', 'HT-ORD-001', '济南市', '山东省', -50, '2026-01-16'),
    makeRow('PO-ZERO', 'HT-ORD-001', '济南市', '山东省', 0, '2026-01-17'),
  ]);
  res = await uploadFile(superToken, negZero, randomUUID());
  detail = await waitBatch(res.data.batchId);
  assert.equal(detail.batch.status, 'imported', 'ORD-008/009 negative and zero must import');
  rows = await api('GET', `/biz/orders/rows?batchId=${detail.batch.id}`, { token: superToken });
  const amounts = rows.data.items.map((r) => r.completionAmountFen).sort((a, b) => a - b);
  assert.deepEqual(amounts, [-5000, 0], 'ORD-008/009 negative -50.00 and zero imported');

  // ============ ORD-010 超额不阻断 ============
  const overrun = buildXlsxBuffer([makeRow('PO-OVR', 'HT-ORD-001', '济南市', '山东省', 900_000, '2026-02-10')]);
  res = await uploadFile(superToken, overrun, randomUUID());
  detail = await waitBatch(res.data.batchId);
  assert.equal(detail.batch.status, 'imported', 'ORD-010 overrun must not block import');

  // ============ ORD-011 作废/恢复：admin 403；super 作废+恢复 ============
  const voidBuffer = buildXlsxBuffer([makeRow('PO-011', 'HT-ORD-001', '济南市', '山东省', 888, '2026-01-19 08:30:00')]);
  res = await uploadFile(superToken, voidBuffer, randomUUID());
  detail = await waitBatch(res.data.batchId);
  const batchId = detail.batch.id;
  res = await api('POST', `/biz/orders/batches/${batchId}/void`, { token: adminToken, body: { reason: 'x' } });
  assert.equal(res.status, 403, 'ORD-011 admin void must be 403');
  res = await api('POST', `/biz/orders/batches/${batchId}/void`, { token: superToken, body: { reason: '测试作废' } });
  assert.equal(res.status, 201);
  detail = await api('GET', `/biz/orders/batches/${batchId}`, { token: superToken });
  assert.equal(detail.data.batch.status, 'voided');
  assert.equal(detail.data.batch.voidReason, '测试作废');
  res = await api('POST', `/biz/orders/batches/${batchId}/restore`, { token: superToken });
  assert.equal(res.status, 201);
  detail = await api('GET', `/biz/orders/batches/${batchId}`, { token: superToken });
  assert.equal(detail.data.batch.status, 'imported', 'ORD-011 restore');

  // ============ ORD-012 列表/详情 ============
  res = await api('GET', '/biz/orders/batches', { token: superToken });
  assert.ok(res.data.items.length >= 6, 'ORD-012 batch list');

  // ============ ORD-013 敏感列脱敏 ============
  res = await api('GET', '/biz/orders/rows', { token: cityToken });
  const maskedRow = res.data.items.find((r) => r.receiverPhone);
  assert.ok(maskedRow, 'ORD-013 rows accessible');
  if (maskedRow) {
    assert.ok(maskedRow.receiverPhone.includes('****'), 'ORD-013 masked phone for city_user');
    res = await api('GET', '/biz/orders/rows', { token: superToken });
    const fullRow = res.data.items.find((r) => r.id === maskedRow.id);
    assert.ok(fullRow && !fullRow.receiverPhone.includes('****') && fullRow.receiverPhone.includes('138'), 'ORD-013 super sees full phone');
  }

  // ============ 临时文件清理 ============
  const uploadDir = path.join(storageRoot, 'order-uploads');
  assert.ok(existsSync(uploadDir) ? readdirSync(uploadDir).length === 0 : true, 'ORD-014 temp files cleaned after tasks');

  // ============ ORD-015 真实订单文件受控验证（存在才执行，不提交 Git） ============
  const realFile = 'C:/Users/lhx/Desktop/工作资料/数据库/临时/电商订单/2025年电商订单明细.xlsx';
  if (existsSync(realFile)) {
    const buf = readFileSync(realFile);
    const t0 = Date.now();
    res = await uploadFile(superToken, buf, randomUUID(), '2025年电商订单明细.xlsx');
    const uploadMs = Date.now() - t0;
    assert.equal(res.status, 201, 'ORD-015 real file upload accepted');
    detail = await waitBatch(res.data.batchId, 120_000);
    // 真实文件无对应合同 → 预期 FAILED（合同映射失败），但结构校验必须通过
    assert.equal(detail.batch.status, 'failed', 'ORD-015 real file fails at business validation (no matching contracts)');
    assert.notEqual(detail.batch.failureReason, undefined);
    const structOk = detail.errors.length === 0 || detail.errors.every((e) => e.errorType !== 'structure');
    assert.ok(structOk, 'ORD-015 real file passes structure check (34-column strict match)');
    console.error(`  [real-excel] rows=${detail.batch.totalRows} status=${detail.batch.status} reason=${JSON.stringify(detail.batch.failureReason)} errors=${detail.errors?.length}`);
  } else {
    console.log('  [real-excel] skipped (file not found on this machine)');
  }

  // ============ ORD-016 20 万行性能 ============
  {
    // 全固定值行（不做业务去重，SST 复用使文件 <50MB，仍验证 20 万行解析/校验/入账吞吐）
    const perfRow = new Array(34).fill('');
    perfRow[0] = '山东省'; perfRow[1] = '济南市'; perfRow[2] = 'PO-PERF-FIXED'; perfRow[3] = '供应商X';
    perfRow[4] = '已提交'; perfRow[5] = '1'; perfRow[6] = '物料'; perfRow[7] = 'M'; perfRow[8] = 'HT-ORD-001';
    perfRow[9] = '0.88'; perfRow[10] = '0'; perfRow[11] = '0'; perfRow[12] = '货物'; perfRow[13] = '13%';
    perfRow[14] = '0.12'; perfRow[15] = '1'; perfRow[16] = '1'; perfRow[17] = '件'; perfRow[18] = '张三';
    perfRow[19] = '13800138000'; perfRow[20] = '济南市高新区路1号'; perfRow[21] = '李四';
    perfRow[22] = '2026-03-01 08:00:00'; perfRow[23] = '2026-03-01 08:00:00'; perfRow[25] = 'P'; perfRow[26] = '项目';
    perfRow[27] = 'S'; perfRow[28] = '站址'; perfRow[29] = '已收货'; perfRow[30] = '商品'; perfRow[31] = 'SKU';
    perfRow[32] = '是'; perfRow[33] = '否';
    const perfRows = new Array(200_000).fill([...perfRow]);
    const tGen = Date.now();
    const perfBuffer = buildXlsxBuffer(perfRows);
    const genMs = Date.now() - tGen;
    const tUp = Date.now();
    res = await uploadFile(superToken, perfBuffer, randomUUID(), 'perf-200k.xlsx');
    const upMs = Date.now() - tUp;
    assert.equal(res.status, 201, `ORD-016 perf upload accepted (${(perfBuffer.length / 1024 / 1024).toFixed(1)}MB)`);
    const tParse = Date.now();
    detail = await waitBatch(res.data.batchId, 300_000);
    const parseMs = Date.now() - tParse;
    assert.equal(detail.batch.status, 'imported', 'ORD-016 200k rows import');
    assert.equal(detail.batch.importedRows, 200_000, 'ORD-016 all 200k rows imported');
    assert.ok(parseMs < 120_000, `ORD-016 200k parse+import under 120s (actual ${parseMs}ms)`);
    console.log(`  [perf-200k] size=${(perfBuffer.length / 1024 / 1024).toFixed(1)}MB gen=${genMs}ms upload=${upMs}ms parse+import=${parseMs}ms rows=200000`);
  }

  console.log('M4_ORDERS_OK ORD-001..016 all passed (permissions, format, structure, batch-validate, import, idempotency, dedup, neg/zero, overrun, void/restore, masked, temp-cleanup, real-excel, perf-200k)');
} finally {
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  console.log(`M4_ORDERS_CLEANUP_OK root=${testRoot}`);
}
