import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { maxUploadFileBytes } from '@closetai/shared-types';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';
import { LocalDiskDriver } from './storage/local-disk.driver';
import { accessCookieName } from './modules/auth/jwt.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { requestIdHeader } from './common/request-id';

// Acota los payloads JSON. Las subidas de imagen no pasan por aquí
const kilobyte = 1024;
const maxJsonBodyKb = 512;
const maxJsonBodyBytes = maxJsonBodyKb * kilobyte;

// Una foto por petición: el cliente sube en serie para poder mostrar progreso y reintentar sólo la que falle.
const maxFilesPerRequest = 1;
const maxFieldsPerRequest = 4;

/**
 * Arranca el backend con adaptador Fastify, cabeceras de seguridad, cookies,
 * filtro global de errores y Swagger sólo en desarrollo.
 * @returns {Promise<void>}
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('bootstrap');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      bodyLimit: maxJsonBodyBytes,
      // Acepta un x-request-id entrante (correlación entre servicios) o genera uno.
      requestIdHeader,
      genReqId: (request: IncomingMessage) => {
        const incoming = request.headers[requestIdHeader];
        return (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
      },
    }),
  );

  const config = app.get(ConfigService<Env, true>);
  const storage = app.get(LocalDiskDriver);
  const isProd = config.get('NODE_ENV', { infer: true }) === 'production';

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', (request: FastifyRequest, reply: FastifyReply, _payload, done) => {
      reply.header(requestIdHeader, request.id);
      done();
    });

  await app.register(fastifyHelmet, {
    // El CSP por defecto de helmet rompe el Swagger UI (scripts/estilos inline).
    contentSecurityPolicy: isProd,
  });

  await app.register(fastifyCookie, {
    secret: config.get<string>('COOKIE_SECRET', { infer: true }),
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: maxUploadFileBytes,
      files: maxFilesPerRequest,
      fields: maxFieldsPerRequest,
    },
  });

  // Las imágenes NO se sirven como carpeta estática
  await mkdir(storage.rootPath, { recursive: true });

  app.setGlobalPrefix('api', { exclude: ['health', 'health/db'] });
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
  });

  app.useGlobalFilters(new AllExceptionsFilter(isProd));

  if (!isProd) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('closetAI API')
      .setDescription('Endpoints de closetAI — pruébalos desde /docs')
      .setVersion('0.1.0')
      .addCookieAuth(accessCookieName, { type: 'apiKey', in: 'cookie' }, 'cookie')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');

  logger.log(`bootstrap - backend escuchando en http://localhost:${port}`);
  logger.log(`bootstrap - raíz de almacenamiento: ${storage.rootPath}`);
}

bootstrap().catch((error: unknown) => {
  new Logger('bootstrap').error(
    'bootstrap - error fatal al arrancar',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
