# 经营数据中台部署门禁

> 当前状态：`RBAC_AND_FEATURES_IMPLEMENTED_NOT_DEPLOYABLE`。本文只定义部署前门禁和非生产验收步骤，不授权部署或访问任何生产资源。

## 目标服务与运行形态（F-02 对齐）

- **staging CloudRun 服务名（唯一）**：`biz-reporting-api-v3-staging`（EnvId=zy-data-d2g9g1ghr47ac6254）。
  `cloudbaserc.json`（根与 `apps/api/`）与 `scripts/deploy.js` 均已统一为此名；**任何其它服务名一律拒绝部署**。
- **部署命令的 CLI 参数**（仅 CLI 3.5.6 `tcb cloudrun deploy` 支持项）：`--serviceName <服务名>`、`--source <绝对路径>`、`--port <端口>`、`--traffic`、`--json`。**不得使用 `-e`/`--commit`**（非 deploy 合法参数）。
- **EnvId 注入**：`EnvId=zy-data-d2g9g1ghr47ac6254` 通过 `TCB_ENV_ID` 环境变量经部署脚本的子进程 env 显式注入（不依赖 tcb CLI current env），并由两个 `cloudbaserc.json`（根 + apps/api）的 envId 字段交叉核验一致。
- **受控部署入口**：`scripts/deploy.js`（唯一受控入口）。部署前强制运行治理门禁链（governance-gates + governance-evidence + release-integrity --gate）；**任一 gate 非 PASS 时脚本非零退出并禁止部署**。**已删除旧版自动交互绕过**（原脚本用 stdin 注入 Down/Enter/Y 按键跳过 CLI 交互确认——该自动绕过已移除）；CLI 在门禁通过后的人工确认属于正常保护，脚本不注入任何自动按键。`--json` 为结构化输出参数，**不代表跳过确认**。
- **运行形态**：Container mode（非函数/非 scf_bootstrap）；`MinNum >= 1`（保持至少一个常驻实例）；P0 阶段 `MaxNum = 1`（单实例，多实例限流/状态一致性未验收前不得扩副本）；health 路径为 `/api/health/live`（存活）与 `/api/health/ready`（就绪，含 database/storage 探针）。

## 生产配置独立（禁止字符串替换）

- **生产配置必须独立定义**，不得通过字符串替换 staging 配置生成（例如把 `DEPLOY_ENV=staging` 全局替换为 `production` 或把 staging 的 `JWT_SECRET`/`DB_PASSWORD` 原样带往生产）。
- 每个环境的密钥/口令/配置项单独生成、单独注入；staging 与生产使用完全不同的凭据。
- 生产部署使用独立配置清单（由 G-01/G-03 阶段批准），本文件不包含任何生产凭据真值。

## 禁止范围

- 不得连接或修改 `zy-data`、公网 `biz-reporting-api-v3-staging`、默认 schema、共享开发库、生产数据库、生产 COS、生产持久卷或现有公网服务。
- 不得使用 `DB_*`、默认 root、本机 MySQL 或已有业务库替代隔离验收凭据。
- 不得执行应用启动期自动迁移、自动播种或自动选择根账号。

## 运行配置

部署候选环境必须显式设置：

```env
NODE_ENV=production
DEPLOY_ENV=staging
DB_SYNC=false
JWT_SECRET=<独立强随机值>
FACT_SOURCE_STORAGE_ROOT=/mnt/fact-source-files
```

- `JWT_SECRET` 缺失或为空时 API 必须在配置初始化阶段拒绝启动。
- 生产模式强制 `synchronize=false`，新表只能由经批准的迁移创建。
- `/mnt/fact-source-files` 必须是真实持久卷挂载点或改用已实现并验收的 COS；容器本地目录不算通过。

## 迁移上线顺序

1. 在独立 staging/演练环境提供四项 `MIGRATION_TEST_MYSQL_*`。
2. 运行 `node scripts/db/migrate.mjs check-files`。
3. 运行 `pnpm test:migrations:mysql`，验证临时 schema、8 行账本、007 结构、第二根拒绝、幂等、失败账本和自动清理。
4. 对目标 staging 数据库执行 `db:migrate:precheck -> db:migrate -> db:migrate:status -> db:migrate -> db:migrate:status`。
5. 运行 `auth:root-readiness`，确认恰好一个 `root_admin`；需要提升时只使用显式 `auth:promote-root`。
6. 部署 API，再部署 Web；不得由应用启动自动执行 DDL。

当前没有真实 MySQL 凭据，以上步骤未执行。

## 回滚策略

- SQL 迁移采用只前进策略，不修改 001–007，不在未知数据状态下自动 down。
- 上线前同时备份目标数据库与原始文件持久卷/COS，并记录一致恢复点。
- 失败时停止新实例和写入，保留失败账本与日志；从同一恢复点联合恢复数据库和文件。
- 结构回退需要新增经审核的补偿迁移，禁止改写历史迁移 checksum。

## 持久存储验收

必须在非生产隔离环境完成：

1. 确认 `/mnt/fact-source-files` 为平台真实挂载或切换到 COS。
2. 上传真实格式测试文件并核对 storage key、大小、时间、批次和血缘。
3. 重启 API 后下载并核对 SHA-256。
4. 删除并重建运行实例后再次核对。
5. 同周期备份数据库和文件，恢复到全新隔离环境。
6. 对批次、来源行、事实、版本、审计和文件 SHA-256 做联合核对。
7. 未挂载、错误挂载、只读挂载及不同步恢复必须拒绝或报警。

当前仅 `pnpm test:storage-gate` 的路径启动预检通过；真实挂载和恢复为 `BLOCKED`。

## 浏览器验收

必须使用隔离 MySQL 后端和真实浏览器：

- 四角色登录及菜单/API 正反权限
- 临时密码强制改密、普通改密、旧密码和旧 JWT 失效
- 跨地市 URL/API 拒绝和退出/刷新恢复
- Dashboard、CityEstimate、地市总览、数据、合同、成本、订单逐页筛选并下载 XLSX
- 对照工作表、范围、行数、金额、比例、汇总及导出审计

当前浏览器运行时不可用，因此该门禁为 `BLOCKED`，不能由静态检查或 Node XLSX 测试替代。

## 生产维护窗口准入

只有 REAL_MYSQL、BROWSER、EXPORT_FILES、PERSISTENT_STORAGE、FACT_MODEL_UNIFICATION 全部关闭并经产品与运维负责人批准后，才能安排生产维护窗口。当前禁止部署。
