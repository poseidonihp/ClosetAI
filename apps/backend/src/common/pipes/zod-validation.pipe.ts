import { ArgumentMetadata, BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodType, type ZodTypeDef } from 'zod';

/**
 * Valida el payload contra un esquema Zod y devuelve el dato ya tipado.
 *
 * La entrada y la salida del esquema se declaran por separado: un esquema con
 * `transform` —el caso de una query, que siempre llega como texto— no encaja en un
 * tipo que exija que entre y salga lo mismo.
 * @class
 */
export class ZodValidationPipe<TOutput, TInput = unknown> implements PipeTransform<
  unknown,
  TOutput
> {
  /**
   * Inicializa el pipe con el esquema que debe cumplir el payload.
   * @constructor
   * @param {ZodType<TOutput, ZodTypeDef, TInput>} schema - Esquema Zod contra el que se valida.
   */
  constructor(private readonly _schema: ZodType<TOutput, ZodTypeDef, TInput>) {}

  /**
   * Valida el valor entrante y devuelve el resultado parseado.
   * @param {unknown} value - Payload recibido en la petición.
   * @param {ArgumentMetadata} _metadata - Metadatos del argumento (no se usan).
   * @returns {TOutput}
   */
  transform(value: unknown, _metadata: ArgumentMetadata): TOutput {
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
