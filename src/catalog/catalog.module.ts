import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { CatalogService } from './catalog.service';
import {
  CatalogController,
  AdminCatalogController,
} from './catalog.controller';
@Module({
  imports: [PlatformModule],
  providers: [CatalogService],
  controllers: [CatalogController, AdminCatalogController],
})
export class CatalogModule {}
