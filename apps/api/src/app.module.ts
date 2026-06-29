import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersService } from './users/users.service';

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
import { Ws6Module } from './ws6/ws6.module';

@Module({
  imports: [
    // 定时任务
    ScheduleModule.forRoot(),

    // 环境变量配置
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production'
          ? ['.env']
          : ['.env.local', '.env'],
    }),

    // TypeORM 数据库连接（支持 MySQL / SQLite 切换）
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const nodeEnv = config.get<string>('NODE_ENV', 'development');
        const isProduction = nodeEnv === 'production';
        const dbType = config.get<string>('DB_TYPE', 'mysql');

        if (dbType === 'sqlite') {
          return {
            type: 'better-sqlite3' as any,
            database: config.get<string>('DB_DATABASE', './data/dev.sqlite'),
            entities: [__dirname + '/**/*.entity.ts', __dirname + '/**/*.entity.js'],
            synchronize: isProduction ? false : config.get<boolean>('DB_SYNC', true),
            logging: config.get<boolean>('DB_LOGGING', false),
          };
        }

        return {
          type: 'mysql' as any,
          host: config.get<string>('DB_HOST', 'localhost'),
          port: config.get<number>('DB_PORT', 3306),
          username: config.get<string>('DB_USERNAME', 'root'),
          password: config.get<string>('DB_PASSWORD', ''),
          database: config.get<string>('DB_DATABASE', 'biz_reporting'),
          charset: 'utf8mb4',
          entities: [__dirname + '/**/*.entity.ts', __dirname + '/**/*.entity.js'],
          synchronize: isProduction ? false : config.get<boolean>('DB_SYNC', false),
          logging: config.get<boolean>('DB_LOGGING', false),
          retryAttempts: 3,
          retryDelay: 3000,
          extra: {
            connectionLimit: 3,
            waitForConnections: true,
            enableKeepAlive: true,
            keepAliveInitialDelay: 10000,
            connectTimeout: 10000,
            maxIdle: 1,
            queueLimit: 10,
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
    CitiesModule,
    RemindersModule,
    Ws6Module,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly usersService: UsersService) {}

  async onModuleInit() {
    await this.usersService.seedAdminIfNeeded();
  }
}
