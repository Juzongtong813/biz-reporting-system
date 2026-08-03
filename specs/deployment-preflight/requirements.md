# 部署前冻结与故障准备需求

## 范围

本规格只处理部署前工程冻结、运行配置、健康探针、烟雾测试、故障注入、回滚与证据，不重新设计 V3 业务，不授权连接或修改 `zy-data`、现有公网 `biz-reporting-api`、默认/共享/生产数据库及生产存储。

## 需求

### DP-R1 发布候选可复现

- When 生成发布候选时，发布工具 shall 输出完整文件集合、digest、Git 跟踪状态与未提交状态，并在任一必需文件未进入目标提交时阻断。
- Before 暂存或提交，交付流程 shall 提供精确 pathspec 和排除清单，禁止 `git add .`、`git add -A`。

### DP-R2 生产配置失败即停

- When `NODE_ENV=production`, API shall 在连接数据库前验证 `DEPLOY_ENV`、MySQL 类型、非本机/非 root 数据库凭据、`DB_SYNC=false`、显式 HTTPS CORS 来源、JWT 密钥和持久存储配置。
- When 任一生产配置缺失、为空、为通配符或回退到开发默认值时，API shall 拒绝启动并输出不包含凭据的稳定错误码。

### DP-R3 健康与优雅停机

- While 进程事件循环可用, when 调用存活探针时，API shall 返回不依赖数据库和存储的结构化 `live` 状态。
- When 调用就绪探针时，API shall 实际查询数据库并检查事实源文件存储可读写；任一依赖不可用时 shall 返回 503 和不泄露凭据的依赖状态。
- When 收到 SIGTERM/SIGINT 时，API shall 启用 Nest shutdown hooks，停止接收新请求并关闭数据库连接。

### DP-R4 故障前置验证

- Before 进入隔离部署，自动化 shall 覆盖生产配置缺失、错误 CORS、数据库不可用、存储挂载缺失、存活/就绪探针、迁移幂等、失败账本和优雅关闭。
- When 故障注入完成时，测试资源 shall 自动清理，且不得连接任何受保护目标。

### DP-R5 回滚与事故处置

- Before 切流，交付物 shall 提供部署前/后检查、停止条件、日志与证据采集、数据库和文件联合恢复、应用回切、数据兼容判断和责任人记录模板。
- When 新版本发生数据库、存储、认证、导入或性能阻断故障时，运行手册 shall 给出先止写、再保全证据、再回切/恢复的确定顺序，禁止修改历史迁移或反向覆盖数据。

### DP-R6 门禁真实性

- While 外部隔离 MySQL、COS 持久存储或登录后浏览器证据缺失, the deployment gate shall remain `BLOCKED`。
- When 本机预验收通过时，证据 shall 标记 `qualification=non_gate`，不得自动生成外部门禁 PASS 文件。

## 非目标

- 不执行 Git 暂存、提交、推送。
- 不创建或修改生产/共享资源。
- 不执行公网部署或流量切换。
- 不以本地 SQLite、本机 MySQL、静态断言或临时目录替代外部隔离证据。
- 不要求 CFS；当前部署适配优先使用独立 COS 存储桶/前缀挂载到 `/mnt/fact-source-files`。
