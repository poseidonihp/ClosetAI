/**
 * Política de seguridad de contenido del origen de producción.
 *
 * En producción la SPA y la API salen del **mismo** proceso, así que esta
 * cabecera protege también al `index.html` y es la fuente de verdad. La copia en
 * `apps/frontend/src/index.html` sólo cubre al dev server, que sirve el índice
 * sin pasar por aquí: si cambias una directiva, cámbiala en los dos sitios.
 *
 * `frame-ancestors` sólo existe aquí porque el navegador la ignora dentro de un
 * `<meta>`, y es justo la que impide que la app se embeba en otra página.
 */
export const contentSecurityPolicyDirectives = {
  defaultSrc: ["'self'"],
  connectSrc: ["'self'"],
 imgSrc: ["'self'", 'data:', 'blob:'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  scriptSrc: ["'self'"],
  workerSrc: ["'self'"],
  manifestSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
} as const;
