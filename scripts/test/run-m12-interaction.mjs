/**
 * M12 浏览器级交互测试（DEV-13，治理五次复核）：
 *  - 经营分析页组合筛选控件可操作：月份选择器（yyyy年mm月）、地市选择器、清空筛选按钮、导出当前视图按钮
 *  - 月份/库存口径明确标识（月份仅影响经营金额；合同库存累计口径；提醒不受月份筛选影响）
 *  - 趋势表/一致性警告月份显示统一 yyyy年mm月
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireRoot = createRequire(path.join(repoRoot, 'package.json'));
const requireWeb = createRequire(path.join(repoRoot, 'apps', 'admin-web', 'package.json'));
const { chromium } = requireRoot('@playwright/test');

const testRoot = mkdtempSync(path.join(tmpdir(), 'biz-m12-interact-'));
const database = path.join(testRoot, 'm12.sqlite');

const env = {
  ...process.env,
  NODE_ENV: 'test', DB_TYPE: 'sqlite', DB_DATABASE: database, DB_SYNC: 'false',
  FACT_SOURCE_STORAGE_ROOT: path.join(testRoot, 'src'),
  JWT_SECRET: 'm12-test-jwt-secret-0123456789abcdef',
  AUTH_SECURITY_HMAC_KEY: 'm12-test-hmac-key-0123456789abcdef',
  JWT_ISSUER: 'biz-reporting-api', JWT_AUDIENCE: 'biz-reporting-clients',
  PORT: '0',
};

let apiProcess;
let viteProcess;

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

async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status >= 200 && res.status < 500) return;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`not ready: ${url}`);
}

async function api(base, method, urlPath, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${urlPath}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

try {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/auth/biz-init-super-admin.mjs'], {
    cwd: repoRoot, env: { ...env, BIZ_SUPER_ADMIN_USERNAME: 'm12_super', BIZ_SUPER_ADMIN_PASSWORD: 'M12-secret-1' }, stdio: 'inherit',
  });

  const apiPort = await freePort();
  const webPort = await freePort();
  const apiBase = `http://127.0.0.1:${apiPort}/api`;
  const webBase = `http://127.0.0.1:${webPort}`;

  apiProcess = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: repoRoot, env: { ...env, PORT: String(apiPort) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stderr.on('data', (c) => process.stderr.write(`[api] ${c}`));
  await waitForHttp(`${apiBase}/biz/auth/me`);

  const viteEntry = requireWeb.resolve('vite');
  const vitePkgRoot = path.dirname(path.dirname(path.dirname(viteEntry)));
  const viteBin = path.join(vitePkgRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  viteProcess = spawn(process.execPath, [viteBin, '--port', String(webPort), '--strictPort'], {
    cwd: path.join(repoRoot, 'apps', 'admin-web'),
    env: { ...process.env, VITE_DEV_API_TARGET: `http://127.0.0.1:${apiPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  viteProcess.stderr.on('data', (c) => process.stderr.write(`[vite] ${c}`));
  await waitForHttp(`${webBase}/`);

  // 种子数据：合同 + 济南分配 + 完工（趋势/筛选/提醒有数据）
  const loginRes = await api(apiBase, 'POST', '/biz/auth/login', { body: { username: 'm12_super', password: 'M12-secret-1' } });
  const superToken = loginRes.data.accessToken;
  const provinces = (await api(apiBase, 'GET', '/biz/admin/provinces', { token: superToken })).data;
  const cities = (await api(apiBase, 'GET', '/biz/admin/cities', { token: superToken })).data;
  const shandong = provinces.items.find((p) => p.code === '370000').id;
  const jinan = cities.items.find((c) => c.code === '370100').id;
  const endFar = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const c = (await api(apiBase, 'POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-M12', contractName: 'M12 交互合同', taxInclusiveAmountFen: 500_000_00,
    provinceId: shandong, startDate: '2026-01-01', endDate: endFar,
  } })).data;
  await api(apiBase, 'POST', `/biz/contracts/${c.id}/allocations`, { token: superToken, body: { cityId: jinan, quotaFen: 500_000_00 } });
  const off = (await api(apiBase, 'POST', '/biz/offline-completions', { token: superToken, body: {
    contractId: c.id, cityId: jinan, businessMonth: '2026-06', amountFen: 100_000_00, summary: 'M12 完工',
  } })).data;
  await api(apiBase, 'POST', `/biz/offline-completions/${off.id}/submit`, { token: superToken });
  await api(apiBase, 'POST', `/biz/offline-completions/${off.id}/approve`, { token: superToken });
  await api(apiBase, 'POST', '/biz/aggregates/recalc', { token: superToken, body: { scope: {}, confirmAll: true } });

  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  // 登录
  await page.goto(`${webBase}/#/biz/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('账号').fill('m12_super');
  await page.getByPlaceholder('密码').fill('M12-secret-1');
  await page.getByRole('button', { name: '登 录' }).click();
  await page.waitForURL('**/#/biz/portal', { timeout: 10_000 });
  await page.goto(`${webBase}/#/biz/analysis`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ============ 1. 筛选/导出控件存在 ============
  assert.ok(await page.getByText('月份筛选（经营金额）').first().isVisible().catch(() => false), 'M12 month Select rendered');
  assert.ok(await page.getByText('地市筛选').first().isVisible().catch(() => false), 'M12 city Select rendered');
  assert.ok(await page.getByRole('button', { name: '导出当前视图' }).isVisible().catch(() => false), 'M12 export button rendered');

  // ============ 2. 口径标识文案 ============
  const pageText = await page.locator('body').innerText();
  assert.ok(pageText.includes('累计库存口径'), 'M12 inventory cumulative label present');
  assert.ok(pageText.includes('不受月份筛选影响'), 'M12 alerts month-independent label present');

  // ============ 3. 趋势表月份显示 yyyy年mm月 ============
  const monthCells = await page.getByText(/^\d{4}年\d{2}月$/).allInnerTexts();
  assert.ok(monthCells.length >= 1, `M12 trend month cells formatted yyyy年mm月: ${JSON.stringify(monthCells)}`);
  assert.ok(monthCells.some((t) => t === '2026年06月'), `M12 trend shows 2026年06月: ${JSON.stringify(monthCells)}`);

  // ============ 4. 交互：选月份 → 清空筛选出现 → 清空 → 恢复 ============
  await page.locator('.ant-select').first().click();
  await page.waitForTimeout(600);
  await page.locator('.ant-select-item-option').first().click();
  await page.waitForTimeout(600);
  assert.ok(await page.getByRole('button', { name: '清空筛选' }).isVisible().catch(() => false), 'M12 clear-filter button appears after selecting month');
  await page.getByRole('button', { name: '清空筛选' }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.getByRole('button', { name: '清空筛选' }).count(), 0, 'M12 clear-filter hidden after clear');

  // ============ 5. 导出触发下载 ============
  const downloadPromise = page.waitForEvent('download', { timeout: 10_000 }).catch(() => null);
  await page.getByRole('button', { name: '导出当前视图' }).click();
  const download = await downloadPromise;
  assert.ok(download, 'M12 export triggers download');

  await browser.close();
  console.log('M12_INTERACTION_OK filter/export controls + month format yyyy年mm月 + cumulative/alerts labels + clear-filter all passed');
} finally {
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill('SIGTERM');
  if (viteProcess && viteProcess.exitCode === null) viteProcess.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1000));
  try { rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 }); } catch { console.log('M12_INTERACTION_CLEANUP_WARN'); }
  console.log('M12_INTERACTION_CLEANUP_OK');
}
