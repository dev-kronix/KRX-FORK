import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { CheckoutDto, PlanDto, ReconcileDto, ReviewDto } from './billing.dto';
import { PaginationDto } from '../platform/platform.dto';
import { RequestWithUser } from '../utils/types/request-with-user.type';
import { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import { Roles } from '../roles/roles.decorator';
import { RolesGuard } from '../roles/roles.guard';
import { RoleEnum } from '../roles/roles.enum';
type SessionRequest = RequestWithUser<JwtPayloadType>;
@ApiTags('Billing')
@Controller({ path: 'billing', version: '1' })
export class BillingController {
  constructor(private readonly billing: BillingService) {}
  @Get('plans') async plans() {
    return {
      plans: await this.billing.plans(),
      payments: this.billing.configuration(),
    };
  }
  @Get('subscription')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  subscription(@Request() r: SessionRequest) {
    return this.billing.subscription(Number(r.user.id));
  }
  @Post('checkout')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  checkout(@Request() r: SessionRequest, @Body() dto: CheckoutDto) {
    return this.billing.checkout(Number(r.user.id), dto);
  }
  @Get('payments')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  payments(@Request() r: SessionRequest, @Query() page: PaginationDto) {
    return this.billing.payments(Number(r.user.id), page);
  }
  @Post('payments/:id/reconcile')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  reconcile(
    @Request() r: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReconcileDto,
  ) {
    return this.billing.reconcile(Number(r.user.id), id, dto.providerPaymentId);
  }
  @Post('webhooks/mercadopago')
  @HttpCode(200)
  webhook(
    @Query('data.id') id: unknown,
    @Headers('x-request-id') requestId: string = '',
    @Headers('x-signature') signature: string = '',
  ) {
    return this.billing.webhook(
      typeof id === 'string' ? id : '',
      requestId,
      signature,
    );
  }
}
@ApiTags('Admin billing')
@ApiBearerAuth()
@Roles(RoleEnum.admin)
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({ path: 'admin/billing', version: '1' })
export class AdminBillingController {
  constructor(private readonly billing: BillingService) {}
  @Get('plans') plans(@Request() r: SessionRequest) {
    return this.billing.plans(Number(r.user.id));
  }
  @Post('plans') save(@Request() r: SessionRequest, @Body() dto: PlanDto) {
    return this.billing.savePlan(Number(r.user.id), dto);
  }
  @Get('payments') payments(
    @Request() r: SessionRequest,
    @Query() page: PaginationDto,
  ) {
    return this.billing.payments(Number(r.user.id), page, true);
  }
  @Post('payments/:id/reconcile') reconcile(
    @Request() r: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReconcileDto,
  ) {
    return this.billing.reconcile(
      Number(r.user.id),
      id,
      dto.providerPaymentId,
      true,
    );
  }
  @Post('reviews/:userId/resolve') resolve(
    @Request() r: SessionRequest,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: ReviewDto,
  ) {
    return this.billing.resolveReview(Number(r.user.id), userId, dto.reason);
  }
}
