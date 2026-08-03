// ESLint 9 flat config — F-03 ESLint 专项（Codex PG-20260803-LOCAL-I1-ALTERNATIVE 第一节纠偏）
// 基线：typescript-eslint recommended（完整解析 TS/TSX）
// 覆盖：根级显式覆盖 API、Admin、e2e、mocks、Vite、Playwright、shared packages
// 不得 ignore TS/TSX；vite.config.ts/playwright.config.ts/e2e/**/mocks/** 必须纳入 lint；
// public/mockServiceWorker.js 作为第三方生成 JS 可继续排除。
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // 全局基础：忽略构建产物与第三方生成目录
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      '**/data/**',
      '**/deploy-output/**',
      '**/deploy-test/**',
      '**/deploy-flat/**',
      '**/analysis-output/**',
      '**/db-import-backups/**',
      '**/db-cleanup-backups/**',
      '**/db-import-logs/**',
      '**/cloudfunctions/**',
      '**/miniprogram/**',
      '**/codebuddy-plugin/**',
      '**/public/mockServiceWorker.js',
      // vite 生成的类型声明产物（非手写源码）
      '**/vite.config.d.ts',
      // 证据归档与历史快照（非工作源码，B-01 已分类 EXCLUDE）
      '.cloudrun-deploy-20260722/**',
      'evidence/governance/B-02-003-source-archive/**',
      'scripts/release/out/**',
      '.gstack/**',
      'test-results/**',
      'evidence/governance/e2e-report/**',
    ],
  },
  // TypeScript/TSX 文件：typescript-eslint recommended 基线
  // 根级显式覆盖：API src/test、Admin src/e2e、mocks、vite.config、playwright.config、shared packages
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: [
      'apps/api/src/**/*.ts',
      'apps/api/test/**/*.ts',
      'apps/api/test/**/*.cjs',
      'apps/admin-web/src/**/*.ts',
      'apps/admin-web/src/**/*.tsx',
      'apps/admin-web/e2e/**/*.ts',
      'apps/admin-web/e2e/**/*.tsx',
      'apps/admin-web/src/mocks/**/*.ts',
      'apps/admin-web/src/mocks/**/*.tsx',
      'apps/admin-web/vite.config.ts',
      'apps/admin-web/playwright.config.ts',
      'playwright.config.ts',
      'packages/shared-types/src/**/*.ts',
      'packages/shared-constants/src/**/*.ts',
    ],
  })),
  // 项目特定规则细化（行为保持型，最小必要）
  {
    files: [
      'apps/api/src/**/*.ts',
      'apps/api/test/**/*.ts',
      'apps/admin-web/src/**/*.tsx',
      'apps/admin-web/src/**/*.ts',
      'apps/admin-web/e2e/**/*.ts',
      'apps/admin-web/e2e/**/*.tsx',
      'apps/admin-web/src/mocks/**/*.ts',
      'apps/admin-web/src/mocks/**/*.tsx',
      'apps/admin-web/vite.config.ts',
      'apps/admin-web/playwright.config.ts',
      'playwright.config.ts',
      'packages/shared-types/src/**/*.ts',
      'packages/shared-constants/src/**/*.ts',
    ],
    rules: {
      // NestJS/React 常见模式允许显式 any（既有代码风格），但保持 no-explicit-any 告警为 warn 以可审计
      '@typescript-eslint/no-explicit-any': 'warn',
      // 允许未使用参数（NestJS 注入占位常见），未使用变量仍为 error
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // NestJS 类方法常无显式返回类型，recommended 已关闭 explicit-function-return-type（保持默认 off）
    },
  },
  // 通用 JS 规则（对 .cjs/.mjs 测试文件与根级配置文件）
  {
    files: [
      'apps/api/test/**/*.cjs',
      'apps/api/test/**/*.mjs',
      'scripts/**/*.mjs',
      'scripts/**/*.cjs',
      '*.config.mjs',
      '*.config.js',
      '*.config.cjs',
    ],
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // CommonJS 测试文件使用 require 属合法模式（Node 原生模块加载）
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
