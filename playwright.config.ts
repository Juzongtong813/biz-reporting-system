import { defineConfig } from '@playwright/test';

/**
 * E-05：Playwright 路由与认证回归（PG-R9/R11）
 * - 静态服务器：由 spec 内 beforeAll 启动（serve E-04 hosting-bundle：根 + /dataofearth/ + hash 深链）。
 * - 项目：desktop / mobile 双视口。
 * - 证据：trace + 截图（retain-on-failure）；不含 token（测试不注入真实凭据）。
 */
export default defineConfig({
  testDir: './apps/admin-web/e2e',
  timeout: 60_000,
  // 静态服务器固定端口 4174：单 worker 串行避免多 worker 端口冲突
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: 'evidence/governance/e2e-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
});
