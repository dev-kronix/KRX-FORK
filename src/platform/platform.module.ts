import { Module } from '@nestjs/common';
import { PlatformService } from './platform.service';
import { ApiKeyGuard } from './api-key.guard';
import {
  AdminCreditsController,
  ApiKeysController,
  UsageController,
} from './platform.controller';
@Module({
  controllers: [ApiKeysController, UsageController, AdminCreditsController],
  providers: [PlatformService, ApiKeyGuard],
  exports: [PlatformService, ApiKeyGuard],
})
export class PlatformModule {}
