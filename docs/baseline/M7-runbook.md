# 维护管理经营数据中台 — 部署与运行手册（M7）

> 权威代码主线：`E:\code2\biz-reporting-system-authoritative`
> 版本：M7（迁移至 014 / 15 个迁移）
> 日期：2026-08-15

---

## 1. 系统结构

| 组件 | 技术栈 | 说明 |
|---|---|---|
| apps/api | NestJS 10 + TypeORM + MySQL 8 | 单体后端（含全部 biz_ 模块） |
| apps/admin-web | Vite 5 + React 18 + AntD 5 | 新基线前端（/#/biz/ 默认入口） |
| packages/shared-* | TypeScript | 共享类型与常量 |
| 数据库 | MySQL 8（生产）/ SQLite（开发与测试） | 迁移式管理，禁用 synchronize |

## 2. 环境变量

### 2.1 数据库（DB_TYPE / DB_DATABASE）
| 变量 | 说明 | 示例 |
|---|---|---|
| `DB_TYPE` | `sqlite` / `mysql` | `mysql` |
| `DB_DATABASE` | SQLite 绝对路径 或 MySQL 库名 | `./data/prod.sqlite` 或 `biz_reporting` |
| `DB_HOST` / `DB_PORT` | MySQL 主机/端口 | `127.0.0.1` / `3306` |
| `DB_USERNAME` / `DB_PASSWORD` | MySQL 账号 | `biz` / `***` |
| `DB_SYNC` | 必须 `false`（生产强制校验） | `false` |

### 2.2 认证安全
| 变量 | 说明 |
|---|---|
| `JWT_SECRET` | JWT 签名密钥（生产必须高强度随机） |
| `JWT_ISSUER` / `JWT_AUDIENCE` | 签发者/受众（默认 biz-reporting-api / biz-reporting-clients） |
| `JWT_EXPIRES_IN` | 令牌有效期（默认 8h） |
| `AUTH_SECURITY_HMAC_KEY` | 登录限流桶/审计哈希密钥 |
| `BIZ_SUPER_ADMIN_USERNAME` / `BIZ_SUPER_ADMIN_PASSWORD` | 初始化 super_admin（仅一次性使用） |

### 2.3 其他
| 变量 | 说明 |
|---|---|
| `PORT` | API 端口（默认 3000） |
| `FACT_SOURCE_STORAGE_ROOT` | 订单临时文件存储根（任务结束自动删除） |
| `NODE_ENV` | `production` 时强制 `DB_SYNC=false` |

## 3. 数据库初始化与迁移

```bash
# 1. 建库（MySQL）
CREATE DATABASE biz_reporting CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 2. 执行迁移（001-014，幂等可重跑）
# sqlite（开发）：
DB_TYPE=sqlite DB_DATABASE=./data/prod.sqlite node scripts/db/migrate.mjs up
# mysql（生产）：
DB_TYPE=mysql DB_DATABASE=biz_reporting DB_HOST=... DB_USERNAME=... DB_PASSWORD=... node scripts/db/migrate.mjs up

# 3. 初始化 super_admin（密码经环境变量注入，禁止默认密码/命令行参数）
BIZ_SUPER_ADMIN_USERNAME=admin BIZ_SUPER_ADMIN_PASSWORD='<强密码>' node scripts/auth/biz-init-super-admin.mjs
# 就绪检查：
BIZ_SUPER_ADMIN_USERNAME=admin node scripts/auth/biz-init-super-admin.mjs --check   # ready=1

# 4. 创建省级/地市账号（登录后经 系统管理→权限管理 创建）
```

迁移规则：新迁移只追加（015 起），不改旧文件/checksum；`scripts/db/migration-checksums.json` 记录 sha256，`pnpm migration-files:check` 校验。

## 4. 构建与部署

### 4.1 构建
```bash
pnpm install
pnpm --filter @biz-reporting/shared-types build
pnpm --filter @biz-reporting/api build       # apps/api/dist
pnpm --filter @biz-reporting/admin-web build # apps/admin-web/dist（Vite base 为相对路径 './'）
```

### 4.2 部署形态（三选一）
- **A. 同源部署（推荐）**：Nginx 将 `/` 指向前端 dist，`/api` 反代到后端；前端 `.env.production` 的 `VITE_API_BASE_URL=/api`，构建后无需改动。
- **B. 独立域名**：前端与 API 分域名；构建时 `VITE_API_BASE_URL=https://api.example.com/api`。
- **C. 子路径部署**：改 `vite.config.ts` 的 `base` 为 `/subpath/` 并重新构建；API 反代保持 `/api`。

### 4.3 后端启动
```bash
NODE_ENV=production DB_TYPE=mysql ... node apps/api/dist/main.js   # 或 PM2/systemd
```

### 4.4 前端访问
- 默认入口：`/#/biz/login`（根路径自动重定向）
- 旧版界面（已废弃，仅回退）：`/#/login`（页面顶部有废弃提示）

## 5. 账号与权限

| 角色 | 说明 | 菜单 |
|---|---|---|
| super_admin | 全部权限（通配），初始账号经 env 注入 | 全部 |
| admin | 省级运营：合同/订单/完工/成本填报与审核（成本审核需授权） | 经营管理（含分析） |
| contract_manager | 合同维护 | 合同（只读+维护） |
| city_user | 地市：本地市合同/完工/成本填报 | 本地市数据 |

- 成本审核授权：`系统管理 → 权限管理 → 用户 → 权限`，给 admin 添加例外 `operation.cost.approve`（重新登录生效）
- 数据范围：admin 默认全部省；city_user 强制绑定地市；可直接 URL 访问无权限页 → 403（后端守卫为最终边界）

## 6. 运维操作

| 操作 | 命令/入口 |
|---|---|
| 汇总重算 | 经营分析 → 全库重算（二次确认）；失败范围自动优先 |
| 一致性核对 | 经营分析 → 一致性核对（只告警，不自动改写） |
| 到期预警阈值 | 系统设置 → contract_expiry_warning_days（默认 90 天） |
| 迁移检查 | `pnpm migration-files:check` / `pnpm test:migrations:ledger` |
| 回归测试 | `pnpm test:unit` / `test:architecture` / `test:migrations:ledger` / `test:m2-rbac-auth` / `test:m3-contracts` / `test:m5-offcost` / `test:m6-aggregates` / `test:m7-views`（截图） |

## 7. 回滚

### 7.1 应用回滚
- 前端/后端均保留上一发布版本（dist 目录/容器镜像 tag），切换即可回退；前端资源名带 hash，旧页面缓存自动失效。
- **禁止 amend/force-push 已发布提交**；新提交以追加方式发布。

### 7.2 数据库回滚
- 迁移仅追加、不删除历史迁移文件；如需撤销某迁移，新增"撤销迁移"脚本（先备份，避免破坏 checksum 账本）。
- **回滚前必须备份**：`mysqldump biz_reporting > backup-<date>.sql`；SQLite：复制 .sqlite 文件。
- 数据回滚优先采用"业务级"方式（作废/恢复功能），而非 DDL 逆操作。

## 8. 已知限制（BLK 项）

| ID | 内容 | 状态 |
|---|---|---|
| BLK-1 | 隔离 MySQL 8 实例未提供；`test:migrations:mysql` 待实例到位后补跑 M1-M6 真实 MySQL 迁移与集成验证 | 开放 |
| BLK-2 | 旧 facts-v31 测试 Node24 原生崩溃（M8 退役旧事实工作台） | 开放 |
| BLK-3 | 非电商订单模板 8 列名变体（当前仅支持电商版 34 列） | 开放 |
| NEW-M6 | 增量重算为整库重算简化实现（大数据量需按范围优化） | 可延后 |
