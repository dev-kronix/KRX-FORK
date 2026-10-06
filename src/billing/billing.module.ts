import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { MercadoPagoGateway } from './mercado-pago.gateway';
import { BillingService } from './billing.service';
import {
  AdminBillingController,
  BillingController,
} from './billing.controller';
@Module({
  imports: [PlatformModule],
  controllers: [BillingController, AdminBillingController],
  providers: [BillingService, MercadoPagoGateway],
})
export class BillingModule {}
