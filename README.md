# 经营数据中台

NestJS + TypeORM + React 18 + Ant Design 5 的经营数据汇聚、治理、合同、事实数据和分析平台。

## 2026-08-17 发布基线

治理已批准在现有 CloudBase 环境 `zy-data-d2g9g1ghr47ac6254` 内采用隔离发布：生产 schema 为 `biz_reporting_prod`，API 服务为 `biz-reporting-api-prod`，旧主库 `zy-data-d2g9g1ghr47ac6254` 保留只读回退用途。三个历史 staging schema 已按授权删除。生产部署不得使用旧服务、旧 schema 或旧凭据。

## 当前状态

`ISOLATED_PRODUCTION_DEPLOYMENT_IN_PROGRESS`

See [current deployment status](docs/current-deployment-status.md) for the active production resources, the temporary upload lifecycle decision, and the remaining release conditions.

代码和隔离 SQLite 自动化已覆盖四角色 RBAC、账号安全、临时密码、微信邀请、页面导出、用户设置及事实口径声明。但以下门禁尚未关闭：

- 隔离真实 MySQL 001–007 全迁移与认证/RBAC 集成验收
- 四角色真实浏览器与逐页 XLSX 下载对照
- 非生产持久卷/COS 的重启、实例重建和联合备份恢复
- 旧报表包与 V3 事实模型的最终退出迁移
- Admin Facts 完整多地市查询闭环

上面的不可部署说明属于历史基线；当前生产变更必须严格使用本节指定的隔离 schema、服务名和独立凭据，并保留旧主库作为回退资源。

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
