import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { SupportService } from './support.service';
import {
  SupportController,
  AdminSupportController,
  NotificationsController,
} from './support.controller';
@Module({
  imports: [PlatformModule],
  providers: [SupportService],
  controllers: [
    SupportController,
    AdminSupportController,
    NotificationsController,
  ],
})
export class SupportModule {}
