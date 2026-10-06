import { Controller, Get, Header, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../roles/roles.decorator';
import { RolesGuard } from '../roles/roles.guard';
import { RoleEnum } from '../roles/roles.enum';
import { RequestWithUser } from '../utils/types/request-with-user.type';
import { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import { PlatformService } from '../platform/platform.service';
import { CatalogService } from './catalog.service';
@ApiTags('Catalog')
@Controller({ path: 'catalog', version: '1' })
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get() @Header('Cache-Control', 'public, max-age=60') get() {
    return this.catalog.catalog();
  }
}
@ApiTags('Admin catalog')
@ApiBearerAuth()
@Roles(RoleEnum.admin)
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({ path: 'admin/catalog', version: '1' })
export class AdminCatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly platform: PlatformService,
  ) {}
  @Get() @Header('Cache-Control', 'no-store') async get(
    @Request() req: RequestWithUser<JwtPayloadType>,
  ) {
    await this.platform.activeUser(Number(req.user.id), undefined, true);
    return this.catalog.catalog(true);
  }
}
