import 'dotenv/config';
import helmet from 'helmet';
import type { Request, Response } from 'express';
import {
  ClassSerializerInterceptor,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import path from 'path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { useContainer } from 'class-validator';
import { AppModule } from './app.module';
import validationOptions from './utils/validation-options';
import { AllConfigType } from './config/config.type';
import { ResolvePromisesInterceptor } from './utils/serializer.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  useContainer(app.select(AppModule), { fallbackOnErrors: true });
  app.use(
    ['/confirm-email', '/confirm-new-email', '/password-change'],
    (req: Request, res: Response) => {
      const pathname = req.originalUrl.split('?')[0];
      const page =
        pathname === '/password-change' ? 'reset-password' : pathname.slice(1);
      const hash = typeof req.query.hash === 'string' ? req.query.hash : '';
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.redirect(
        '/dashboard/#/' + page + '?hash=' + encodeURIComponent(hash),
      );
    },
  );
  app.useStaticAssets(path.join(__dirname, 'dashboard', 'public'), {
    prefix: '/dashboard',
  });
  const configService = app.get(ConfigService<AllConfigType>);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const corsOrigins = configService.getOrThrow('app.corsOrigins', {
    infer: true,
  });
  app.enableCors({
    origin: corsOrigins.includes('*') ? '*' : corsOrigins,
  });

  app.enableShutdownHooks();
  app.setGlobalPrefix(
    configService.getOrThrow('app.apiPrefix', { infer: true }),
    {
      exclude: ['/'],
    },
  );
  app.enableVersioning({
    type: VersioningType.URI,
  });
  app.useGlobalPipes(new ValidationPipe(validationOptions));
  app.useGlobalInterceptors(
    // ResolvePromisesInterceptor is used to resolve promises in responses because class-transformer can't do it
    // https://github.com/typestack/class-transformer/issues/549
    new ResolvePromisesInterceptor(),
    new ClassSerializerInterceptor(app.get(Reflector)),
  );

  const options = new DocumentBuilder()
    .setTitle('KRX API')
    .setDescription('API REST oficial da KRX')
    .setVersion('1.0')
    .addBearerAuth()
    .addServer('https://krxdev.tech', 'Produção')
    .addServer('http://localhost:3001', 'Desenvolvimento')
    .addGlobalParameters({
      in: 'header',
      required: false,
      name: process.env.APP_HEADER_LANGUAGE || 'x-custom-lang',
      schema: {
        example: 'pt-BR',
      },
    })
    .build();

  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('docs', app, document);

  await app.listen(configService.getOrThrow('app.port', { infer: true }));
}
void bootstrap();
