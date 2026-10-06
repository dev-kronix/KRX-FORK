import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiIdentity, PlatformService } from './platform.service';

export type ApiKeyRequest = Request & { apiIdentity: ApiIdentity };
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly platform: PlatformService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    const key = request.headers['x-api-key'];
    if (typeof key !== 'string')
      throw new UnauthorizedException('Envie a chave no header x-api-key.');
    request.apiIdentity = await this.platform.authenticateKey(key);
    return true;
  }
}
