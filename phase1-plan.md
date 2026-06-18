# Phase 1 后端补齐实施计划（修正版）

## 概述

在 Admin Web 骨架阶段完成后，补齐 3 个后端模块，为 Admin Web Mock → 真实接口联调做准备。

推进顺序：Dashboard → Admin Packages → Users 缺口。

---

## 1. Dashboard 模块

### 1.1 指标口径（以 cities 为基线）

```
指标 1 — 地市总数:          COUNT(cities)
指标 2 — 合同总数:          COUNT(contracts) WHERE is_deleted = 0
指标 3 — 本月已提交地市数:   COUNT(DISTINCT city_id)
                           FROM month_snapshots
                           WHERE report_year = YEAR(NOW())
                             AND belong_month = MONTH(NOW())
指标 4 — 逾期未提交地市数:   指标1 - 指标3
```

**关键约束**：
- 分母是 `cities` 总数，不做 `annual_report_packages` 存在性过滤
- 某城市即使当年尚未初始化 package，也计入 `overdueNotSubmitted`
- 指标口径定义为「联调过渡版」，DashboardStats DTO 文件头标注 ⚠️

### 1.2 shared-types 新增 DTO

**新建文件** `packages/shared-types/src/common/dashboard.dto.ts`：

```typescript
/**
 * 联调过渡版 DashboardStats
 * ⚠️ 指标口径待后续冻结管理端指标方案确定后替换
 *
 * 口径（过渡版）:
 * - totalCities:        COUNT(cities)，全部地市
 * - totalContracts:     COUNT(contracts) WHERE is_deleted = 0
 * - reportedThisMonth:  month_snapshots 中当前月有快照的 city_id 去重数
 * - overdueNotSubmitted: totalCities - reportedThisMonth
 */
export interface DashboardStats {
  totalCities: number;
  totalContracts: number;
  reportedThisMonth: number;
  overdueNotSubmitted: number;
}
```

**修改文件** `packages/shared-types/src/index.ts`：新增导出 `DashboardStats`。

### 1.3 后端实现

**新建** `apps/api/src/dashboard/dashboard.module.ts`：
- 注入 `TypeOrmModule.forFeature([CityEntity, ContractEntity, MonthSnapshotEntity])`
- 注册 `DashboardController` + `DashboardService`

**新建** `apps/api/src/dashboard/dashboard.service.ts`：

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CityEntity } from '../cities/city.entity';
import { ContractEntity } from '../contracts/contract.entity';
import { MonthSnapshotEntity } from '../packages/month-snapshot.entity';
import { SoftDeleteFlag } from '@biz-reporting/shared-types';
import type { DashboardStats } from '@biz-reporting/shared-types';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepo: Repository<ContractEntity>,
    @InjectRepository(MonthSnapshotEntity)
    private readonly snapshotRepo: Repository<MonthSnapshotEntity>,
  ) {}

  async getStats(): Promise<DashboardStats> {
    const totalCities = await this.cityRepo.count();

    const totalContracts = await this.contractRepo.count({
      where: { isDeleted: SoftDeleteFlag.NOT_DELETED },
    });

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const raw = await this.snapshotRepo
      .createQueryBuilder('s')
      .select('COUNT(DISTINCT s.cityId)', 'count')
      .where('s.reportYear = :year AND s.belongMonth = :month', { year, month })
      .getRawOne<{ count: string }>();

    const reportedThisMonth = raw ? Number(raw.count) : 0;

    return {
      totalCities,
      totalContracts,
      reportedThisMonth,
      overdueNotSubmitted: totalCities - reportedThisMonth,
    };
  }
}
```

**新建** `apps/api/src/dashboard/dashboard.controller.ts`：

```typescript
@ApiTags('Admin - Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({ summary: '获取仪表盘统计数据' })
  async getStats(): Promise<DashboardStats> {
    return this.dashboardService.getStats();
  }
}
```

**修改** `apps/api/src/app.module.ts`：注册 `DashboardModule`。

### 1.4 前端同步

**修改** `apps/admin-web/src/api/dashboard.api.ts`：
- 删除本地 `DashboardStats` 定义
- 改为 `import { DashboardStats } from '@biz-reporting/shared-types'`

**修改** `apps/admin-web/src/mocks/data.ts`：
- `DashboardStats` import 来源同步改为 `@biz-reporting/shared-types`

### 1.5 影响文件清单

```
新建: packages/shared-types/src/common/dashboard.dto.ts
修改: packages/shared-types/src/index.ts
新建: apps/api/src/dashboard/dashboard.module.ts
新建: apps/api/src/dashboard/dashboard.service.ts
新建: apps/api/src/dashboard/dashboard.controller.ts
修改: apps/api/src/app.module.ts
修改: apps/admin-web/src/api/dashboard.api.ts
修改: apps/admin-web/src/mocks/data.ts
```

---

## 2. Admin Packages 模块

### 2.1 月度上下文设计

`return-to-draft`、`unlock-months`、`open-current-month-contract` 是**月份级操作**。

**列表层** (`GET /api/admin/packages`) 提供年度概览 + 当月状态：

```typescript
/** Service 层内部类型（不进入 shared-types） */
export interface AdminPackageItem extends AnnualReportPackage {
  cityName: string;
  currentMonthSubmitted: boolean;  // 当月是否有快照
  submittedMonthCount: number;      // 本年累计已提交月数
}
```

| 字段 | 作用 |
|------|------|
| `cityName` | 城市名称，便于管理员识别 |
| `currentMonthSubmitted` | 当月填报状态，标识列 |
| `submittedMonthCount` | 累计进度，辅助判断整体填报情况 |

**操作层**：所有管理操作均需传入 `monthNo`（或 `months[]`），管理员在后续详情页中选择具体月份后触发。本期不实现月份切换 UI。

| 操作 | monthNo 来源 | 说明 |
|------|-------------|------|
| `return-to-draft` | DTO 显式传入 | 管理员选择要退回的月份 |
| `unlock-months` | DTO 传入数组 | 管理员勾选多个月份 |
| `open-current-month-contract` | DTO `monthNo` 参数 | 管理员指定月份+合同 |

**默认操作月份**：预设为当前月份（`new Date().getMonth() + 1`），但本次后端接口设计为通过参数传递，不做自动推断。

### 2.2 新增接口

| Method | 路径 | DTO | 返回值 |
|--------|------|-----|--------|
| `GET` | `/api/admin/packages` | — | `PaginatedResponse<AdminPackageItem>` |
| `POST` | `/api/admin/packages/:id/return-to-draft` | `ReturnToDraftRequest` | `{ success, message }` |
| `POST` | `/api/admin/packages/:id/unlock-months` | `UnlockMonthsRequest` | `{ success, message, unlockedMonths }` |
| `POST` | `/api/admin/packages/:id/open-current-month-contract` | `OpenCurrentMonthContractRequest` | `{ success, message }` |

### 2.3 Service 新增方法签名

```typescript
// ① 列表（带月度上下文）
async listAllPackages(): Promise<AdminPackageItem[]>

// ② 退回草稿
async returnToDraft(packageId: number, dto: ReturnToDraftRequest): Promise<{ success: boolean; message: string }>
  // 校验: pkg.status === SUBMITTED
  // 更新: pkg.status = DRAFT
  // 记录操作日志

// ③ 解锁历史月份
async unlockMonths(packageId: number, dto: UnlockMonthsRequest): Promise<{ success: boolean; message: string; unlockedMonths: number[] }>
  // 批量创建 month_unlock_grants
  // 每条记录: { packageId, monthNo, expiresAt, grantedBy, reason }

// ④ 开放当月合同填报权限（详见 2.4）
async openCurrentMonthContract(packageId: number, dto: OpenCurrentMonthContractRequest): Promise<{ success: boolean; message: string }>
```

### 2.4 `openCurrentMonthContract` 完整规则

#### 规则 1：合同必须属于该地市分配

```
查 package.cityId → 查 contract_city_allocations
  WHERE contract_id = :contractId AND city_id = :cityId
→ 不存在 → HTTP 400:
  "合同 #${contractId} 未分配给城市 #${cityId}，无法开放填报权限"
```

#### 规则 2：幂等性

| 该月行状态 | 行为 | 返回 |
|-----------|------|------|
| 行不存在 | 补录，`isLocked=0`，金额=0 | `{ success: true, message: '...' }` |
| `isLocked=0` + 金额=0 | 不做变更 | `{ success: true, message: '该合同当月已处于开放状态，无需重复操作' }` |
| `isLocked=0` + 有数据 | 不做变更 | `{ success: true, message: '该合同当月已开放且存在填报数据' }` |
| `isLocked=1` | 解锁 | `{ success: true, message: '...' }` |

#### 规则 3：月份不做限制

管理员调用此接口 = 授权行为。允许为**任意月份**开放合同填报权限，包括历史月份和未来月份。不做 `monthNo` 范围校验。

### 2.5 契约同步

**修改** `packages/shared-constants/src/index.ts`：`API_PATHS` 补 `ADMIN_PACKAGES`：

```typescript
ADMIN_PACKAGES: `${API_PREFIX}/admin/packages` as const,
```

`return-to-draft` / `unlock-months` / `open-current-month-contract` 的路径常量已在 `API_PATHS` 中冻结，无需新增。

### 2.6 实现文件

```
修改: packages/shared-constants/src/index.ts                          [补 ADMIN_PACKAGES 路径]
新建: apps/api/src/packages/admin-packages.controller.ts              [@Controller('admin/packages')]
修改: apps/api/src/packages/packages.service.ts                       [+4 方法]
修改: apps/api/src/packages/packages.module.ts                        [注册 AdminPackagesController]
修改: apps/admin-web/src/api/packages.api.ts                          [去掉占位标注]
```

---

## 3. Users 缺口补齐

### 3.1 `UserListItem` DTO 补 `role`

**修改文件** `packages/shared-types/src/user/user.dto.ts`：

```typescript
export interface UserListItem {
  id: number;
  role: import('../enums').Role;      // ← 新增
  name: string;
  cityId: number | null;
  cityName: string | null;
  status: import('../enums').UserStatus;
  registerAt: string;
  lastLoginAt: string | null;
}
```

**与 Admin Web Users 页字段对照**：

| Users 页面列 | UserListItem 字段 | 状态 |
|-------------|------------------|:---:|
| 姓名 | `name` | ✅ |
| 角色 | `role` | ✅ 本次补 |
| 关联城市 | `cityName` / `cityId` | ✅ |
| 状态 | `status` (enabled/disabled) | ✅ |
| 注册时间 | `registerAt` | ✅ |
| 最后登录 | `lastLoginAt` | ✅ |

### 3.2 `UsersService` 新增方法

```typescript
// ① 分页用户列表
async list(params: PaginationParams): Promise<UserListResponse> {
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;

  const qb = this.userRepository
    .createQueryBuilder('u')
    .leftJoin(CityEntity, 'c', 'c.id = u.city_id')
    .select([
      'u.id',              'u.role',
      'u.name',            'u.city_id',
      'u.status',          'u.register_at',
      'u.last_login_at',
      'c.name AS city_name',
    ])
    .orderBy('u.id', 'ASC');

  const [raw, total] = await Promise.all([
    qb.offset((page - 1) * pageSize).limit(pageSize).getRawMany(),
    qb.getCount(),
  ]);

  return {
    items: raw.map((r) => ({
      id:       Number(r.u_id),
      role:     r.u_role,
      name:     r.u_name,
      cityId:   r.u_city_id ?? null,
      cityName: r.city_name ?? null,
      status:   r.u_status,
      registerAt:  r.u_register_at,
      lastLoginAt: r.u_last_login_at ?? null,
    })),
    total,
    page,
    pageSize,
  };
}

// ② 更新用户状态
async updateStatus(userId: number, status: UserStatus): Promise<UserListItem> {
  await this.userRepository.update(userId, { status });
  const user = await this.findById(userId);
  if (!user) throw new NotFoundException(`用户 #${userId} 不存在`);
  return {
    id:     user.id,
    role:   user.role,
    name:   user.name,
    cityId: user.cityId,
    cityName: user.cityName,
    status: user.status,
    registerAt:  user.registerAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}
```

### 3.3 新增 `AdminUsersController`

```typescript
@ApiTags('Admin - 用户管理')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async list(@Query() params: PaginationParams): Promise<UserListResponse> {
    return this.usersService.list(params);
  }

  @Patch(':userId/status')
  async updateStatus(
    @Param('userId') userId: number,
    @Body() dto: UpdateUserStatusRequest,
  ): Promise<UserListItem> {
    return this.usersService.updateStatus(userId, dto.status);
  }
}
```

### 3.4 实现文件

```
修改: packages/shared-types/src/user/user.dto.ts      [补 role 字段]
修改: apps/api/src/users/users.service.ts              [+list, +updateStatus]
新建: apps/api/src/users/admin-users.controller.ts
修改: apps/api/src/users/users.module.ts               [注册 AdminUsersController]
```

---

## 4. 完整文件清单（Phase 1）

```
Phase 1 合计: 8 新建 + 11 修改 = 19 个文件

--- Dashboard 模块 (3 新建 + 5 修改) ---
New:  packages/shared-types/src/common/dashboard.dto.ts
Mod:  packages/shared-types/src/index.ts
New:  apps/api/src/dashboard/dashboard.module.ts
New:  apps/api/src/dashboard/dashboard.service.ts
New:  apps/api/src/dashboard/dashboard.controller.ts
Mod:  apps/api/src/app.module.ts
Mod:  apps/admin-web/src/api/dashboard.api.ts
Mod:  apps/admin-web/src/mocks/data.ts

--- Admin Packages 模块 (1 新建 + 4 修改) ---
Mod:  packages/shared-constants/src/index.ts
New:  apps/api/src/packages/admin-packages.controller.ts
Mod:  apps/api/src/packages/packages.service.ts
Mod:  apps/api/src/packages/packages.module.ts
Mod:  apps/admin-web/src/api/packages.api.ts

--- Users 缺口 (1 新建 + 3 修改) ---
Mod:  packages/shared-types/src/user/user.dto.ts
Mod:  apps/api/src/users/users.service.ts
New:  apps/api/src/users/admin-users.controller.ts
Mod:  apps/api/src/users/users.module.ts
```

---

## 5. 推进顺序

```
Phase 1A: Dashboard 模块     → nest build 零错误
Phase 1B: Admin Packages 模块 → nest build 零错误
Phase 1C: Users 缺口补齐      → nest build 零错误
Phase 2:  Admin Web 联调     → 关闭 MSW，逐页验证
```
