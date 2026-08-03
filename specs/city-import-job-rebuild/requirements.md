# 地市报表上传重建需求

> 状态：当前 P0 执行规格。该需求已纳入经营数据中台路线，属于“统一数据接入作业层”的第一块落地样板。验收边界仍以本文件为准，不因中台总纲而扩大到小程序、BI 或外部系统接入。

## 背景

当前地市 Web 端「报表填报 / 成本填报」上传报表时出现 `No permission to access another user import job`。这说明上传、预览、确认三个环节中的导入任务身份链路不稳定：前端持有的 `jobId`、后端 `import_jobs.operator_user_id`、当前登录用户 `user.id` 之间可能发生错位。

本需求目标不是继续小修补现有上传按钮，而是将地市上传重建为可追踪、可恢复、权限清晰的「导入作业系统」。

## 范围

包含：

- 地市 Web 端报表上传。
- 地市 Web 端成本上传。
- 上传后的预览、差异提示、确认写入、失败处理。
- 后端导入作业创建、权限校验、状态流转。
- `import_jobs` 必要字段补齐与只增量迁移。

不包含：

- Phase 3 Mini Program。
- 管理端合同批量导入重构，除非复用公共 service 时必须顺手兼容。
- 历史导入任务批量清理。
- 放宽跨用户访问权限。

## 用户故事

1. 作为地市用户，我希望上传报表文件后能先看到解析预览，再决定是否写入，避免错误数据直接入库。
2. 作为地市用户，我希望系统只允许我访问自己创建、自己地市、自己年份的导入任务，避免误操作别人的任务。
3. 作为地市用户，我希望上传失败、预览失败、确认失败时看到中文、可理解的错误提示，并且页面不会残留旧任务。
4. 作为管理员/运维人员，我希望每一次上传都有明确 `jobId`、操作人、地市、年份、状态，便于追查问题。
5. 作为项目维护者，我希望上传、预览、确认统一使用同一套 API client 和后端权限逻辑，减少隐性身份错位。

## 验收标准

### R1 上传作业创建

- When 地市用户选择合法 Excel/CSV 文件上传时，系统 shall 创建一条新的导入作业，并绑定当前 `userId`、`cityId`、`reportYear`、`jobType`。
- When 上传接口返回成功时，系统 shall 返回 `jobId`、`status`、`filename`、`cityId`、`reportYear`、`operatorUserId`。
- When 文件缺失、类型不支持或大小超限时，系统 shall 不创建有效导入作业，并返回中文错误提示。

### R2 权限与归属

- When 地市用户访问导入作业时，系统 shall 校验 `operator_user_id = 当前 user.id`。
- When 地市用户访问导入作业时，系统 shall 校验 `city_id = 当前 user.cityId`。
- When 地市用户访问他人导入作业时，系统 shall 返回 403，并给前端稳定中文提示。
- When 管理员访问导入作业时，系统 shall 走明确的管理员规则，不得隐式绕过地市端规则。

### R3 预览

- When 上传成功后，前端 shall 立即使用同一个 `jobId` 请求预览。
- When 预览请求发出时，系统 shall 使用作业自身绑定的 `cityId` 和 `reportYear` 作为解析上下文。
- When 预览成功时，系统 shall 将作业状态更新为 `previewed`，并保存 `parsed_summary_json`、`diff_summary_json`、`error_summary_json`。
- When 预览失败时，前端 shall 清空当前 `jobId` 与 preview 状态，避免后续误确认旧任务。

### R4 确认写入

- When 预览无阻塞错误且用户点击确认写入时，系统 shall 只确认当前预览成功的 `jobId`。
- When 预览存在覆盖差异且用户未确认覆盖时，系统 shall 阻止写入并提示用户确认覆盖。
- When 确认写入成功时，系统 shall 将作业状态更新为 `completed`，记录 `confirmed_at`，并刷新当前页面月份数据。
- When 确认写入失败时，系统 shall 将作业状态更新为 `failed` 并保留错误摘要。

### R5 前端状态机

- When 用户切换年份、月份、页面模式（报表/成本）或登录用户变化时，前端 shall 清空当前上传作业状态。
- While 当前作业未完成预览，确认写入按钮 shall 保持禁用。
- While 当前作业发生上传/预览/确认错误，页面 shall 不允许继续使用旧 `jobId`。

### R6 可观测与交付

- When 任一导入作业创建、预览、确认或失败时，系统 shall 保留足够排查信息。
- When 修复完成后，Workbuddy shall 提供 `user.id ↔ jobId ↔ operator_user_id` 的证据表。
- When Web 重新部署后，系统 shall 完成线上地市账号上传闭环验证。



