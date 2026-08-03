# 经营数据中台 V3 P0 工程对齐设计

## 1. 写入边界

`FactImportService` 继续承担文件解析与原子导入，`FactsService` 承担在线新增、修改和冲销。两者在同一数据库事务内维护：

1. `cost_facts` / `order_facts` 当前事实；
2. `fact_versions` 不可变版本证据；
3. `operation_logs` 操作审计；
4. `fact_import_batches` 接入结果和质量摘要。

文件字节仍写入受控存储，数据库仅保存内容寻址键；本规格不改变存储实现。

## 2. 新增迁移

新增 `008_v3_fact_lifecycle.sql`，禁止修改 001-007。

`fact_import_batches` 新增：

- `lifecycle_status`：`processing | current_effective | effective_with_warning | validation_failed`；
- `warning_count`、`blocking_error_count`；
- `effective_at`。

`fact_versions` 新增：

- 地市、合同、年度、月份冗余范围字段，用于稳定的服务端范围查询；
- `lifecycle_status`：`current_effective | effective_with_warning | replaced`；
- `supersedes_version_id`、`superseded_by_version_id`；
- `changed_fields_json`、`warning_summary_json`。

迁移为既有版本回填范围与状态：每个事实最大 `version_no` 为当前有效，其余为已被替代。新增索引支持范围、状态与时间排序。

## 3. 版本写入算法

在线修改采用 compare-and-swap：事务内先读取服务器事实，再使用 `id + city_id + version_no` 作为更新条件。更新影响行数为 0 时读取最新摘要并抛出 `FACT_VERSION_CONFLICT`。成功后：

1. 原版本更新为 `replaced`；
2. 新版本写入 `current_effective`；
3. 前后版本 ID 建立双向关系；
4. `changed_fields_json` 只记录业务字段差异；
5. 同事务写入 operation log。

导入成功为每个新事实生成当前版本。只有警告时版本状态为 `effective_with_warning`；阻塞错误时不写事实和版本。

## 4. API

- `PATCH /api/city/facts/costs/:id`、`PATCH /api/city/facts/orders/:id`：要求 `reason` 与 `expectedVersionNo`。
- `POST /api/city/facts/:kind/:id/reverse`：要求 `reason` 与 `expectedVersionNo`。
- `GET /api/city/facts/versions`、`GET /api/city/facts/versions/:id`：JWT 地市范围。
- `GET /api/admin/facts/versions`、`GET /api/admin/facts/versions/:id`：Admin 权限和可选地市范围。

409 响应体：

```json
{
  "statusCode": 409,
  "code": "FACT_VERSION_CONFLICT",
  "message": "数据已被其他操作更新，请重新载入",
  "current": { "factId": 1, "versionNo": 3, "updatedAt": "...", "updatedBy": 9 }
}
```

## 5. Web 结构

`AdminLayout` 提供浅色 V3 工作区、220px 侧栏、52px 共享上下文栏。目标路由直接挂载到 `/admin/*`、`/city/*`、`/system/*`；旧页面只挂载到 `/compat/*`，不出现在主导航。

共享上下文通过一个类型化 hook 读写 `year/months/cities/metric/status/page/sort`。页面跳转统一携带当前查询参数；地市端忽略 URL 城市值并显示账号绑定地市。

版本页面提供范围筛选、状态、来源、修改原因、版本号、替代关系和详情抽屉。地市数据页复用现有成本/订单事实编辑能力，但提交 `expectedVersionNo` 并处理 409 重新载入。

## 6. 兼容边界

旧 ImportJobs、CityReporting、Packages 和 Ws6Tasks 代码不删除，不再从主导航或正式 V3 路由进入。旧 `/admin/*` 地址重定向到对应 V3 页面；显式 `/compat/*` 仅用于迁移核对。

## 7. 验证

本地阶段运行共享类型/API/Admin Web 类型检查与构建、迁移文件/账本检查、事实生命周期集成测试和设计对齐静态门禁。浏览器在本地 API 与隔离测试数据可用时验证路由、上下文、版本详情和冲突状态。真实 MySQL 与持久存储仍是独立外部门禁。
