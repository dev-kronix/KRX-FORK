import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
import { PlatformService } from './platform.service';
import {
  AdjustCreditsDto,
  CreateApiKeyDto,
  PaginationDto,
} from './platform.dto';
import { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import { RequestWithUser } from '../utils/types/request-with-user.type';
import { RoleEnum } from '../roles/roles.enum';
import { Roles } from '../roles/roles.decorator';
import { RolesGuard } from '../roles/roles.guard';
type SessionRequest = RequestWithUser<JwtPayloadType>;

@ApiTags('API keys')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'keys', version: '1' })
export class ApiKeysController {
  constructor(private readonly platform: PlatformService) {}
  @Get() list(@Request() req: SessionRequest) {
    return this.platform.listKeys(Number(req.user.id));
  }
  @Post()
  @Header('Cache-Control', 'no-store')
  create(@Request() req: SessionRequest, @Body() dto: CreateApiKeyDto) {
    return this.platform.createKey(Number(req.user.id), dto.name);
  }
  @Delete(':id') revoke(
    @Request() req: SessionRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.platform.revokeKey(Number(req.user.id), id);
  }
}

@ApiTags('Credits and usage')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'usage', version: '1' })
export class UsageController {
  constructor(private readonly platform: PlatformService) {}
  @Get('summary') summary(@Request() req: SessionRequest) {
    return this.platform.summary(Number(req.user.id));
  }
  @Get('recent') recent(
    @Request() req: SessionRequest,
    @Query() dto: PaginationDto,
  ) {
    return this.platform.history(Number(req.user.id), dto);
  }
  @Get('ledger') ledger(
    @Request() req: SessionRequest,
    @Query() dto: PaginationDto,
  ) {
    return this.platform.history(Number(req.user.id), dto, true);
  }
}

@ApiTags('Admin credits')
@ApiBearerAuth()
@Roles(RoleEnum.admin)
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({ path: 'admin/credits', version: '1' })
export class AdminCreditsController {
  constructor(private readonly platform: PlatformService) {}
  @Post(':userId/adjustments')
  adjust(
    @Request() req: SessionRequest,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: AdjustCreditsDto,
  ) {
    return this.platform.adjustCredits(Number(req.user.id), userId, dto);
  }
}
