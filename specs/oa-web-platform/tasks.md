# Implementation Plan

> 状态：历史任务清单。本文保留为 OA 化阶段快照，后续执行顺序以 `specs/operating-data-platform/tasks.md` 与 `.workbuddy/overview.md` 为准。

## Phase 0: Baseline and safety

- [ ] 1. 建立当前工作区基线
  - 记录现有未提交改动、当前构建入口、正式 EnvId、CloudRun 服务和静态站点路径。
  - 不回滚、不覆盖 `master` 工作区历史改动。
  - _Requirement: R8_

- [ ] 2. 修复快照字段和迁移链路
  - 统一 `actual_submitted_at`，生成增量迁移并在测试数据库验证。
  - _Requirement: R8_

## Phase 1: Security and roles

- [ ] 3. 实现统一认证上下文和后端守卫
  - 增加角色守卫、资源所属城市解析和 city scope 服务。
  - 覆盖导入、导出、文件下载、报表包、合同和测算接口。
  - _Requirement: R1, R2_

- [ ] 4. 完成历史角色迁移
  - 提供管理员迁移接口和页面。
  - 迁移前校验目标角色、城市绑定和账号状态。
  - 写入迁移审计日志，不删除账号。
  - _Requirement: R1, R4_

- [ ] 5. 移除物理删除路径
  - 删除或封禁合同物理 purge 接口。
  - 为城市、用户和业务数据补充软删除/恢复规则。
  - _Requirement: R4_

## Phase 2: Shared domain service

- [ ] 6. 抽取统一报表计算服务
  - 迁移提交预览、快照、Packages、Dashboard 和 Export 的公式调用。
  - 保持小程序现有接口响应兼容。
  - _Requirement: R3, R6, R8_

- [ ] 7. 增加草稿/提交状态模型
  - 返回 `empty`、`draft`、`submitted`、`mixed`。
  - 增加最新有数据月份和提交月份数量。
  - _Requirement: R6_

- [ ] 8. 实现综合代维口径
  - 只匹配合同名称完整包含“综合代维”的合同。
  - 为有合同、无合同和多合同城市补充测试。
  - _Requirement: R6_

## Phase 3: Import, export, audit

- [ ] 9. 改造临时文件和导入幂等
  - 增加文件哈希、预览版本、确认令牌和事务级 upsert。
  - 覆盖错误、重复、缺失和二次确认流程。
  - _Requirement: R5_

- [ ] 10. 实现受保护下载和导出范围
  - 管理员支持当前城市、全部城市、年度汇总和明细。
  - 地市用户只能导出所属城市。
  - 下载时重新校验任务所属用户和城市。
  - _Requirement: R2, R5_

- [ ] 11. 统一审计日志
  - 覆盖增删改、导入、导出、提交、解锁、角色迁移和失败结果。
  - _Requirement: R4, R5, R8_

## Phase 4: City Web workspace

- [ ] 12. 增加地市 Web 路由和角色布局
  - 登录后按角色显示菜单和路由。
  - city_user 不加载管理员页面和管理员 API。
  - _Requirement: R1, R2, R3_

- [ ] 13. 实现年度报表包和月度填报
  - 合同、成本、综合代维、开票、订单输入。
  - 草稿保存、提交预览、确认提交和锁定状态。
  - _Requirement: R3_

- [ ] 14. 实现地市上传和本地导出
  - 文件上传、预览、错误提示和本地导出。
  - _Requirement: R3, R5_

## Phase 5: Admin OA workspace

- [ ] 15. 完成地市、用户和合同管理
  - CRUD、启停用、角色迁移、合同分配、软删除和恢复。
  - _Requirement: R4_

- [ ] 16. 完成报表包、导入、订单和导出中心
  - 支持预览、确认、错误提示、状态追踪和批量操作。
  - _Requirement: R4, R5_

- [ ] 17. 完成经营总览和地市测算
  - 展示提交数据、草稿数据、数据状态、月份计数和最新月份。
  - _Requirement: R6_

## Phase 6: Controlled AI

- [ ] 18. 增加管理员只读 AI 工具接口
  - 后端强制 `system_admin`。
  - 只允许白名单工具，不暴露 SQL 和写接口。
  - _Requirement: R7_

- [ ] 19. 增加 AI 使用审计和配额
  - 记录查询范围、工具、耗时、结果状态和失败原因。
  - _Requirement: R7, R8_

## Phase 7: Verification and release gate

- [ ] 20. 补齐测试矩阵
  - 单元、API、权限、导入幂等、公式、数据一致性和导出测试。
  - _Requirement: R1-R8_

- [ ] 21. 完成 Web 浏览器验证
  - 验证管理员和地市用户登录、路由、填报、上传、提交、总览、测算和导出。
  - _Requirement: R8_

- [ ] 22. 预发布验收与生产确认
  - 运行类型检查、构建、测试和预发布数据核对。
  - 未获得再次明确确认前，不执行生产部署。
  - _Requirement: R8_


