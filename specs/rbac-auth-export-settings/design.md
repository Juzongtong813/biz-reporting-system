# RBAC、迁移、导出与经营口径设计

## 安全分层

请求依次经过全局 `JwtAuthGuard`、`PermissionsGuard`、`RolesGuard`。显式 `@Permissions` 是新能力边界，旧 `@Roles` 由全局 `RolesGuard` 继续保护；有显式权限元数据时角色 Guard 不重复收窄。`Scope` 服务再以数据库中的角色和 `cityId` 约束资源范围。

`root_admin` 在旧省级 Scope 中与 `system_admin` 等价，以保持旧运营端点兼容；`contract_manager` 不获得省级运营范围。权限 Guard 负责能力，Scope 负责数据范围，前端菜单只负责呈现。

## 迁移设计

- 迁移顺序按文件名固定，共 8 个文件，包含两个不同名称的 `002`。
- `001_initial_tables.sql` 保持 Git 基线，月度行的发票和订单金额由专用 `002` 追加。
- `migration-checksums.json` 是仓库内不可变校验清单；`check-files` 在连接数据库前完成清单、基本格式和 SHA-256 校验。
- SQLite 只验证跨方言迁移机制和自动化业务测试，不代表真实 MySQL 兼容验收。
- MySQL 脚本只接受 `MIGRATION_TEST_MYSQL_*`，创建时间戳隔离 schema，并执行 `precheck -> up -> status -> up -> status`、强制失败路径和最终删除。
- 007 使用 MySQL 生成列 `root_admin_singleton` 加唯一索引保证至多一个根账号；邀请表保存 token SHA-256。

## 认证与账号

密码登录先区分管理员/地市通道，再校验角色、状态和密码。JWT 仅携带身份快照；策略每次重新查询用户并比较 `authVersion`。临时密码状态由数据库返回，Permission Guard 仅允许本人信息、改密和退出。

账号创建、重置密码和微信邀请只一次返回明文；数据库只保存 bcrypt 或 SHA-256。所有安全操作写不含秘密的 `operation_logs`。根账号通过显式 `promote-root` 工具建立，应用启动不自动播种。

## 导出

`page-export-core.ts` 负责文件名、上限和纯数据转换，`page-export.ts` 负责 XLSX 生成和审计。页面将已用于展示的筛选结果交给导出层；成本和订单以相同筛选重新请求 `page=1,pageSize=10000`。CityEstimate 将同一组多地市页面数据映射为四个工作表。

## 经营口径

`packages/shared-types/src/common/metric-source.ts` 冻结 `v3-facts-unified-2026-07-29` 口径。Dashboard 只委托 `FactsService`，CityEstimate 的合同进度和订单分别调用 Admin Facts progress/orders，避免页面复制经营公式：

| 页面/指标 | 数据源 | 生命周期 |
|---|---|---|
| Dashboard/CityEstimate 完工、审定、开票 | `report_contract_monthly_rows` 经 `FactsService` | 只读兼容 |
| Dashboard 订单实际 | `order_facts` | V3 事实口径 |
| Dashboard 实际成本 | `cost_facts` | V3 事实口径 |
| Dashboard 毛利润/实际净利润 | 审定 × 生效费率；毛利润 - 实际成本 | 显式公式 |
| CityEstimate 成本预算、综合代维 | 旧报表包预算行 | 只读兼容 |

旧报表包写流程尚未退役，但 Dashboard、Admin Facts、CityEstimate 和导出不再自行混合快照与草稿。退出按三步执行：停止旧写入口；迁移月度进度、预算、综合代维至独立事实表；切换统一聚合并在真实环境验收后移除运行时依赖。

## 真实环境边界

自动化 SQLite、Node XLSX 解析和路径启动门禁分别只证明代码契约。真实 MySQL、浏览器下载、持久卷/COS 重启与恢复必须各自保留独立证据，互不替代。
