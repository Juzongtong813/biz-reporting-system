# 专家团队质量审查与功能测试交接单

更新时间：2026-08-18
建议审查范围：全链路（产品验收、功能测试、权限与安全审计、代码审查、数据库审计、发布与回滚检查）

## 1. 审查基线与当前状态

- 项目代码绝对路径：`E:\code2\biz-reporting-system-authoritative`
- Git 分支：`recovery/production-governance-20260803`
- 审查提交：以交接时 `git rev-parse HEAD` 输出为准。
- 本轮本地变更已经完成验证，但按项目负责人要求尚未重新上传或部署。
- 因此，下列 CloudBase URL 当前仍是上一部署版本，不能用于验收本轮登录页、模块入口侧栏和密码重置修复；这三项应先做源码/本地测试，待重新部署后再做线上黑盒回归。

本轮变更验收点：

1. `/biz/portal` 和 `/biz/maintenance` 两级模块门户不显示经营管理侧栏；进入经营管理具体业务页面后才显示侧栏。
2. 账号管理的“重置密码”改为站内密码输入弹窗，包含至少 6 位校验、提交等待态和接口错误提示，不再调用 `window.prompt`。
3. 经营系统登录页按 `E:\code2\prototype\login-v2.html` 重构，同时保留真实账号密码登录、令牌保存、记住账号和登录后跳转逻辑。
4. Chromium 和 WebKit 均覆盖登录、月份筛选、地市筛选、清空筛选、当前视图 CSV 导出；CSV 验证包括内容、列数、地市名称和金额字段。

## 2. 线上受控测试入口

- CloudBase 环境：`zy-data-d2g9g1ghr47ac6254`（zy-data）
- 前端 URL：`https://biz-reporting-prod-zy-data-d2g9g1ghr47ac6254.webapps.tcloudbase.com`
- API 基地址：`https://biz-reporting-api-prod-265611-4-1362656322.sh.run.tcloudbase.com/api`
- 存活检查：`GET /api/health/live`
- 就绪检查：`GET /api/health/ready`
- 登录方式：系统用户名和密码；不使用微信登录。
- 管理员测试账号：`super_admin`
- 密码和生产密钥不得写入代码、文档、工单或聊天记录，由项目负责人通过指定安全渠道单独交接；交接后应强制修改。

注意：本轮代码尚未部署，现有线上 URL 只适合回归上一部署基线。若测试团队没有可用密码，登录态黑盒测试处于阻塞状态，应由治理负责人执行受控密码重置后再交接，不能从数据库读取或恢复明文密码。

## 3. 技术栈与运行环境

| 层级 | 技术 |
| --- | --- |
| 仓库 | pnpm workspace 单仓，Node.js >= 18，pnpm 9.15.0，TypeScript 5.6 |
| Web 前端 | React 18.3、React Router 6.28、Ant Design 5.22、TanStack Query 5.60、Axios 1.7、Day.js、Vite 5.4、xlsx 0.20.3 |
| API 后端 | NestJS 10.4、TypeORM 0.3、MySQL2 3.11、JWT/Passport、bcryptjs、Helmet、Throttler、Swagger、class-validator、Multer |
| 数据库 | 生产 MySQL 8；自动化测试使用 SQLite/MySQL gate |
| 浏览器测试 | Playwright 1.62，Chromium + WebKit（Safari 兼容验证入口） |
| 部署 | 腾讯云 CloudBase 静态托管 + CloudRun 容器服务 |

生产构建存在一个非阻断警告：主前端 chunk 约 987 kB（gzip 约 320 kB），超过 Vite 500 kB 提示线。建议专家团队将首屏加载、弱网体验和进一步拆包作为性能审查项，不应作为本轮功能修复失败条件。

## 4. 产品与验收依据

核心需求与业务口径：

- `docs\经营数据中台总纲.md`
- `docs\数据字典-v1.md`
- `docs\baseline\golden-samples.json`
- `docs\baseline\taskbook-confirmation-v1.0.md`
- `docs\用户端使用手册-精简版.md`

阶段验收与回归依据：

- `docs\baseline\M0-baseline-report.md`
- `docs\baseline\M1-milestone-report.md` 至 `M8-milestone-report.md`
- `docs\baseline\M7-runbook.md`
- `docs\baseline\M8-mysql-verification-plan.md`
- `docs\baseline\release-preflight-report.md`
- `docs\baseline\screenshots\`（桌面端、移动端、越权 403 证据）

接口、数据库与发布资料：

- OpenAPI 初始清单：`docs\biz-reporting-openapi-initial.yaml`
- MySQL DDL：`docs\biz-reporting-mysql-ddl.sql`
- 实际追加式迁移：`apps\api\migration\`（001-017，共 18 个迁移账本项）
- 当前部署状态：`docs\current-deployment-status.md`
- 部署说明：`docs\deployment-guide.md`
- 故障与回滚：`docs\deployment-incident-runbook.md`
- 导入文件迁移：`docs\import-job-file-migration-runbook.md`

审查时应以当前控制器、DTO、服务和迁移代码为最终事实；`biz-reporting-openapi-initial.yaml` 是初始清单，需同时检查是否存在实现演进后未同步的接口漂移。

## 5. 功能与安全重点

业务主链路：

1. 登录、两级门户、模块可见权限和经营模块左侧分类导航。
2. 合同唯一性、合同状态机、合同地市分配、费率快照和详情数据范围裁剪。
3. 34 列订单导入、批次范围快照、整批失败、时间戳防重和负数真实入库。
4. 线下完工必须关联合同；订单和线下完工均遵守额度规则，超额数据保留。
5. 地市月成本不关联合同；合同详情中的成本和净利属于“分配地市参考值”。
6. 毛利润 = （订单完工金额 + 已审核线下完工金额）× 对应管理费率；净利润按已确认成本口径计算。
7. 合同到期/满额实时提醒、合同进度、城市汇总、任意组合筛选和当前视图导出。
8. super_admin 全权限；admin、合同管理员及其他账号按角色权限和 all/province/city/contract 数据范围执行。

建议定向安全检查：

- 横向越权：跨省、跨地市、共享合同、失败列表、批次详情、重算与一致性诊断。
- 纵向越权：前端隐藏不可替代后端鉴权；重置密码、合同分配、订单上传必须检查后端角色。
- 导入安全：文件大小、sheet/行/列限制、畸形工作簿、公式与文本处理、原子回滚、临时文件清理。
- 认证安全：登录限流、JWT 失效、密码哈希、敏感日志、默认账号交接和强制改密。
- 导出安全：范围过滤、CSV 注入/转义、下载鉴权、缓存头和审计日志。
- 供应链：锁文件完整性、xlsx 等依赖版本、容器镜像与已知漏洞。
- SQL：所有动态筛选、聚合和数据范围条件的参数化；重点检查合同、订单、完工、成本和聚合诊断查询。

## 6. 可复现测试入口

在项目根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:architecture
pnpm test:migrations:ledger
pnpm test:m2-rbac-auth
pnpm test:m3-contracts
pnpm test:m4-orders
pnpm test:m5-offcost
pnpm test:m6-aggregates
pnpm test:m7-views
pnpm test:m8-security
pnpm test:m9-negative
pnpm test:m10-negative
pnpm test:m11-business
pnpm test:m12-interaction
```

正式 MySQL gate 和 `pnpm release:preflight` 还需要四个环境变量，变量值只能由治理负责人通过安全渠道提供：

```text
MIGRATION_TEST_MYSQL_HOST
MIGRATION_TEST_MYSQL_PORT
MIGRATION_TEST_MYSQL_USER
MIGRATION_TEST_MYSQL_PASSWORD
```

Gate 强制要求非 localhost、非 root 的专用测试账号。不得把变量实值提交到仓库。

本轮本地实际结果：

| 检查 | 结果 |
| --- | --- |
| typecheck | 通过 |
| production build | 通过（仅 chunk 体积警告） |
| unit | 20 个测试文件全部通过 |
| architecture | 0 项违规 |
| migration ledger | 18 项通过，二次执行幂等 |
| M7 视图与权限浏览器测试 | Chromium 通过；门户无侧栏、密码重置输入框断言通过 |
| M12 经营分析交互 | Chromium + WebKit 通过；筛选、清空和 CSV 内容断言通过 |

## 7. 数据库、API 与依赖资料

- ER/表结构审查以 `docs\biz-reporting-mysql-ddl.sql`、`apps\api\migration\` 和 `apps\api\src\**\*.entity.ts` 联合为准。
- API 鉴权使用 Bearer JWT；公开端点应仅限登录和健康检查，具体以控制器装饰器与全局 guard 审计为准。
- 依赖清单以根目录及各 workspace 的 `package.json`、`pnpm-lock.yaml` 为准。
- CI/CD 与发布脚本集中在 `scripts\release\`、`scripts\deployment\`、Dockerfile 和 CloudBase 配置文件中。
- 生产 schema 为 `biz_reporting_prod`，运行账号仅应具有该 schema 的必要 DML 权限；专家测试不得清理或改写保留的旧主库。

## 8. 已知限制与发布前人工条件

1. 本轮代码未部署，线上黑盒测试尚不能覆盖本轮三项 UI 修复。
2. 线上登录凭证尚需安全交接；不提供微信登录。
3. 当前为 CloudBase 测试域名，正式推广前仍需绑定获批自定义域名并复测 CORS、Cookie/令牌、下载和 Safari。
4. 治理负责人必须完成生产回滚演练并留存证据，再导入正式业务数据或扩大用户范围。
5. 生产密钥、数据库口令、JWT 密钥必须保持独立并通过 Secret/环境变量注入，不得出现在评审资料中。
6. 超额订单/线下数据按真实业务保存；超额后的专项展示和后续用途仍属于后续产品决策，不得以丢弃数据代替规则。

## 9. 建议专家团队产出

- 需求覆盖矩阵：需求条目 -> 页面/API/数据表 -> 测试用例 -> 结果。
- 缺陷清单：严重级别、复现步骤、影响范围、证据、建议修复和回归点。
- 权限矩阵审计：角色 × 功能权限 × 数据范围 × 直接 URL/API 访问结果。
- 安全报告：认证、越权、导入、导出、SQL、日志、依赖和部署配置。
- 发布结论：阻断项、非阻断风险、人工条件和可回滚性，不以“页面能打开”代替完整验收。
