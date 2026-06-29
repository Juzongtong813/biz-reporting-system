import {
  Controller, Post, Request, UseGuards, UseInterceptors,
  UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ImportJobType } from '@biz-reporting/shared-types';
import { Ws6Service } from './ws6.service';

interface AuthenticatedRequest extends Express.Request {
  user: { userId: number; role: string; cityId: number | null };
}

@ApiTags('City - Imports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('city/imports')
export class CityImportsController {
  constructor(private readonly ws6Service: Ws6Service) {}

  @Post('reporting/upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  @ApiOperation({ summary: '上传城市报表导入文件' })
  async uploadReporting(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req: AuthenticatedRequest,
  ) {
    if (!file) throw new BadRequestException('请上传文件');

    // 将文件内容转为 Base64 持久化到数据库
    const fileBuffer = file.buffer;
    const base64 = fileBuffer.toString('base64');

    const job = await this.ws6Service.createImportJob({
      jobType: ImportJobType.CITY_REPORTING,
      operatorUserId: req.user.userId,
      cityId: req.user.cityId,
      sourceFileName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      sourceFileBase64: base64,
    });
    return { jobId: job.id, status: job.status, filename: file.originalname, sourceFileUrl: job.sourceFileUrl };
  }
}
