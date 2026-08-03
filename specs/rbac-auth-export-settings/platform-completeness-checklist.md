# 发布前平台完整性检查

结论状态：`RBAC_AND_FEATURES_IMPLEMENTED_NOT_DEPLOYABLE`

## 本地完整性

- I-1：空库迁移 002 必须为 `executed`，账本 8 行且二次执行不变。
- I-2：002–007、checksum、规格与实现文件全部列入发布清单；未跟踪文件会阻断发布 gate。
- I-3：Dashboard、业务汇总、Admin Facts、CityEstimate 共用事实聚合；旧进度/预算只有声明过的只读兼容用途和退出计划。
- I-4：Admin Facts 支持全省、单地市和多地市查询、筛选与同源导出。
- I-5：当前入口和使用手册不得继续指导公开注册、草稿提交、锁定或解锁旧流程。
- I-6：总纲、经营平台任务、架构任务、RBAC 任务和验收报告必须分别记录已完成、部分完成和外部门禁。

## 外部门禁

以下证据必须来自明确隔离环境，并分别保存；缺一项即保持 BLOCKED：

- `REAL_MYSQL`：8 行迁移账本、007 结构、第二根拒绝、幂等、失败账本和 schema 清理。
- `BROWSER`：四角色、临时密码/普通改密、旧 JWT、跨地市和逐页 XLSX 下载对照。
- `PERSISTENT_STORAGE`：非生产挂载或 COS 的上传、重启、实例重建、联合备份恢复和 SHA-256 对照。
- `DATABASE_BLUE_GREEN`：隔离 V3 schema、旧库只读抽取、79 条月度孤儿和 2 条审计孤儿治理、新旧结果对账及回切演练。

数据库执行权威入口：`specs/database-architecture-v3/tasks.md`。未完成 DB-0.2 至 DB-8.3 时不得切换生产。

机器入口：`pnpm release:completeness`。该命令只做本地检查和证据存在性判定，不连接数据库、不启动浏览器、不操作存储；外部证据缺失时应退出 2。
