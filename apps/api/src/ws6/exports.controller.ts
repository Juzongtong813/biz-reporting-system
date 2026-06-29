import { Controller, Post, Get, Body, Param, Request, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Ws6Service } from './ws6.service';
import { CreateExportJobRequestDto } from './ws6.dto';
import type { Express } from 'express';

interface AuthenticatedRequest extends Express.Request {
  user: { userId: number; role: string; cityId: number | null };
}

@ApiTags('Exports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('exports')
export class ExportsController {
  constructor(private readonly ws6Service: Ws6Service) {}

  @Post()
  @ApiOperation({ summary: '创建导出任务' })
  async create(@Body() dto: CreateExportJobRequestDto, @Request() req: AuthenticatedRequest) {
    const job = await this.ws6Service.createExportJob(dto, req.user.userId);
    return { jobId: job.id, status: job.status };
  }

  @Get(':jobId')
  @ApiOperation({ summary: '获取导出任务状态' })
  async getJob(@Param('jobId', ParseIntPipe) jobId: number) {
    return this.ws6Service.getExportJob(jobId);
  }
}
