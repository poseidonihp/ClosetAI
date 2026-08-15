import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Filtro global de excepciones.
 *
 * - Las `HttpException` (4xx/5xx intencionales) se propagan con su cuerpo, porque
 *   las controla la aplicación y no filtran detalles internos.
 * - Cualquier otro error se transforma en un 500 genérico: el detalle se loguea
 *   en el servidor con el `requestId`, pero al cliente sólo le llega un mensaje
 *   neutro (evita fugas de stacks o de mensajes crudos de Prisma).
 * @class
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly _logger = new Logger(AllExceptionsFilter.name);

  /**
   * Inicializa el filtro indicando si corre en producción.
   * @constructor
   * @param {boolean} isProd - true cuando NODE_ENV es production.
   */
  constructor(private readonly _isProd: boolean) {}

  /**
   * Convierte cualquier excepción en una respuesta HTTP saneada.
   * @param {unknown} exception - Excepción capturada.
   * @param {ArgumentsHost} host - Contexto de ejecución de Nest.
   * @returns {void}
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const reply = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const requestId = request.id;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this._logger.error(
          `AllExceptionsFilter > catch - [${requestId}] ${request.method} ${request.url}`,
          exception.stack,
        );
      }
      reply.status(status).send(this._buildHttpPayload(exception, requestId, request.url));
      return;
    }

    this._logger.error(
      `AllExceptionsFilter > catch - [${requestId}] ${request.method} ${request.url} — error no controlado`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Error interno del servidor',
      ...(this._isProd || !(exception instanceof Error) ? {} : { detail: exception.message }),
      requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  /**
   * Construye el cuerpo de respuesta de una HttpException controlada.
   * @private
   * @param {HttpException} exception - Excepción HTTP lanzada por la aplicación.
   * @param {string} requestId - Identificador de correlación de la petición.
   * @param {string} path - Ruta solicitada.
   * @returns {Record<string, unknown>}
   */
  private _buildHttpPayload(
    exception: HttpException,
    requestId: string,
    path: string,
  ): Record<string, unknown> {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const base = {
      statusCode: status,
      requestId,
      timestamp: new Date().toISOString(),
      path,
    };
    if (typeof response === 'string') {
      return { ...base, message: response };
    }
    return { ...base, ...response };
  }
}
