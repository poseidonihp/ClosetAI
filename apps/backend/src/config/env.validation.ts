import { z } from 'zod';
import { RenderQualityEnum, RenderSizeEnum } from '@closetai/shared-types';

const minJwtSecretLength = 32;
const minCookieSecretLength = 16;
const defaultPort = 3000;

// Ventana de inactividad de la sesión. Fuera de este rango la sesión deja de ser
// una ventana de inactividad: 30 s no da para escribir un formulario y 24 h ya es
// una sesión permanente.
const secondsPerMinute = 60;
const secondsPerHour = 3600;
const defaultSessionIdleTtl = '5m';
const minSessionIdleSeconds = 30;
const maxSessionIdleSeconds = 24 * secondsPerHour;
const durationPattern = /^(\d{1,7})\s*([smh])?$/i;

const defaultMonthlyBudgetUsd = 10;
const defaultJobMaxAttempts = 3;
const defaultRequestTimeoutMs = 60_000;
/**
 * Timeout de las llamadas de imagen. Va aparte porque generar una imagen tarda
 * bastante más que devolver JSON: con los 60 s del resto, un render de calidad
 * alta se cortaría casi siempre y el usuario pagaría un intento por nada.
 */
const defaultImageRequestTimeoutMs = 180_000;

/**
 * Modelo de visión por defecto. Se elige el más barato del catálogo vigente que
 * acepta imagen y Structured Outputs: etiquetar una prenda es una tarea acotada
 * y no justifica un modelo grande. Su precio vive en `openai-pricing.ts`.
 */
const defaultVisionModel = 'gpt-5.6-luna';
/**
 * Nivel de detalle de la imagen. `low` basta para color, patrón y tipo de
 * prenda, que es el 90 % del etiquetado; súbelo a `high` si necesitas leer
 * etiquetas de marca o texturas finas, sabiendo que multiplica los tokens.
 */
const defaultVisionImageDetail = 'low';
const defaultVisionMaxOutputTokens = 1200;

/**
 * Modelo del estilista. Aquí sí se paga un modelo mediano: elegir entre conjuntos
 * y escribir la ficha es la tarea con criterio del producto, y la Capa 1 ya redujo
 * la entrada a texto corto, así que la diferencia de precio se aplica sobre muy
 * pocos tokens. Su precio vive en `openai-pricing.ts`.
 */
const defaultStylistModel = 'gpt-5.6-terra';
/** Tres looks con su ficha completa caben de sobra; el corte se detecta y se reintenta. */
const defaultStylistMaxOutputTokens = 3000;

/**
 * Modelo de imagen del render (Fase 6). `gpt-image-2` es el más nuevo de la
 * familia, admite `input_fidelity: high` —lo que hace que la imagen se parezca a
 * las prendas de verdad— y sale más barato por imagen que `gpt-image-1`: misma
 * tarifa de texto, menos por imagen de entrada y de salida. Si lo cambias por
 * otro, añade antes su tarifa a `openai-pricing.ts`: un modelo desconocido se
 * cobra al precio más caro que conocemos y el costo quedaría mal registrado.
 */
const defaultImageModel = 'gpt-image-2';
/** Vertical: un look se ve de cuerpo entero, no en un cuadrado. */
const defaultImageSize = '1024x1536';
/**
 * `medium` es el punto donde el render ya se parece al look sin costar como una
 * tanda de looks del estilista. `high` multiplica por cuatro los tokens de salida.
 */
const defaultImageQuality = 'medium';
/**
 * Cuánto esfuerzo pone el modelo en respetar las imágenes de entrada. `high`
 * porque lo que se está renderizando son prendas concretas y no una idea: con
 * `low` el color y la textura se van, que es justo el riesgo 3 del plan.
 */
const defaultImageInputFidelity = 'high';
/** Calidad WebP del render que se guarda. El resto de las imágenes usa 82. */
const defaultImageOutputCompression = 88;
const maxOutputCompression = 100;

/**
 * Convierte una duración tipo `45s`, `5m` o `2h` a segundos; sin unidad son
 * segundos. Devuelve null si el formato no encaja.
 * @param {string} raw - Duración declarada en el entorno.
 * @returns {number | null}
 */
function parseDurationSeconds(raw: string): number | null {
  const match = durationPattern.exec(raw.trim());
  const amountText = match?.[1];
  if (!amountText) {
    return null;
  }
  const amount = Number(amountText);
  const unit = (match?.[2] ?? 's').toLowerCase();
  if (unit === 'h') {
    return amount * secondsPerHour;
  }
  if (unit === 'm') {
    return amount * secondsPerMinute;
  }
  return amount;
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(defaultPort),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(minJwtSecretLength, 'JWT_SECRET debe tener al menos 32 caracteres'),
    JWT_REFRESH_SECRET: z
      .string()
      .min(minJwtSecretLength, 'JWT_REFRESH_SECRET debe tener al menos 32 caracteres')
      .optional(),
    SESSION_IDLE_TTL: z
      .string()
      .default(defaultSessionIdleTtl)
      .transform((raw, ctx) => {
        const seconds = parseDurationSeconds(raw);
        if (
          seconds === null ||
          seconds < minSessionIdleSeconds ||
          seconds > maxSessionIdleSeconds
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `SESSION_IDLE_TTL debe ser una duración entre ${minSessionIdleSeconds}s y 24h (ej. 5m, 300, 2h)`,
          });
          return z.NEVER;
        }
        return seconds;
      }),
    COOKIE_SECRET: z.string().min(minCookieSecretLength),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: z
      .string()
      .default('false')
      .transform(value => value === 'true'),
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    // Orígenes permitidos por CORS, separados por coma.
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:4200')
      .transform(value =>
        value
          .split(',')
          .map(origin => origin.trim())
          .filter(Boolean),
      ),
    RSA_PRIVATE_KEY_B64: z
      .string()
      .min(
        1,
        'RSA_PRIVATE_KEY_B64 es requerido. Genéralo con: pnpm --filter @closetai/backend gen:rsa',
      ),
    STORAGE_ROOT: z.string().optional(),
    AI_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(defaultMonthlyBudgetUsd),
    AI_JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(defaultJobMaxAttempts),
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(defaultRequestTimeoutMs),
    AI_IMAGE_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(defaultImageRequestTimeoutMs),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_BASE_URL: z.string().url().optional(),
    OPENAI_VISION_MODEL: z.string().min(1).default(defaultVisionModel),
    OPENAI_VISION_IMAGE_DETAIL: z.enum(['auto', 'low', 'high']).default(defaultVisionImageDetail),
    OPENAI_VISION_MAX_OUTPUT_TOKENS: z.coerce
      .number()
      .int()
      .positive()
      .default(defaultVisionMaxOutputTokens),
    OPENAI_STYLIST_MODEL: z.string().min(1).default(defaultStylistModel),
    OPENAI_STYLIST_MAX_OUTPUT_TOKENS: z.coerce
      .number()
      .int()
      .positive()
      .default(defaultStylistMaxOutputTokens),
    OPENAI_IMAGE_MODEL: z.string().min(1).default(defaultImageModel),
    OPENAI_IMAGE_SIZE: RenderSizeEnum.default(defaultImageSize),
    OPENAI_IMAGE_QUALITY: RenderQualityEnum.default(defaultImageQuality),
    OPENAI_IMAGE_INPUT_FIDELITY: z.enum(['low', 'high']).default(defaultImageInputFidelity),
    OPENAI_IMAGE_OUTPUT_COMPRESSION: z.coerce
      .number()
      .int()
      .positive()
      .max(maxOutputCompression)
      .default(defaultImageOutputCompression),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') {
      return;
    }
    if (!env.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE debe ser "true" en producción (cookies sólo sobre HTTPS)',
      });
    }
    if (env.COOKIE_SAMESITE === 'none' && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SAMESITE'],
        message: 'SameSite=None requiere COOKIE_SECURE=true',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Valida las variables de entorno al arrancar. Un entorno inválido detiene el
 * proceso con un mensaje legible en vez de fallar más tarde en caliente.
 * @param {Record<string, unknown>} config - Variables de entorno crudas.
 * @returns {Env}
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map(issue => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${issues}`);
  }
  return result.data;
}
