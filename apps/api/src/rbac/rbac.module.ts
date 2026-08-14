import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformUserEntity } from './platform-user.entity';
import { RoleEntity } from './role.entity';
import { RolePermissionEntity } from './role-permission.entity';
import { UserPermissionOverrideEntity } from './user-permission-override.entity';
import { UserDataScopeEntity } from './user-data-scope.entity';
import { ModuleEntity } from './module.entity';
import { PermissionEntity } from './permission.entity';
import { CityEntity } from '../main-data/city.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { RbacService } from './rbac.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlatformUserEntity,
      RoleEntity,
      RolePermissionEntity,
      UserPermissionOverrideEntity,
      UserDataScopeEntity,
      ModuleEntity,
      PermissionEntity,
      CityEntity,
      ProvinceEntity,
    ]),
  ],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
