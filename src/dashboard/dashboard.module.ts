import { Controller, Get, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AllConfigType } from '../config/config.type';

@ApiTags('Dashboard')
@Controller({
  path: 'dashboard',
  version: '1',
})
class DashboardConfigController {
  constructor(private readonly configService: ConfigService<AllConfigType>) {}

  @Get('config')
  @ApiOkResponse({
    schema: {
      example: {
        googleClientId: '000000000000-example.apps.googleusercontent.com',
        apiBase: '/api/v1',
      },
    },
  })
  config() {
    return {
      googleClientId:
        this.configService.get('google.clientId', { infer: true }) ?? '',
      apiBase: '/api/v1',
    };
  }
}

@Module({
  controllers: [DashboardConfigController],
})
export class DashboardModule {}
