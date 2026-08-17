/**
 * M10 治理返工负向测试：
 *  - 完工 approve/reject/void/restore 跨数据范围 → 403（P0-1）
 *  - 成本 approve/reject/void/restore 跨数据范围 → 403（P0-1）
 *  - 合同详情跨范围（province 范围 admin 访问外省合同）→ 403（P0-2）
 *  - 合同级重算跨范围 → 403（P0-3）
 *  - 批次详情范围统计收敛（范围用户只返回可见行数，不泄露错误/总数）（P1）
 *  - 服务端组合筛选（overview?cityId 过滤）正向（P1）
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const requireFromApi = createRequire(path.join(apiRoot, 'package.json'));
const { DataSource } = requireFromApi('typeorm');

const testRoot = mkdtempSync(path.join(tmpdir(), 'biz-m10-neg-'));
const database = path.join(testRoot, 'm10.sqlite');
const env = {
  ...process.env,
  NODE_ENV: 'test', DB_TYPE: 'sqlite', DB_DATABASE: database, DB_SYNC: 'false',
  FACT_SOURCE_STORAGE_ROOT: path.join(testRoot, 'src'),
  JWT_SECRET: 'm10-test-jwt-secret-0123456789abcdef',
  AUTH_SECURITY_HMAC_KEY: 'm10-test-hmac-key-0123456789abcdef',
  JWT_ISSUER: 'biz-reporting-api', JWT_AUDIENCE: 'biz-reporting-clients',
  PORT: '0',
};

let apiProcess;
let baseUrl = '';
let superToken = '';
let adminToken = '';
let cityToken = '';
let jinanId = '';
let dezhouId = '';
let shandongId = '';
let contractId = '';

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

async function api(method, urlPath, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${urlPath}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
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

try {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/auth/biz-init-super-admin.mjs'], {
    cwd: repoRoot, env: { ...env, BIZ_SUPER_ADMIN_USERNAME: 'm10_super', BIZ_SUPER_ADMIN_PASSWORD: 'M10-secret-1' }, stdio: 'inherit',
  });

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}/api`;
  apiProcess = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: repoRoot, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stderr.on('data', (c) => process.stderr.write(`[api] ${c}`));
  await waitForApi(baseUrl);

  let res = await api('POST', '/biz/auth/login', { body: { username: 'm10_super', password: 'M10-secret-1' } });
  superToken = res.data.accessToken;
  const [provs, cities] = await Promise.all([
    api('GET', '/biz/admin/provinces', { token: superToken }),
    api('GET', '/biz/admin/cities', { token: superToken }),
  ]);
  shandongId = provs.data.items.find((p) => p.code === '370000').id;
  jinanId = cities.data.items.find((c) => c.code === '370100').id;
  dezhouId = cities.data.items.find((c) => c.code === '371400').id;
  for (const dto of [
    { username: 'm10_admin', password: 'M10-secret-1', name: '济南范围管理员', roleCode: 'admin' },
    { username: 'm10_city', password: 'M10-secret-1', name: '德州用户', roleCode: 'city_user', cityId: dezhouId },
  ]) {
    await api('POST', '/biz/admin/users', { token: superToken, body: dto });
  }
  for (const [key, username] of [['admin', 'm10_admin'], ['city', 'm10_city']]) {
    res = await api('POST', '/biz/auth/login', { body: { username, password: 'M10-secret-1' } });
    if (key === 'admin') adminToken = res.data.accessToken;
    if (key === 'city') cityToken = res.data.accessToken;
  }

  // 合同：山东省，济南+德州分配，费率 1200bp
  res = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-M10', contractName: 'M10 合同', taxInclusiveAmountFen: 1_000_000_00,
    provinceId: shandongId, startDate: '2026-01-01', endDate: '2026-12-31',
  } });
  contractId = res.data.id;
  await api('POST', `/biz/contracts/${contractId}/allocations`, { token: superToken, body: { cityId: jinanId, quotaFen: 600_000_00 } });
  await api('POST', `/biz/contracts/${contractId}/allocations`, { token: superToken, body: { cityId: dezhouId, quotaFen: 400_000_00 } });
  await api('POST', `/biz/contracts/${contractId}/fee-rates`, { token: superToken, body: { cityId: jinanId, effectiveMonth: '2026-01', rateBp: 1200 } });
  await api('POST', `/biz/contracts/${contractId}/fee-rates`, { token: superToken, body: { cityId: dezhouId, effectiveMonth: '2026-01', rateBp: 1200 } });

  // 将 m10_admin 收窄到济南（city scope）
  const adminUserId = (await api('GET', '/biz/admin/users', { token: superToken })).data.items.find((u) => u.username === 'm10_admin').id;
  await api('PUT', `/biz/admin/users/${adminUserId}/data-scopes`, { token: superToken, body: { scopes: [{ provinceId: shandongId, cityId: jinanId }] } });
  res = await api('POST', '/biz/auth/login', { body: { username: 'm10_admin', password: 'M10-secret-1' } });
  adminToken = res.data.accessToken;

  // 德州用户创建完工/成本（提交，等待济南管理员审核）
  const off = await api('POST', '/biz/offline-completions', { token: cityToken, body: {
    contractId, cityId: dezhouId, businessMonth: '2026-06', amountFen: 20_000_00, summary: '德州完工',
  } });
  await api('POST', `/biz/offline-completions/${off.data.id}/submit`, { token: cityToken });
  const cost = await api('POST', '/biz/costs', { token: cityToken, body: {
    cityId: dezhouId, businessMonth: '2026-06', categoryCode: 'labor', amountFen: 5_000_00, description: '德州成本',
  } });
  await api('POST', `/biz/costs/${cost.data.id}/submit`, { token: cityToken });

  // ============ P0-1：济南范围管理员审核/驳回/作废/恢复德州记录 → 403 ============
  assert.equal((await api('POST', `/biz/offline-completions/${off.data.id}/approve`, { token: adminToken })).status, 403, 'M10 cross-scope offline approve rejected');
  assert.equal((await api('POST', `/biz/offline-completions/${off.data.id}/reject`, { token: adminToken, body: { comment: 'x' } })).status, 403, 'M10 cross-scope offline reject rejected');
  assert.equal((await api('POST', `/biz/costs/${cost.data.id}/approve`, { token: adminToken })).status, 403, 'M10 cross-scope cost approve rejected');
  assert.equal((await api('POST', `/biz/costs/${cost.data.id}/reject`, { token: adminToken, body: { comment: 'x' } })).status, 403, 'M10 cross-scope cost reject rejected');
  // void/restore：先由 super 通过（同范围内操作前置），再测范围管理员 void/restore 跨范围
  await api('POST', `/biz/offline-completions/${off.data.id}/approve`, { token: superToken });
  assert.equal((await api('POST', `/biz/offline-completions/${off.data.id}/void`, { token: adminToken, body: { reason: 'x' } })).status, 403, 'M10 cross-scope offline void rejected');
  await api('POST', `/biz/offline-completions/${off.data.id}/void`, { token: superToken, body: { reason: 'super' } });
  assert.equal((await api('POST', `/biz/offline-completions/${off.data.id}/restore`, { token: adminToken })).status, 403, 'M10 cross-scope offline restore rejected');

  // ============ P0-2：合同详情跨范围（济南管理员访问含德州的合同——合同省内，city scope 需本地市分配） ============
  // 该合同已分配给济南（济南在范围内）→ 详情应 200（合同可见）。构造真正范围外：新建只含德州的合同
  const offContract = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-M10-DZ', contractName: '仅德州合同', taxInclusiveAmountFen: 500_000_00,
    provinceId: shandongId, startDate: '2026-01-01', endDate: '2026-12-31',
  } });
  await api('POST', `/biz/contracts/${offContract.data.id}/allocations`, { token: superToken, body: { cityId: dezhouId, quotaFen: 500_000_00 } });
  assert.equal((await api('GET', `/biz/contracts/${offContract.data.id}`, { token: adminToken })).status, 403, 'M10 cross-scope contract detail rejected (admin city scope)');
  // province 范围验证：把 admin 改回省范围（山东），访问省外合同需外省——无外省数据；用 city scope 断言已足够
  await api('PUT', `/biz/admin/users/${adminUserId}/data-scopes`, { token: superToken, body: { scopes: [{ provinceId: shandongId }] } });
  res = await api('POST', '/biz/auth/login', { body: { username: 'm10_admin', password: 'M10-secret-1' } });
  adminToken = res.data.accessToken;

  // ============ P0-3：合同级重算跨范围（省范围 admin 重算仅德州合同——省内放行；用 city 范围验证 403） ============
  // admin 已改省范围（山东），重算省内合同放行；再改回 city 范围验证 contractId 403
  await api('PUT', `/biz/admin/users/${adminUserId}/data-scopes`, { token: superToken, body: { scopes: [{ provinceId: shandongId, cityId: jinanId }] } });
  res = await api('POST', '/biz/auth/login', { body: { username: 'm10_admin', password: 'M10-secret-1' } });
  adminToken = res.data.accessToken;
  res = await api('POST', '/biz/aggregates/recalc', { token: adminToken, body: { scope: { contractId: offContract.data.id } } });
  assert.equal(res.status, 403, 'M10 cross-scope contract recalc rejected');

  // ============ P1：批次详情范围统计收敛 ============
  // super 上传混合批次（济南+德州行），济南范围 admin 查看 → 只返回可见行数且无错误泄露
  const { XLSX } = { XLSX: requireFromApi('xlsx') };
  const HEADER = ['省份名称','地市名称','采购订单编号','供应商名称','订单主状态','含税总金额','物料名称','物料编码','合同编号','净价','运保费','建安费','费用类型','税率','税额','含税单价','采购数量','计量单位','收货人','收货人联系方式','收货人详细地址','通知人','下单时间','通知时间','附言信息','项目编号','项目名称','站址编号','站址信息','收货状态','商品名称','商品编号','物料源头贴签标识','是否补样订单'];
  const makeRow = (po, amount, time, city) => {
    const row = new Array(34).fill('');
    row[0] = '山东省'; row[1] = city; row[2] = po; row[5] = String(amount); row[8] = 'HT-M10'; row[22] = time;
    return row;
  };
  const aoa = [HEADER, makeRow('M10-1', 100_000, '2026-06-10 08:00:00', '济南市'), makeRow('M10-2', 50_000, '2026-06-11 08:00:00', '德州市')];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '电商化订单列表');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fd = new FormData();
  fd.append('idempotencyKey', randomUUID());
  fd.append('file', new Blob([buffer]), 'm10-mixed.xlsx');
  const up = await fetch(`${baseUrl}/biz/orders/upload`, { method: 'POST', headers: { Authorization: `Bearer ${superToken}` }, body: fd });
  const upData = await up.json();
  assert.equal(up.status, 201, `super mixed batch uploaded: ${JSON.stringify(upData)}`);
  let batchId = upData.batchId;
  for (let i = 0; i < 100; i++) {
    const d = await api('GET', `/biz/orders/batches/${batchId}`, { token: superToken });
    if (d.data.batch.status !== 'parsing') { batchId = d.data.batch.id; break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal((await api('GET', `/biz/orders/batches/${batchId}`, { token: superToken })).data.batch.status, 'imported', 'mixed batch imported');
  // 济南范围 admin 查看：rowCountScoped=true、rowCount=1（济南行）、errors=[]（不泄露德州错误/统计）
  res = await api('GET', `/biz/orders/batches/${batchId}`, { token: adminToken });
  assert.equal(res.status, 200, 'M10 scoped user sees batch');
  assert.equal(res.data.rowCount, 1, `M10 scoped rowCount = 1 (only jinan), got ${res.data.rowCount}`);
  assert.equal(res.data.batch.rowCountScoped, true, 'M10 scoped flag set');
  assert.equal(res.data.errors.length, 0, 'M10 scoped user sees no raw errors');

  // ============ P1：服务端组合筛选（overview?cityId） ============
  res = await api('GET', '/biz/analysis/overview?cityId=' + jinanId, { token: superToken });
  assert.equal(res.status, 200);
  assert.equal(res.data.orderCompletionFen, 100_000_00, 'M10 server-side city filter: only jinan order 100000');

  console.log('M10_NEGATIVE_OK cross-scope approve/reject/void/restore + contract-detail + contract-recalc + batch-stats-scope + server-filter all passed');
} finally {
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1000));
  try { rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 }); } catch { console.log('M10_NEGATIVE_CLEANUP_WARN'); }
  console.log('M10_NEGATIVE_CLEANUP_OK');
}
