import { Controller, Get, Post, Param, Body, UseGuards, ParseIntPipe, Header, StreamableFile } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Ws6Service } from './ws6.service';
import { ConfirmImportRequestDto } from './ws6.dto';

@ApiTags('Imports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('imports')
export class ImportsController {
  constructor(private readonly ws6Service: Ws6Service) {}

  @Get(':jobId/preview')
  @ApiOperation({ summary: '获取导入预览' })
  async preview(@Param('jobId', ParseIntPipe) jobId: number) {
    return this.ws6Service.getImportPreview(jobId);
  }

  @Get(':jobId/source-file')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '下载导入源文件' })
  async sourceFile(@Param('jobId', ParseIntPipe) jobId: number) {
    const file = await this.ws6Service.getImportSourceFile(jobId);
    return new StreamableFile(file.buffer, {
      type: file.contentType,
      disposition: `attachment; filename="${encodeURIComponent(file.fileName)}"`,
    });
  }

  @Post(':jobId/confirm')
  @ApiOperation({ summary: '确认导入' })
  async confirm(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Body() dto: ConfirmImportRequestDto,
  ) {
    return this.ws6Service.confirmImport(jobId, dto);
  }
}
