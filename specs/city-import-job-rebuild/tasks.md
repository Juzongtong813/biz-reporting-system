# Implementation Plan

## 当前进度

- [x] Web 已部署并通过基础注册/城市列表验证。
- [x] 生产 MySQL `cities` 为 16 个山东地市。
- [x] 地市上传报错已完成生产只读取证。
- [x] `import_jobs.report_year` 与必要索引已完成生产增量 DDL。
- [x] 地市导入作业后端新接口已本地实现并通过 API build，尚未部署。
- [x] 前端统一 API client、上传向导与本地双链真实写入验证已完成。
- [x] CloudRun 086 与 Admin Web 已于 2026-07-25 部署并验证（任务 9，总指挥暂予验收）。
- [ ] 线上真实 city_user 闭环阻塞在门禁 四.4（任务 10）：待①真实账号合法登录会话 ②业务确认真实报表/成本文件。P0 总状态：**未最终验收**。

- [x] 1. 生产只读取证
  - 复现地市 Web 上传报错。
  - 记录 `/api/me` 的 `user.id/name/role/cityId`。
  - 记录上传返回的 `jobId`。
  - 查询生产 MySQL `import_jobs` 中该 `jobId` 的 `operator_user_id/city_id/job_type/status`。
  - 输出 `user.id ↔ jobId ↔ operator_user_id` 证据表。
  - _Requirement: R2, R6_

- [x] 2. 设计数据库增量迁移
  - 检查生产 `import_jobs` 当前列结构。
  - 若缺失 `report_year`，编写只增量 DDL。
  - 补充必要索引，避免破坏历史数据。
  - _Requirement: R1, R3, R6_

- [x] 3. 新建地市导入作业后端接口
  - 实现 `POST /api/city/import-jobs`。
  - 实现 `GET /api/city/import-jobs/:jobId`。
  - 实现 `GET /api/city/import-jobs/:jobId/preview`。
  - 实现 `POST /api/city/import-jobs/:jobId/confirm`。
  - 实现 `POST /api/city/import-jobs/:jobId/cancel`。
  - _Requirement: R1, R2, R3, R4_

- [x] 4. 收敛后端权限校验
  - 提取统一地市导入作业权限校验函数。
  - 明确校验 `role/userId/cityId/jobType`。
  - 403 返回稳定中文业务错误。
  - 旧路径已标记废弃并保留权限拦截；新前端仅调用 `/api/city/import-jobs`。
  - _Requirement: R2_

- [x] 5. 前端统一 API client
  - 在 `request` 层或 `ws6.api.ts` 内建立统一 FormData 上传封装。
  - 删除地市上传链路中孤立的 `fetch + getToken()` 实现。
  - 保证上传、预览、确认使用同一 API base、同一 Authorization 来源、同一错误处理。
  - _Requirement: R1, R5_

- [x] 6. 重建地市上传 UI 组件
  - 用 `CityImportWizard` 替换旧 `CityImportPanel`。
  - 实现 `idle/uploading/previewing/ready_to_confirm/confirming/success/failed` 状态机。
  - 实现作业编号、文件名、预览摘要、差异提示、错误面板。
  - _Requirement: R3, R4, R5_

- [x] 7. 前端上下文清理规则
  - 年份、月份、模式、登录用户变化时清空当前作业。
  - 上传/预览失败时清空 `jobId` 与 preview。
  - 未成功预览时禁用确认写入。
  - 确认失败时清空旧 `jobId` 与 preview，不允许重试失效作业。
  - _Requirement: R5_

- [x] 8. 后端与前端测试
  - 增加或更新后端导入权限测试。
  - 增加前端状态机关键用例。
  - 本地完成报表上传、成本上传、确认写入闭环。
  - 严格双链验证 26/26：报表与成本均 `preview valid → success=true → completed`。
  - 隔离 SQLite 已复验月度行和成本行实际持久化；浏览器验证上传摘要与模式切换清理通过。
  - _Requirement: R1, R2, R3, R4, R5_

- [x] 9. 构建与部署（2026-07-25 完成，总指挥暂予验收）
  - `apps/api` build 通过（exit 0）。
  - `apps/admin-web` build 通过（exit 0，仅 chunk>500kB 非阻塞警告）。
  - CloudRun 部署成功：版本 `biz-reporting-api-086`，DeployId 086，BuildId 2601422145，FlowRatio 100，status normal，部署时间 2026-07-25 09:15:09。
  - Admin Web 43 文件上传既有静态托管，SPA 配置沿用，路由 `/`、`/login`、`/city-reporting`、`/city-cost` 均 200。
  - 部署后验证：`/api/cities` 200 返回 16 城；`/api/city/import-jobs` 已注册且鉴权生效（无 token→401）。
  - 已知风险（只读观察，未处置）：2026-07-25 10:42 空闲后首次请求 `/api/cities` 返回一次 HTTP 500，随后连续 6 次探测均 200——定性为 **“未定位的间歇性可用性事件”**（根因未定位）。“MySQL 连接池陈旧连接（TypeORM 无 keepalive/重连配置）”**仅为待验证假设，不得作为确定根因**，待 P1 处理，本轮不改生产。
  - 解除门禁后新增门禁：真实双链前必须先重新确认 CloudRun 086 与 `/api/cities` 当前健康；真实写入中任何首次请求再次出现 500，立即停止真实写入并报告，不得继续 confirm。
  - _Requirement: R6_

- [ ] 10. 线上验收与记忆固化 —— **阻塞在门禁 四.4，不得勾选**
  - 阻塞原因：①无真实 city_user 合法登录会话（唯一可密码登录的 id=18 鞠宗同明文密码未提供，且不授权重置/注册/伪造/借用 admin）②无业务方确认可写生产的真实报表/成本文件。
  - 解除条件（须同时满足）：A. 真实 city_user 由本人在浏览器登录建立合法会话，Workbuddy 仅接管已认证会话；B. 业务方提供真实报表+成本文件并明确说明地市、年份、覆盖范围、允许写入生产。
  - 线上地市账号上传报表成功。
  - 线上地市账号上传成本成功。
  - 线上确认 `import_jobs.operator_user_id = /api/me.id`。
  - 更新 `.workbuddy/memory/2026-07-24.md` 与 `.workbuddy/overview.md`。
  - job 43 永久保持不动。
  - _Requirement: R6_
