import {
  Controller, Post, Request, UseGuards, UseInterceptors,
  UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role, ImportJobType } from '@biz-reporting/shared-types';
import { Ws6Service } from './ws6.service';

interface AuthenticatedRequest extends Express.Request {
  user: { userId: number; role: string; cityId: number | null };
}

@ApiTags('Admin - Imports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/imports')
export class AdminImportsController {
  constructor(private readonly ws6Service: Ws6Service) {}

  @Post('contracts/upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  @ApiOperation({ summary: '上传合同导入文件' })
  async uploadContracts(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req: AuthenticatedRequest,
  ) {
    if (!file) throw new BadRequestException('请上传文件');

    // 将文件内容转为 Base64 持久化到数据库
    const fileBuffer = file.buffer;
    const base64 = fileBuffer.toString('base64');

    const job = await this.ws6Service.createImportJob({
      jobType: ImportJobType.CONTRACT,
      operatorUserId: req.user.userId,
      cityId: null,
      sourceFileName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      sourceFileBase64: base64,
    });
    return { jobId: job.id, status: job.status, filename: file.originalname, sourceFileUrl: job.sourceFileUrl };
  }
}
