import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

// BigInt fields (paise amounts) serialize as strings so JSON.stringify doesn't throw.
// Frontend receives e.g. "4275000" — parse with parseInt/Number as needed.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  const corsOrigins = configService
    .get<string>('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim());

  app.enableCors({ origin: corsOrigins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // All business routes live under /api/v1/...
  // /health is permanently excluded from the prefix so that load balancers,
  // container orchestrators (K8s liveness probes), and Docker health checks
  // can reach it without knowing the API version. Do not move or re-prefix it.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('IValue WMS API')
    .setDescription('Warehouse Management System — IValue India')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('PORT', 3001);
  await app.listen(port);
}

bootstrap();
