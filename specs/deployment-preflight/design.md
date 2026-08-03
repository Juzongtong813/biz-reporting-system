# 部署前冻结与故障准备设计

## 决策

沿用现有“单一 MySQL + 对象存储 + 模块化单体 + 蓝绿迁移”方案，只增加部署控制面，不改变业务 DTO、路由语义或 001-008 迁移。

源文件正文进入独立 COS 存储桶/前缀，MySQL 只保存 storage key、SHA-256、大小、类型和血缘定位。当前 API 采用文件系统适配，因此 CloudBase Run 将 COS 挂载到 `/mnt/fact-source-files`；CFS 不是必需组件。

## 控制面

1. `runtime.config.ts` 在 ConfigModule 初始化阶段组合认证校验和生产运行配置校验，早于 TypeORM 连接。
2. `/api/health/live` 仅报告进程存活；`/api/health/ready` 通过 TypeORM `SELECT 1` 和存储探针检查依赖。
3. `main.ts` 启用 shutdown hooks；Docker HEALTHCHECK 改为存活探针。平台就绪检查使用 ready 探针。
4. 部署前自动化在隔离 SQLite/临时存储上验证正向就绪，并用关闭数据库、错误生产配置验证失败路径。
5. 发布完整性工具同时检查未跟踪文件与清单内已跟踪文件的工作区/暂存差异，目标提交形成前不得通过。

## 安全边界

- 生产配置不接受 localhost、root、空数据库密码、SQLite、`DB_SYNC` 非 false、CORS `*`、HTTP/localhost 来源。
- 错误响应只返回稳定依赖名和状态，不返回连接串、路径外内容或异常堆栈。
- 健康探针公开，但不返回 schema、账号、host、storage key、版本数据或业务统计。
- 本地演练脚本只创建临时 SQLite/目录，真实 MySQL runner 继续要求四项隔离凭据并拒绝 localhost/root/production。

## 回滚模型

- 应用回滚通过蓝绿流量回切，不执行历史迁移 down。
- 数据故障先止写并保存账本、日志、版本和文件 hash，再按同一恢复点联合恢复数据库与 COS。
- 已发布事实纠正通过新版本/冲销，禁止覆盖历史证据。

## 验证

- API/Shared/Admin 构建和既有专项测试。
- 新增运行配置与健康探针测试。
- MySQL 8 本地非门禁预验收回归。
- 发布清单、敏感目标扫描、无暂存状态和平台完整性报告。
