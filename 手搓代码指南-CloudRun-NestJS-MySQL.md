# 手搓代码指南：NestJS + TypeORM + MySQL 部署到 CloudBase CloudRun

> 适用场景：你想自己从零（或照着现有仓库）手写这套后端，并部署到 CloudBase 云托管（CloudRun）。
> 本文所有代码块均来自你现有仓库 `biz-reporting-system-deploy` 的真实写法，可直接对照/抄写。
> 约定：目标环境 `zy-pro-d1g5fqh7u4cfce3ab`，MySQL 实例 `tnt-6p2ou2b2w`。

---

## 0. 先端正一个认知：你“手搓”到底在搓什么

整套东西 = 一个 NestJS API + TypeORM ORM + MySQL，**打包成 Docker 镜像**，跑在 CloudBase CloudRun 上，容器启动时**先跑数据库迁移再启动服务**。

你真正要“手写”的只有 3 类“胶水代码”，其余 30 个业务模块都是标准 NestJS，跟本地开发没区别：

1. **数据库接入配置**（TypeORM 连接参数从哪里读）
2. **容器启动脚本**（先迁移、后启动、带健康检查）
3. **部署配置**（CloudRun 的环境变量 + 网络打通）

业务模块（auth / contracts / cities …）就是普通的 `@Module` + `@Injectable` + `@Controller`，你本来就会，本文不展开。

---

## 1. 你要写的代码分 6 层（按依赖顺序）

| 层 | 文件 | 作用 | 是否“胶水” |
|----|------|------|-----------|
| 1 工程骨架 | `package.json` / `tsconfig` / `pnpm-workspace.yaml` | monorepo + NestJS 启动 | 否 |
| 2 数据库接入 | `apps/api/src/app.module.ts` 的 `TypeOrmModule` | **最关键**：决定连哪个库、怎么连 | **是** |
| 3 实体 | `**/*.entity.ts` | 表结构映射 | 否 |
| 4 业务模块 | `*/xxx.module.ts` `*/xxx.service.ts` `*/xxx.controller.ts` | 业务逻辑 | 否 |
| 5 迁移层 | `scripts/db/migrate.mjs` + `apps/api/migration/*.ts` | 增量建表/改表，幂等 | **是** |
| 6 容器与部署 | 根 `Dockerfile` + `entrypoint.sh`（烘焙进镜像）+ CloudRun EnvParams/VpcConf | 打包与运行环境 | **是** |

---

## 2. 分步手搓计划

### Step 1 — 工程骨架（NestJS + pnpm monorepo）

你已有，照抄即可。要点：

- 构建命令：`pnpm --filter @biz-reporting/api build` → 实际执行 `nest build`（见 `apps/api/package.json` 的 `"build": "nest build"`）。
- 产物是 `apps/api/dist/main.js`（入口）。
- 用 `pnpm deploy --filter=@biz-reporting/api /app/deploy` 把依赖扁平化打包，避免把 `node_modules` 源码整包塞进镜像。

### Step 2 — 数据库接入层（核心，必须亲手写对）

**这是成败手。** 看 `app.module.ts` 第 63–112 行的真实写法：

```ts
TypeOrmModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService): TypeOrmModuleOptions => {
    const nodeEnv = config.get<string>('NODE_ENV', 'development');
    const isProduction = nodeEnv === 'production';
    const dbType = config.get<string>('DB_TYPE', 'mysql');
    // ...连接池参数...

    if (dbType === 'sqlite') { /* 本地开发用，跳过 */ }

    // ★ 生产/部署走这里：读的是“独立变量”，不是 DATABASE_URL
    return {
      type: 'mysql',
      host:     config.get<string>('DB_HOST', 'localhost'),
      port:     config.get<number>('DB_PORT', 3306),
      username: config.get<string>('DB_USERNAME', 'root'),
      password: config.get<string>('DB_PASSWORD', ''),
      database: config.get<string>('DB_DATABASE', 'biz_reporting'),
      charset: 'utf8mb4',
      entities: [__dirname + '/**/*.entity.ts', __dirname + '/**/*.entity.js'],
      // ★ 生产环境强制 false：表结构只靠迁移脚本建，绝不靠自动同步
      synchronize: isProduction ? false : config.get<string>('DB_SYNC', 'false') === 'true',
      logging: config.get<boolean>('DB_LOGGING', false),
      retryAttempts: 3,
      retryDelay: 3000,
      extra: {
        connectionLimit: dbPoolConnectionLimit,
        waitForConnections: true,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
        connectTimeout: 10000,
        maxIdle: 1,
        queueLimit: dbPoolQueueLimit,
      },
    };
  },
}),
```

**手搓要点（务必记死）：**

- 它读的是 `DB_HOST / DB_PORT / DB_USERNAME / DB_PASSWORD / DB_DATABASE / DB_TYPE`，**不读 `DATABASE_URL`**。所以部署时你给 `DATABASE_URL` 是无效的，必须给这一串 `DB_*`。
- `DB_TYPE` 默认 `'mysql'`。**一旦你误填成 `postgres`**，代码会掉进 `if (dbType === 'sqlite')` 的 `else`（mysql 分支是唯一兜底），被当成 mysql 去连 → 连不上 → 崩溃。（这是之前 CrashLoop 的真正根因之一。）
- 生产环境 `synchronize: false`：意味着**表不是 TypeORM 自动建的，是迁移脚本建的**。你手搓时千万不能把 `synchronize` 开成 `true` 上线，否则结构漂移、且多实例并发会冲突。

### Step 3 — 实体层（`*.entity.ts`）

标准 TypeORM 装饰器写法即可，例如 `cities/city.entity.ts` 用 `@Entity()`、`@PrimaryGeneratedColumn()`、`@Column()` 定义。实体文件必须能被 `entities` 的 glob（`__dirname + '/**/*.entity.ts'` 和 `.js`）匹配到，否则 TypeORM 找不到表。

### Step 4 — 业务模块样板（以 `cities` 为例）

`cities.module.ts` 里用 `TypeOrmModule.forFeature([CityEntity, OperationLogEntity])` 把实体注册进该模块；service 里 `extends Repository<CityEntity>` 或用 `InjectRepository` 注入；controller 写路由。这部分是纯 NestJS，照葫芦画瓢。

⚠️ 注意连锁：`cities.module.ts` 顺带注册了 `OperationLogEntity`（写操作日志用），所以你手搓最小验证时不能只动 City 一个实体。

### Step 5 — 迁移层（容器启动前建表）

真实文件：`scripts/db/migrate.mjs`（Ledger 迁移工具，幂等增量迁移，`up` 命令）。设计契约：

- **幂等**：同一迁移跑多次不会报错（靠已执行记录判断）。
- **防重复启动重跑**：`entrypoint.sh` 用 `/tmp/biz-reporting-api/.migrated` 标记文件，跑过就不再跑。
- **需授权开关**：脚本依赖环境变量 `MIGRATION_APPROVED=true` 才真正执行（在 entrypoint 内 `export`，避免把审批逻辑写进云端被脱敏的 EnvParams）。
- **布局依赖**：`scripts/db/migrate.mjs` 默认相对路径找 `../../apps/api/migration`，所以你的迁移 `.ts` 文件要放在 `apps/api/migration/`。

手搓建议：如果你从零写，可以用 TypeORM 的 `migrations` 机制（`TypeOrmModule` 配 `migrations` + `dataSource.runMigrations()`），也可以自己写一个简单的 `migrate.mjs` 调 `queryRunner`。核心就是“启动即增量建表、可重复执行”。

### Step 6 — 容器层（Dockerfile + entrypoint，**生死线集中区**）

⚠️ **致命陷阱：仓库里有两个 Dockerfile。**

- 根 `Dockerfile` = **权威版**，含 `entrypoint.sh`（先迁移后启动），实际部署用的就是它。
- `apps/api/Dockerfile` = **镜像副本**，但 `CMD ["node", "dist/main.js"]` **没有迁移步骤**，且文件头注释明确写“本副本必须与根 Dockerfile 保持一致”。

**如果你手搓，只写一个 Dockerfile**，把迁移逻辑烤进去。根 `Dockerfile` 烘焙的 `entrypoint.sh` 真实写法：

```sh
#!/bin/sh
set -eu
export MIGRATION_APPROVED=true
MARKER=/tmp/biz-reporting-api/.migrated

if [ ! -f "$MARKER" ]; then
  echo "[entrypoint] ledger migration up (idempotent)"
  node scripts/db/migrate.mjs up
  echo "[entrypoint] migration ok, writing marker $MARKER"
  mkdir -p /tmp/biz-reporting-api
  touch "$MARKER"
fi

echo "[entrypoint] starting API server"
exec node dist/main.js
```

**容器层其他要点：**

- 健康检查：`HEALTHCHECK ... wget -qO- http://localhost:${PORT:-3000}/api/health/live`，所以你代码里**必须有一个 `/api/health/live` 路由**返回 200（就绪/存活探针），否则 CloudRun 认为实例不健康。
- 非 root 运行（UID 10001）—— 安全项，建议保留。
- `EXPOSE 3000` + CloudRun 端口映射：容器内监听 `PORT`（默认 3000），CloudRun 外部端口你部署时指定（通常也 3000）。

### Step 7 — 部署到 CloudRun（EnvParams + VpcConf）

这是和“本地能跑”最大的区别。**CloudBase 不会往容器里注入任何数据库密码/地址**，你必须显式给：

**EnvParams 必须包含（照抄）：**

```
DB_TYPE=mysql
DB_HOST=<控制台拿的内网地址>
DB_PORT=<端口，通常3306>
DB_USERNAME=<通常 root>
DB_PASSWORD=<控制台重置密码拿到的>
DB_DATABASE=biz_reporting        # 若实例里没有此库，迁移脚本里先 CREATE DATABASE
NODE_ENV=production              # 触发 synchronize:false、只加载 .env
PORT=3000
# 其余业务配置沿用你旧部署那套：JWT_*/CORS_ORIGINS/TRUST_PROXY_HOPS/AUTH_*/SUPER_ADMIN_* 等
```

**VpcConf（必配，否则容器在 VPC 外连不到 MySQL）：**

```
vpcId=<MySQL 实例所属 VPC ID>
subnetId=<同 VPC 下的子网 ID>
```

> 这两个值在 TencentDB 实例详情页“所属网络”里拿。CloudRun 容器必须和 MySQL 在同一个 VPC 才能 TCP 直连。

其余部署参数：镜像从源码构建（你已有 Dockerfile）、`OpenAccessTypes: PUBLIC`（要外网访问时）、实例规格 `Cpu0.5/Mem1/Min1/Max3`、InitialDelaySeconds 注意远端可能落为 2（就绪探针宽容度低，必要时调大）。

---

## 3. CloudBase 上的 5 条生死线（踩中即 CrashLoopBackOff）

1. **VpcConf 不配 → 容器连不到 MySQL（TCP 在 VPC 内）**。这是“本地能连、上云连不上”的头号原因。
2. **数据库密码不注入 → 必须显式给 `DB_PASSWORD`**。CloudBase 不会帮你填。
3. **`DB_TYPE` 写错（如 `postgres`）→ 掉进 else 被当成 mysql 连 localhost → 崩**。必须 `mysql`。
4. **双 Dockerfile 不同步 → 用错那个就没有迁移步骤**，首启无表 → 服务报错。
5. **MCP 关系型 DB 工具的 env 绑定 bug**：本会话 `queryMysqlDatabase`/`queryPgDatabase` 被钉死在旧环境、`set_env` 修不了、也不接受 envId → **连接串/密码只能从控制台拿，别指望工具自动取**。

---

## 4. 最小可运行骨架（可直接抄）

把下面三块拼起来，就是一个“能连 MySQL + 能迁移 + 能健康检查”的最小后端骨架：

**(a) `app.module.ts` 的 TypeORM 段** —— 见 Step 2 代码块（读 `DB_*`、生产 `synchronize:false`）。

**(b) `entrypoint.sh`** —— 见 Step 6 代码块（先迁移、后启动、marker 防重）。

**(c) 健康检查 Controller（必须有 `/api/health/live`）：**

```ts
@Controller('api/health')
export class HealthController {
  @Get('live')
  live() { return { status: 'ok', ts: Date.now() }; }
}
```

---

## 5. 手搓检查清单（上线前逐项打勾）

- [ ] `DB_TYPE=mysql`，且**没**依赖 `DATABASE_URL`
- [ ] `NODE_ENV=production` → `synchronize=false`，表靠迁移建
- [ ] 只有一个 Dockerfile，且含“先迁移后启动”的 entrypoint
- [ ] 镜像里有 `/api/health/live` 且返回 200
- [ ] `MIGRATION_APPROVED=true` 在 entrypoint 内导出
- [ ] CloudRun EnvParams 给了全部 `DB_*`
- [ ] **VpcConf 配了**（vpcId + subnetId 与 MySQL 同 VPC）
- [ ] 控制台已拿齐：MySQL 内网地址/端口/用户名/密码/所属 VPC+子网
- [ ] 若实例无 `biz_reporting` 库，迁移首步 `CREATE DATABASE` 已处理

---

## 6. 一句话总结给你

你“手搓”的难点**不在 NestJS 业务代码**，而在三处胶水：**TypeORM 读 `DB_*` 而非 `DATABASE_URL` 且生产关 `synchronize`**、**Dockerfile 烘焙“先迁移后启动 + 健康检查”的 entrypoint**、**CloudRun 必须显式给 `DB_*` 并配 `VpcConf` 才能连到 VPC 内的 MySQL**。把这三处写对，30 个业务模块原样搬上去就能跑。
