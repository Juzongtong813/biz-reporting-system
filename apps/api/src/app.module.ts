import { Module, NestModule, MiddlewareConsumer, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';

/** MySQL 下 TypeORM 连接初始化需要 typeorm_metadata 内部表（业务迁移不含此表，启动时幂等创建） */
@Injectable()
class TypeOrmMetadataBootstrap implements OnModuleInit {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}
  async onModuleInit(): Promise<void> {
    if (this.dataSource.options.type !== 'mysql') return;
    await this.dataSource.query('CREATE TABLE IF NOT EXISTS `typeorm_metadata` (\n  `type` varchar(64) NOT NULL,\n  `database` varchar(255) NOT NULL DEFAULT \'\',\n  `schema` varchar(255) NOT NULL DEFAULT \'\',\n  `table` varchar(255) NOT NULL DEFAULT \'\',\n  `name` varchar(255) NOT NULL DEFAULT \'\',\n  `value` text,\n  PRIMARY KEY (`type`,`database`,`schema`,`table`,`name`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
  }
}

// 核心业务模块
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PackagesModule } from './packages/packages.module';
import { ContractsModule } from './contracts/contracts.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CityConfigsModule } from './city-configs/city-configs.module';
import { OperationLogsModule } from './operation-logs/operation-logs.module';
import { CitiesModule } from './cities/cities.module';
import { RemindersModule } from './reminders/reminders.module';
import { AiModule } from './ai/ai.module';
import { Ws6Module } from './ws6/ws6.module';
import { FactsModule } from './facts/facts.module';
import { BizAuthModule } from './biz-auth/biz-auth.module';
import { BizContractsModule } from './biz-contracts/biz-contracts.module';
import { BizOrdersModule } from './biz-orders/biz-orders.module';
import { BizCompletionsModule } from './biz-completions/biz-completions.module';
import { BizCostsModule } from './biz-costs/biz-costs.module';
import { BizAggregatesModule } from './biz-aggregates/biz-aggregates.module';
import { validateRuntimeEnvironment } from './runtime.config';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { RequestIdMiddleware } from './common/http/request-id.middleware';
import { HttpLoggingInterceptor } from './common/http/http-logging.interceptor';

@Module({
  imports: [
    // 定时任务
    ScheduleModule.forRoot(),

    // 全局 IP 限流（默认 120/min；登录端点后续 C-05 覆盖 5/min）。
    // 注意：默认内存存储只支持单实例限流，P0 MaxNum=1 前不得声称多实例全局限流。
    ThrottlerModule.forRoot([{
      name: 'default',
      ttl: 60_000,
      limit: 120,
    }]),

    // 环境变量配置
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateRuntimeEnvironment,
      envFilePath:
        process.env.NODE_ENV === 'production'
          ? ['.env']
          : ['.env.local', '.env'],
    }),

    // TypeORM 数据库连接（支持 MySQL / SQLite 切换）
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => {
        const nodeEnv = config.get<string>('NODE_ENV', 'development');
        const isProduction = nodeEnv === 'production';
        const dbType = config.get<string>('DB_TYPE', 'mysql');
        const dbPoolConnectionLimit = Number(
          config.get<string>('DB_POOL_CONNECTION_LIMIT', '10'),
        );
        const dbPoolQueueLimit = Number(
          config.get<string>('DB_POOL_QUEUE_LIMIT', '0'),
        );

        if (dbType === 'sqlite') {
          return {
            type: 'better-sqlite3',
            database: config.get<string>('DB_DATABASE', './data/dev.sqlite'),
            entities: [__dirname + '/**/*.entity.ts', __dirname + '/**/*.entity.js'],
            // M8 安全修复：DB_SYNC 字符串 'false' 不得被误判为 true（生产强制 false）
            synchronize: isProduction ? false : config.get<string>('DB_SYNC', 'false') === 'true',
            logging: config.get<boolean>('DB_LOGGING', false),
          };
        }

        return {
          type: 'mysql',
          host: config.get<string>('DB_HOST', 'localhost'),
          port: config.get<number>('DB_PORT', 3306),
          username: config.get<string>('DB_USERNAME', 'root'),
          password: config.get<string>('DB_PASSWORD', ''),
          database: config.get<string>('DB_DATABASE', 'biz_reporting'),
          charset: 'utf8mb4',
          entities: [__dirname + '/**/*.entity.ts', __dirname + '/**/*.entity.js'],
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

    // 业务模块
    AuthModule,
    UsersModule,
    PackagesModule,
    ContractsModule,
    DashboardModule,
    CityConfigsModule,
    OperationLogsModule,
    AiModule,
    CitiesModule,
    RemindersModule,
    Ws6Module,
    FactsModule,
    BizAuthModule,
    BizContractsModule,
    BizOrdersModule,
    BizCompletionsModule,
    BizCostsModule,
    BizAggregatesModule,
  ],
  controllers: [AppController],
  providers: [
    TypeOrmMetadataBootstrap,
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // E-03：全路由注入 request ID 中间件（响应回传 X-Request-Id）
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}


