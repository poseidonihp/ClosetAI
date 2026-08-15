import { ArgumentMetadata, BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

/**
 * Valida el payload contra un esquema Zod y devuelve el dato ya tipado.
 * @class
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  /**
   * Inicializa el pipe con el esquema que debe cumplir el payload.
   * @constructor
   * @param {ZodSchema<T>} schema - Esquema Zod contra el que se valida.
   */
  constructor(private readonly _schema: ZodSchema<T>) {}

  /**
   * Valida el valor entrante y devuelve el resultado parseado.
   * @param {unknown} value - Payload recibido en la petición.
   * @param {ArgumentMetadata} _metadata - Metadatos del argumento (no se usan).
   * @returns {T}
   */
  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this._schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validación fallida',
        errors: result.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
