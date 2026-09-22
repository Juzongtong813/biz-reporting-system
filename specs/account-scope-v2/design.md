# 账号与数据范围重构设计

## 核心模型

角色决定能做什么，范围授权决定能看哪些对象。运行时认证上下文统一产出：

```ts
{
  userId: string;
  roles: string[];
  permissions: Set<string>;
  scope: {
    allowAll: boolean;
    provinceIds: string[];
    cityIds: string[];
    contractIds: string[];
  };
}
```

现有 `biz_users.role_code` 和 `city_id` 仅作为一次性迁移来源；迁移后服务端运行时读取角色绑定和范围授权表。

## 数据表

- `biz_user_roles(user_id, role_code, is_primary, created_at, updated_at)`：账号与角色多对多。
- `biz_user_scope_grants(id, user_id, scope_type, target_id, effect, created_at, updated_at)`：范围授权。`scope_type` 为 `all/province/city/contract`，`target_id` 对 `all` 为空；本期保留 `effect=allow/deny`，默认只写 allow。
- 现有 `biz_user_permission_overrides` 继续作为账号级功能权限例外。
- 旧 `biz_users.role_code/city_id` 字段保留数据库列但不再作为运行时来源，待迁移稳定后再清理。

## 运行时范围服务

新增 `AccessScopeService`，负责：

- 加载角色和范围授权；
- 合并范围并处理 deny 优先级；
- `canAccessProvince`、`canAccessCity`、`canAccessContract`；
- 为 QueryBuilder 生成省份、地市、合同过滤条件；
- 生成订单导入、快照和审计所需的范围快照。

`RbacService` 只负责认证上下文和功能权限，业务模块不再自行解释 `roleCode/cityId`。

## 迁移

1. 创建角色绑定和范围授权表。
2. 为每个现有用户复制一条角色绑定。
3. `super_admin` 写入 `all`。
4. `admin` 根据现有数据范围写入 `all/province`。
5. `city_user` 将旧 `city_id` 转为一条 `city` 授权；缺失绑定的账号进入迁移错误表并禁止确认。
6. `contract_manager` 不生成地市范围，保留合同域范围策略。
7. 校验旧字段与新授权结果一致后，将旧字段标记为兼容只读来源。

## 账号导入

采用账号主表与范围明细表的逻辑结构。预览阶段解析名称为内部 ID，检查重复账号、范围冲突、未知名称和空范围；确认阶段使用事务批量创建账号、角色和范围授权。

## 安全边界

- 请求中的 province/city/contract 参数只能进一步缩小已授权范围。
- 所有业务模块统一调用范围服务。
- 无范围默认拒绝。
- 角色变更和范围变更递增 `auth_version`，使旧会话失效。
- 导入和范围修改写入操作日志。

## 测试策略

- 单元测试：范围并集、deny 优先、空范围拒绝、参数只能收窄。
- 集成测试：合同、订单、成本、完工、分析和快照各取一条查询链路验证。
- 迁移测试：旧账号映射、新旧范围对照、重复执行幂等性。
- 接口测试：账号导入预览拒绝错误行，确认事务不产生部分写入。
