# 经营数据中台工程概览

更新时间：2026-07-29  
状态：`RBAC_AND_FEATURES_IMPLEMENTED_NOT_DEPLOYABLE`

## 当前实现

- Admin API 已包含 Dashboard、Packages、Contracts、Facts、Imports、Users、权限和操作日志端点。
- 认证只允许受控账号登录；公开地市注册和公开微信注册端点已关闭。
- 固定角色为 `root_admin`、`contract_manager`、`system_admin`、`city_user`，权限由服务端 Guard 与数据范围共同校验。
- Dashboard、业务汇总、Admin Facts 与 CityEstimate 共用事实聚合口径。
- 成本和订单来自事实表；完工、审定、开票暂由统一聚合服务只读兼容月度进度表。
- 旧成本预算和综合代维数据仅作只读兼容，不得与实际成本混用。

## 权威资料

- 产品与阶段总纲：`docs/经营数据中台总纲.md`
- RBAC、导出和设置：`specs/rbac-auth-export-settings/`
- 经营数据平台：`specs/operating-data-platform/`
- 架构优化：`specs/larkmidtable-architecture-optimization/`
- 最新验证结论：`specs/rbac-auth-export-settings/validation-report.md`

## 未关闭门禁

- 002–007、规格和实现文件尚未形成完整 Git 发布基线。
- 缺少显式隔离 MySQL 凭据，真实迁移验收未执行。
- 缺少可用真实浏览器会话，四角色和逐页 XLSX 下载对照未执行。
- 缺少非生产持久卷/COS，重启、重建和联合备份恢复未执行。

本文件只提供当前入口，不替代任务清单和验收报告，也不表示可部署。
