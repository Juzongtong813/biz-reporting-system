# 经营数据中台

NestJS + TypeORM + React 18 + Ant Design 5 的经营数据汇聚、治理、合同、事实数据和分析平台。

## 当前状态

`RBAC_AND_FEATURES_IMPLEMENTED_NOT_DEPLOYABLE`

代码和隔离 SQLite 自动化已覆盖四角色 RBAC、账号安全、临时密码、微信邀请、页面导出、用户设置及事实口径声明。但以下门禁尚未关闭：

- 隔离真实 MySQL 001–007 全迁移与认证/RBAC 集成验收
- 四角色真实浏览器与逐页 XLSX 下载对照
- 非生产持久卷/COS 的重启、实例重建和联合备份恢复
- 旧报表包与 V3 事实模型的最终退出迁移
- Admin Facts 完整多地市查询闭环

不得连接或修改 `zy-data`、公网 `biz-reporting-api-v3-staging`、默认 schema、共享开发库或任何生产资源。

## 工作区

| 子系统 | 技术 |
|---|---|
| API | NestJS、TypeORM、MySQL/隔离 SQLite |
| Admin/地市 Web | React 18、Ant Design 5、Vite |
| Shared Types | TypeScript workspace package |
| 小程序 | 原生微信小程序，使用受控邀请绑定 |

## 本地开发

```bash
pnpm install
pnpm dev:api
pnpm dev:admin
```

开发环境数据库必须显式配置。不要使用或修改 `apps/api/data/dev.sqlite` 作为验收库。

## 构建与自动化

```bash
pnpm --filter @biz-reporting/shared-types typecheck
pnpm --filter @biz-reporting/shared-types build
pnpm --filter @biz-reporting/api exec tsc --noEmit
pnpm --filter @biz-reporting/api build
pnpm --filter @biz-reporting/admin-web exec tsc -b --pretty false
pnpm --filter @biz-reporting/admin-web build

node scripts/db/migrate.mjs check-files
pnpm test:rbac-auth-export-settings
pnpm test:storage-gate
pnpm test:architecture
```

真实 MySQL 只允许使用四项隔离凭据：

```text
MIGRATION_TEST_MYSQL_HOST
MIGRATION_TEST_MYSQL_PORT
MIGRATION_TEST_MYSQL_USER
MIGRATION_TEST_MYSQL_PASSWORD
```

凭据缺失、host 为本机、用户为 root 或处于生产模式时，`pnpm test:migrations:mysql` 必须硬失败，不能回退到 `DB_*`。

## 迁移

- `001_initial_tables.sql` 与 Git 基线一致。
- `invoice_amount`、`order_amount` 由 `002_add_contract_month_invoice_order_amount.sql` 添加。
- 当前迁移共 8 个文件，版本到 `007_rbac_auth`。
- `scripts/db/migration-checksums.json` 固定全部迁移 checksum。
- 生产 `synchronize=false`；应用启动不自动执行 DDL 或播种根账号。

## 规格与证据

- [需求](specs/rbac-auth-export-settings/requirements.md)
- [设计](specs/rbac-auth-export-settings/design.md)
- [任务状态](specs/rbac-auth-export-settings/tasks.md)
- [端点权限矩阵](specs/rbac-auth-export-settings/endpoint-permission-matrix.md)
- [验收报告](specs/rbac-auth-export-settings/validation-report.md)
- [迁移与血缘运行手册](docs/v3.1-migration-lineage-runbook.md)
- [部署门禁](docs/deployment-guide.md)
