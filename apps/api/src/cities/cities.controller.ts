import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CityEntity } from './city.entity';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Cities')
@Public()
@Controller('cities')
export class CitiesController {
  constructor(
    @InjectRepository(CityEntity)
    private readonly repo: Repository<CityEntity>,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取城市列表（公开，无需认证）' })
  async list() {
    const cities = await this.repo.find({ order: { sortOrder: 'ASC' } });
    return cities.map((c) => ({ id: c.id, name: c.name }));
  }
}
