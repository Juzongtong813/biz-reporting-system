# 软件架构优化实施任务

> 状态规则：本清单按新权威需求和设计重建，初始全部未完成。旧 tasks 的勾选、旧交付报告和旧 memory 不构成本清单完成证据。
> 对应设计：`specs/larkmidtable-architecture-optimization/design.md`

## Phase 0：现状与守卫

- [x] 1. 建立仓库职责和历史产物清单
  - 区分 apps、packages、docs、specs、scripts、sql、部署输出、备份、日志和生成物。
  - 为每个待归档目录记录所有者、用途、引用和处置条件。
  - _Requirement: AR-R1, AR-R8_
- [x] 2. 建立统一验证入口
  - 定义 typecheck、unit、integration、architecture 和 build 命令。
  - 当前不存在的命令不得写成已通过；先提供失败清晰、可逐步补齐的入口。
  - _Requirement: AR-R6_
- [x] 3. 建立依赖方向检查
  - 检查 domain 不依赖框架/基础设施、页面不直接读 token 或调用 fetch、共享契约不循环依赖。
  - 将违规输出定位到文件和规则编号。
  - _Requirement: AR-R2, AR-R4, AR-R5, AR-R6_

## Phase 1：后端边界

- [ ] 4. 收敛 AppModule 与 bootstrap
  - 将 seed、migration runner 和启动副作用从根模块移到显式 bootstrap/application 边界。
  - 保持开发环境和生产环境的配置行为可验证、可回滚。
  - _Requirement: AR-R2, AR-R7_
- [ ] 5. 建立 ingestion 模块骨架
  - 创建 application use cases、domain policies、ports、adapters 和接口层目录。
  - 旧导入 controller 通过兼容层调用新用例，不复制写入逻辑。
  - _Requirement: AR-R2, AR-R3_
- [ ] 6. 拆分批次、预览、质量和发布用例
  - 将大 service 中的作业状态、模板解析、质量、发布和导出职责分离。
  - 每次拆分保留旧接口行为和单元测试夹具。
  - _Requirement: AR-R2, AR-R3, AR-R6_
- [ ] 7. 建立配置、存储、日志和数据库端口
  - 业务模块不直接散落 SDK、process.env 或 TypeORM 事务细节。
  - 关键日志统一带 batch/component/city/actor/version 上下文。
  - _Requirement: AR-R2, AR-R7_

## Phase 2：领域和共享契约

- [ ] 8. 提取共享状态、错误和 DTO 契约
  - 定义批次、组件、数据性质、值状态、质量级别、发布版本和血缘契约。
  - API、Web、小程序和测试统一从 shared-types 导入。
  - _Requirement: AR-R4_
- [ ] 9. 提取无 I/O 领域核心
  - 实现单位转换、期间和值状态、合同编码规范化、指标版本和发布状态机。
  - 通过纯函数测试保证 API、查询和导出复用同一入口。
  - _Requirement: AR-R2, AR-R4_
- [x] 10. 清理共享包生成物边界
  - 将 `.js`、`.d.ts`、source map 和构建输出移出 `src`。
  - 补齐 workspace 构建和类型检查的契约不一致失败路径。
  - _Requirement: AR-R4, AR-R6_
  - _Evidence: 2026-07-29 已清理 `packages/shared-types/src` 中 `.js/.d.ts/.map` 生成物；Shared Types、API、Admin Web 按依赖顺序构建通过。_

## Phase 3：前端 feature 化

- [ ] 11. 建立 app、routes、layouts 和集中权限配置
  - 菜单、路由、角色和地市 scope 不在页面内重复判断。
  - 保持现有 HashRouter 和部署路径兼容，迁移另行验证。
  - _Requirement: AR-R1, AR-R5, AR-R7_
- [ ] 12. 将上传向导迁移为 ingestion feature
  - 使用根批次 API、统一 request client、批次状态机和质量问题面板。
  - 切换用户、地市、年度、场景或文件时清理旧上下文。
  - _Requirement: AR-R3, AR-R5_
- [x] 13. 将 dashboard、estimate、export 迁移到数据服务 client
  - 页面不得直接访问原始表语义或复制经营公式。
  - 对新旧接口建立契约适配和回归测试。
  - _Requirement: AR-R4, AR-R5, AR-R6_
  - _Evidence: 2026-07-29 Dashboard 委托 `FactsService`，CityEstimate 使用 Admin Facts progress/orders，页面与导出共享筛选结果；`test:metric-sources` 和生产构建通过。_

## Phase 4：兼容迁移与退役

- [ ] 14. 建立旧路由调用监控和兼容期限
  - `/city/imports`、`/imports` 等旧入口统一记录调用方和结果。
  - 明确停止新增调用、迁移完成、退役和回滚条件。
  - _Requirement: AR-R3, AR-R7, AR-R8_
- [ ] 15. 完成一条端到端迁移切片
  - 选择经营测算包接入，从文件接收到发布查询全链路走新边界。
  - 旧页面通过兼容视图读取，完成新旧结果对账后再切换。
  - _Requirement: AR-R2, AR-R3, AR-R6, AR-R8_
- [ ] 16. 固化目录迁移和归档说明
  - 任何移动列出旧路径、新路径、兼容策略、调用方和删除条件。
  - 不删除用户未授权的历史备份和交付物。
  - _Requirement: AR-R1, AR-R8_

## Phase 5：最终门禁

> 2026-07-29 状态：本地代码门禁可复现，发布 Git 追溯、真实 MySQL、浏览器和持久存储未关闭，任务 17–19 不得勾选。

- [ ] 17. 执行架构、契约、单元、集成和构建门禁
  - 输出需求编号、测试命令、结果、时间、环境和剩余风险。
  - 构建通过不得代替权限、数据质量或真实流程验收。
  - _Requirement: AR-R4, AR-R6, AR-R7_
- [ ] 18. 完成生产变更前评审包
  - 包含影响范围、迁移脚本、备份/只读证据、回滚、监控和独立授权记录。
  - 文档阶段完成不等于生产变更获准。
  - _Requirement: AR-R1, AR-R7, AR-R8_
- [ ] 19. 退役兼容层并更新当前证据索引
  - 只有调用量为零、回归通过、运维可观测和回滚窗口结束后才能退役。
  - 更新权威文档中的当前证据，不重新激活历史文档。
  - _Requirement: AR-R3, AR-R6, AR-R8_
