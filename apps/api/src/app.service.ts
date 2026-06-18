import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /**
   * 健康检查端点
   */
  getHealth(): string {
    return JSON.stringify({
      name: '经营单元上报系统 API',
      version: '1.0.0',
      status: 'running',
      timestamp: new Date().toISOString(),
    });
  }
}
