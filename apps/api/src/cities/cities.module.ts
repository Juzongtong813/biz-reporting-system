import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CityEntity } from './city.entity';
import { CitiesController } from './cities.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CityEntity])],
  controllers: [CitiesController],
})
export class CitiesModule {}
