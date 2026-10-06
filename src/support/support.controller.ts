import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequestWithUser } from '../utils/types/request-with-user.type';
import { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import { PaginationDto } from '../platform/platform.dto';
import { SupportService } from './support.service';
import { MessageDto, TicketDto, TicketStatusDto } from './support.dto';
import { Roles } from '../roles/roles.decorator';
import { RolesGuard } from '../roles/roles.guard';
import { RoleEnum } from '../roles/roles.enum';
type SessionRequest = RequestWithUser<JwtPayloadType>;
@ApiTags('Support')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'support', version: '1' })
export class SupportController {
  constructor(private readonly support: SupportService) {}
  @Get() list(@Request() req: SessionRequest, @Query() dto: PaginationDto) {
    return this.support.list(Number(req.user.id), dto, false);
  }
  @Get(':id') detail(
    @Request() req: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.support.detail(Number(req.user.id), id, false);
  }
  @Post(':id/messages') reply(
    @Request() req: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MessageDto,
  ) {
    return this.support.reply(Number(req.user.id), id, dto, false);
  }
  @Patch(':id/status') status(
    @Request() req: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TicketStatusDto,
  ) {
    return this.support.status(Number(req.user.id), id, dto.status, false);
  }
  @Post() create(@Request() req: SessionRequest, @Body() dto: TicketDto) {
    return this.support.create(Number(req.user.id), dto);
  }
}
@ApiTags('Support')
@ApiBearerAuth()
@Roles(RoleEnum.admin)
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({ path: 'admin/support', version: '1' })
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}
  @Get() list(@Request() req: SessionRequest, @Query() dto: PaginationDto) {
    return this.support.list(Number(req.user.id), dto, true);
  }
  @Get(':id') detail(
    @Request() req: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.support.detail(Number(req.user.id), id, true);
  }
  @Post(':id/messages') reply(
    @Request() req: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MessageDto,
  ) {
    return this.support.reply(Number(req.user.id), id, dto, true);
  }
  @Patch(':id/status') status(
    @Request() req: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TicketStatusDto,
  ) {
    return this.support.status(Number(req.user.id), id, dto.status, true);
  }
}
@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly support: SupportService) {}
  @Get() list(@Request() req: SessionRequest, @Query() dto: PaginationDto) {
    return this.support.notifications(Number(req.user.id), dto);
  }
  @Patch(':id/read') read(
    @Request() req: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.support.read(Number(req.user.id), id);
  }
}
