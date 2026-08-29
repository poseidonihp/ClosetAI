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
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';
import { LocalDiskDriver } from './storage/local-disk.driver';
import { accessCookieName } from './modules/auth/jwt.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { requestIdHeader } from './common/request-id';
import { contentSecurityPolicyDirectives } from './common/security-headers';
import { registerSpa } from './common/serve-spa';

// Acota los payloads JSON. Las subidas de imagen no pasan por aquí
const kilobyte = 1024;
const maxJsonBodyKb = 512;
const maxJsonBodyBytes = maxJsonBodyKb * kilobyte;

// Una foto por petición: el cliente sube en serie para poder mostrar progreso y reintentar sólo la que falle.
const maxFilesPerRequest = 1;
const maxFieldsPerRequest = 4;
const defaultSpaDistPath = resolve(__dirname, '../../frontend/dist/frontend/browser');
const trustProxy = process.env['TRUST_PROXY'] === 'true';

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
      trustProxy,
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
    contentSecurityPolicy: isProd ? { directives: contentSecurityPolicyDirectives } : false,
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

  let spaIndexHtml: Buffer | null = null;
  if (config.get('SERVE_SPA', { infer: true })) {
    // Una ruta vacía en el .env cae al default del monorepo.
    const spaPath = config.get('SPA_DIST_PATH', { infer: true })?.trim() || defaultSpaDistPath;
    spaIndexHtml = await registerSpa(app, spaPath);
  }

  app.useGlobalFilters(new AllExceptionsFilter(isProd, spaIndexHtml));

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
  const host = config.get('HOST', { infer: true });
  await app.listen(port, host);

  logger.log(`bootstrap - backend escuchando en http://${host}:${port}`);
  logger.log(`bootstrap - raíz de almacenamiento: ${storage.rootPath}`);
  if (trustProxy) {
    logger.log('bootstrap - confiando en X-Forwarded-For para resolver la IP del cliente');
  }
}

bootstrap().catch((error: unknown) => {
  new Logger('bootstrap').error(
    'bootstrap - error fatal al arrancar',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
