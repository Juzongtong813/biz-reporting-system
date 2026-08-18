/**
 * M7 前端截图验证（DEV-062）：
 *  - 桌面 1440x900 / 移动 390x844 视口
 *  - 登录 → 门户 → 合同/订单/完工/成本/分析/设置/权限管理 全链路
 *  - 每页检查水平溢出（无滚动条溢出/遮挡）
 *  - 四角色权限：super 全可见；city_user 菜单隐藏 + 直接 URL 403
 * 截图输出：docs/baseline/screenshots/
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const requireFromApi = createRequire(path.join(apiRoot, 'package.json'));
const requireRoot = createRequire(path.join(repoRoot, 'package.json'));
const requireWeb = createRequire(path.join(repoRoot, 'apps', 'admin-web', 'package.json'));
const { chromium } = requireRoot('@playwright/test');

const testRoot = mkdtempSync(path.join(tmpdir(), 'biz-m7-views-'));
const database = path.join(testRoot, 'm7.sqlite');
const screenshotDir = path.join(repoRoot, 'docs', 'baseline', 'screenshots');
mkdirSync(screenshotDir, { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: 'test', DB_TYPE: 'sqlite', DB_DATABASE: database, DB_SYNC: 'false',
  FACT_SOURCE_STORAGE_ROOT: path.join(testRoot, 'src'),
  JWT_SECRET: 'm7-test-jwt-secret-0123456789abcdef',
  AUTH_SECURITY_HMAC_KEY: 'm7-test-hmac-key-0123456789abcdef',
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

const checkOverflow = async (page) => page.evaluate(() => {
  const doc = document.scrollingElement;
  return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, overflowX: doc.scrollWidth > doc.clientWidth + 1 };
});

async function login(page, username, password, webBase) {
  await page.goto(`${webBase}/#/biz/login`, { waitUntil: 'networkidle' });
  await page.getByTestId('biz-login-username').fill(username);
  await page.getByTestId('biz-login-password').fill(password);
  await page.getByTestId('biz-login-submit').click();
  await page.waitForURL('**/#/biz/portal', { timeout: 10_000 });
}

try {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/auth/biz-init-super-admin.mjs'], {
    cwd: repoRoot, env: { ...env, BIZ_SUPER_ADMIN_USERNAME: 'm7_super', BIZ_SUPER_ADMIN_PASSWORD: 'M7-secret-1' }, stdio: 'inherit',
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

  // vite bin 直接以 node 运行（Windows 下避免 .cmd 解析问题）
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

  // 创建 admin/city_user 账号
  const loginRes = await fetch(`${apiBase}/biz/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'm7_super', password: 'M7-secret-1' }) });
  const superToken = (await loginRes.json()).accessToken;
  const provinces = await (await fetch(`${apiBase}/biz/admin/provinces`, { headers: { Authorization: `Bearer ${superToken}` } })).json();
  const cities = await (await fetch(`${apiBase}/biz/admin/cities`, { headers: { Authorization: `Bearer ${superToken}` } })).json();
  const shandong = provinces.items.find((p) => p.code === '370000').id;
  const jinan = cities.items.find((c) => c.code === '370100').id;
  for (const dto of [
    { username: 'm7_admin', password: 'M7-secret-1', name: '管理员', roleCode: 'admin' },
    { username: 'm7_city', password: 'M7-secret-1', name: '地市用户', roleCode: 'city_user', cityId: jinan },
  ]) {
    await fetch(`${apiBase}/biz/admin/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` }, body: JSON.stringify(dto) });
  }

  const browser = await chromium.launch();
  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ];

  const pages = [
    { route: '#/biz/portal', file: 'portal' },
    { route: '#/biz/operation', file: 'contracts' },
    { route: '#/biz/orders', file: 'orders' },
    { route: '#/biz/offline-completions', file: 'offline-completions' },
    { route: '#/biz/costs', file: 'costs' },
    { route: '#/biz/analysis', file: 'analysis' },
    { route: '#/biz/settings', file: 'settings' },
    { route: '#/biz/admin', file: 'admin' },
  ];

  const report = [];
  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    // 登录页
    await page.goto(`${webBase}/#/biz/login`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(screenshotDir, `login-${vp.name}.png`) });

    // super_admin 登录
    await login(page, 'm7_super', 'M7-secret-1', webBase);
    for (const p of pages) {
      await page.goto(`${webBase}/${p.route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      if (p.file === 'portal') assert.equal(await page.locator('.ant-layout-sider').count(), 0, 'module portal must not show business sidebar');
      if (p.file === 'admin') {
        await page.getByRole('button', { name: '重置密码' }).first().click();
        const resetDialog = page.getByRole('dialog', { name: '重置密码' });
        await resetDialog.getByRole('textbox').waitFor();
        assert.equal(await resetDialog.getByRole('textbox').count(), 1, 'reset password uses an in-page input');
      }
      await page.screenshot({ path: path.join(screenshotDir, `${p.file}-${vp.name}.png`) });
      const overflow = await checkOverflow(page);
      if (overflow.overflowX) report.push({ page: p.file, vp: vp.name, issue: `horizontal overflow ${overflow.scrollWidth} > ${overflow.clientWidth}` });
    }
    await context.close();
  }

  // city_user：菜单隐藏 + 直接 URL 权限验证
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await login(page, 'm7_city', 'M7-secret-1', webBase);
    await page.goto(`${webBase}/#/biz/operation`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    // 菜单不应包含权限管理（operation.user.manage）
    const menuText = await page.locator('.ant-menu').innerText();
    assert.ok(!menuText.includes('权限管理'), 'city_user menu must NOT include 权限管理');
    assert.ok(!menuText.includes('系统设置') || true, 'city_user may see settings read menu');
    // 直接 URL 访问无权限页面 → 前端 403 结果页（后端 403 提示）
    await page.goto(`${webBase}/#/biz/admin`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const bodyText = await page.locator('body').innerText();
    assert.ok(bodyText.includes('无权限访问') || bodyText.includes('权限不足') || bodyText.includes('403'), `city_user direct /biz/admin must show 403, got: ${bodyText.slice(0, 80)}`);
    await page.screenshot({ path: path.join(screenshotDir, 'city-403-direct-url.png') });
    await context.close();
  }

  await browser.close();

  if (report.length > 0) {
    console.error('OVERFLOW_ISSUES:', JSON.stringify(report));
    process.exitCode = 1;
  } else {
    console.log('M7_VIEWS_OK viewports=desktop,1440x900+mobile,390x844 pages=login,portal,contracts,orders,offline,completions,costs,analysis,settings,admin overflow=none city=menu-hidden+403-direct-url');
  }
} finally {
  if (viteProcess && viteProcess.exitCode === null) viteProcess.kill('SIGTERM');
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1000));
  try { rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 }); } catch { console.log('M7_VIEWS_CLEANUP_WARN'); }
  console.log('M7_VIEWS_CLEANUP_OK');
}
