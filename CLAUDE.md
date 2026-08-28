# CLAUDE.md

Guía para Claude Code (claude.ai/code) al trabajar en este repositorio. Es la
**única fuente de verdad** de comandos y convenciones: si algo cambia, se cambia
aquí y no se duplica en otro documento.

## Proyecto

closetAI: fotografías una prenda, la IA la cataloga y te arma looks **usando sólo
prendas que ya tienes**, más un análisis aparte de qué te falta comprar. Web
responsive (mismo código en escritorio y móvil), instalable como PWA.

- [plan.md](plan.md) — plan por fases, modelo de datos y diseño del motor de
  recomendación. Su tabla de estado dice en qué fase vamos; **actualízala al
  cerrar una fase**, no antes de cumplir su verificación.
- [examplepng.png](examplepng.png) — la especificación visual de la ficha de look.
  El objetivo es esa ficha, pero armada con prendas reales de la base de datos.

**Estado: Fases 0 a 7 completas.** Hay auth, storage privado, infraestructura de
IA, shell responsive, perfil de estilo, catálogo de tipos de prenda, clóset con
subida de fotos, el motor de compatibilidad con su ficha de look determinista, el
etiquetado por visión, el estilista LLM con persistencia de `Outfit`, el bucle de
aprendizaje sobre el `engineScore`, el análisis de vacíos con su página "Qué
comprar", el render visual del look y la evaluación de una prenda antes de
comprarla. **No hay todavía** PWA ni despliegue endurecido (fase 8).

La Fase 7 se verificó de punta a punta: las rutas deterministas —medición,
veredicto, duplicados, aislamiento por usuario y la transición de compra— y sus
dos llamadas a IA, con candidatas reales que pasaron por el etiquetado por visión
(`vision-v4`, cuatro fotos) y por la redacción del veredicto (`gpt-5.6-terra`, un
job por prenda, del orden de 0,003 USD cada uno).

## Comandos

Desde la raíz salvo que se indique otra cosa. Node 22+ y pnpm 11+.

| Tarea                                | Comando                                           |
| ------------------------------------ | ------------------------------------------------- |
| Instalar dependencias                | `pnpm install`                                    |
| Dev (backend + frontend en paralelo) | `pnpm dev`                                        |
| Build de todo                        | `pnpm build`                                      |
| Typecheck de todo                    | `pnpm typecheck`                                  |
| Tests unitarios                      | `pnpm test`                                       |
| Lint (ESLint, todo el repo)          | `pnpm lint`                                       |
| Formato / comprobar formato          | `pnpm format` / `pnpm format:check`               |
| Sólo backend                         | `pnpm --filter @closetai/backend dev`             |
| Sólo frontend                        | `pnpm --filter @closetai/frontend dev`            |
| Migración de desarrollo              | `pnpm --filter @closetai/backend prisma:migrate`  |
| Migración en despliegue              | `pnpm --filter @closetai/backend prisma:deploy`   |
| Regenerar cliente Prisma             | `pnpm --filter @closetai/backend prisma:generate` |
| Prisma Studio                        | `pnpm --filter @closetai/backend prisma:studio`   |
| Reset de la base (destructivo)       | `pnpm --filter @closetai/backend db:reset`        |
| Sembrar el catálogo de prendas       | `pnpm --filter @closetai/backend db:seed`         |
| Generar par RSA para el login        | `pnpm --filter @closetai/backend gen:rsa`         |

Frontend en `http://localhost:4200`, backend en `http://localhost:3000`. El dev
server hace proxy de `/api` y `/health` ([proxy.conf.json](apps/frontend/proxy.conf.json)),
así que el frontend **siempre** usa rutas relativas, nunca `localhost:3000`.
Swagger en `http://localhost:3000/docs` (desactivado con `NODE_ENV=production`).

Las cinco comprobaciones que corre CI ([.github/workflows/ci.yml](.github/workflows/ci.yml))
son las mismas de la tabla: `format:check`, `lint`, `typecheck`, `test`, `build`.
A diferencia de `journal`, aquí **las cinco funcionan de verdad**; si una falla,
está rota de verdad.

## Arquitectura

```
apps/backend/     NestJS 10 + Fastify 4, Prisma 6 + PostgreSQL, Zod 3
apps/frontend/    Angular 21 standalone zoneless + Tailwind 4
packages/shared-types/  esquemas Zod + tipos, compartidos front/back
packages/config/  tsconfig-base.json + prettier-base.json
storage/          uploads locales de desarrollo (gitignored)
```

Muchos patrones vienen del proyecto hermano `journal` (auth, storage, `ApiClient`,
`shared/ui/`). Están **adaptados, no copiados**: nombres, cookies, prefijos y
convenciones difieren. No asumas que un archivo de `journal` sirve tal cual.

### shared-types (`@closetai/shared-types`)

Es un paquete **compilado**: `main`/`types` apuntan a `dist/`, generado por `tsc`.
Las tareas `dev` y `build` de Turbo dependen de `^build`, así que `pnpm dev` lo
compila antes de arrancar. Si editas un esquema a media sesión, las apps siguen
viendo el `dist/` viejo: deja corriendo `pnpm --filter @closetai/shared-types dev`
(tsc en watch) o recompila a mano. Todo archivo nuevo se reexporta desde
[src/index.ts](packages/shared-types/src/index.ts).

Las etiquetas en español de los enums viven aquí, en `enumLabels`
([src/enums.ts](packages/shared-types/src/enums.ts)). Los valores se almacenan y
viajan en inglés. Cada enum de Prisma tiene su gemelo Zod aquí y su entrada en
`enumLabels`: el `satisfies Record<T, string>` hace que falte una etiqueta rompa
la compilación en vez de la interfaz en caliente.

`colorFamilyFromHex` ([src/color.ts](packages/shared-types/src/color.ts)) deriva
la familia de color desde el hex para poder filtrar el clóset sin una columna que
se desincronice. Es la señal del filtro, **no** la puntuación de armonía de color
del motor, que trabaja sobre HSL completo en
[color-harmony.ts](apps/backend/src/modules/stylist/engine/color-harmony.ts) y sí
la consulta para saber qué familias se comportan como neutras.

### Backend

- Entrada: [src/main.ts](apps/backend/src/main.ts). Registra helmet y cookies,
  fija el prefijo global `api` **excluyendo** `health` y `health/db`, y monta
  Swagger sólo fuera de producción.
- **Dos guards globales**: `ThrottlerGuard` (100 req/min por IP) en
  [app.module.ts](apps/backend/src/app.module.ts) y `JwtAuthGuard` en
  [auth.module.ts](apps/backend/src/modules/auth/auth.module.ts). **Todo endpoint
  exige sesión por defecto**; se opta por salir con `@Public()` y se obtiene el
  usuario con `@CurrentUser()`.
- **Env validado con Zod al arrancar** ([config/env.validation.ts](apps/backend/src/config/env.validation.ts)).
  Un entorno inválido tumba el proceso con un mensaje legible. Dos trampas: en
  producción no arranca sin `COOKIE_SECURE=true`, y **toda variable nueva debe
  declararse en el esquema aunque se lea de `process.env`** — `ConfigModule` sólo
  propaga las claves que devuelve el validador (por eso `STORAGE_ROOT` está
  declarada aunque la lea `LocalDiskDriver`).
- **Auth**: JWT en cookies httpOnly `closet_access` (path `/`) y `closet_refresh`
  (path `/api/auth`). Los nombres se exportan desde
  [jwt.guard.ts](apps/backend/src/modules/auth/jwt.guard.ts); reutiliza las
  constantes. Los refresh rotan y se agrupan por familia: reusar un `jti` revocado
  revoca la familia entera.
- **La sesión muere por inactividad y eso no es una regla del cliente, es la vida
  de los tokens.** `SESSION_IDLE_TTL` (5 min por defecto, 30s–24h) es la **única**
  fuente de la vida de la sesión: de ahí salen los dos TTL y los dos `maxAge`
  ([session-ttl.ts](apps/backend/src/modules/auth/session-ttl.ts)). El refresh vive
  la ventana entera y el access **media** ventana, para que refrescar la deslice
  mientras el refresh aún está vivo; por eso no queda ningún `JWT_*_TTL` con el que
  configurar una sesión que sobreviva a la inactividad. Un cliente que deja de
  refrescar no necesita que nadie lo eche: sus dos cookies ya caducaron.
  `GET /api/auth/session-policy` publica la ventana para que el cliente cierre y
  avise en el mismo instante en que el servidor deja de aceptar los tokens.
  Consecuencia asumida: rotar cada media ventana escribe muchas más filas
  `RefreshToken` que antes (una cada 2,5 min de uso continuo frente a una cada 15).
- **El password viaja cifrado con RSA-OAEP** sobre HTTPS, para que no acabe en
  claro en un log de proxy o APM. El cliente pide `GET /api/auth/public-key` y
  manda `encryptedPassword`; el servidor descifra y compara contra el hash bcrypt.
  Cualquier endpoint que acepte password recibe `encryptedPassword`, nunca texto
  plano. `RSA_PRIVATE_KEY_B64` es obligatoria para arrancar.
- **Validación**: sólo Zod, vía `ZodValidationPipe`. Nada de class-validator. El pipe
  declara entrada y salida por separado, así que un esquema con `transform` encaja:
  hace falta para una query, donde todo llega como texto y `z.coerce.boolean()`
  convertiría `'false'` en `true`.
- **Aislamiento por usuario es manual y no negociable**: cada método de servicio
  recibe `userId` y filtra por él (`findFirst({ where: { id, userId } })`, no
  `findUnique`). No hay RLS ni middleware que lo haga por ti.
- **Storage privado**: nada se sirve como carpeta estática. Los archivos se leen
  por `GET /api/media?key=...`, que exige sesión y comprueba que la key empiece
  por el id del usuario. Las keys son `userId/entityId/archivo.ext` y el patrón se
  valida en [shared-types/src/media.ts](packages/shared-types/src/media.ts) para
  cortar el recorrido de directorios antes de tocar el disco. `@fastify/static`
  está instalado **sólo** porque Swagger UI lo necesita.
- **Subida de imágenes**: `@fastify/multipart` con **una foto por petición**
  ([main.ts](apps/backend/src/main.ts) fija `fileSize`), para que el cliente pueda
  mostrar progreso y reintentar sólo la que falló. `sharp` normaliza a WebP
  (principal ≤1600 px, miniatura 400 px) y **elimina el EXIF**: el formato se
  deduce del binario, no del `Content-Type` que declare el cliente
  ([image-processing.ts](apps/backend/src/modules/garments/image-processing.ts)).
  Cada foto son **dos filas** `GarmentImage` —`ORIGINAL` y `THUMB`— que comparten
  `sortOrder`; la API las agrupa en una sola foto con sus dos URL.
- **Catálogo de tipos de prenda** ([prisma/seed.ts](apps/backend/prisma/seed.ts)):
  global, no por usuario, e idempotente por `slug`. `appliesTo` ordena y sugiere,
  **nunca** excluye. Si añades tipos, vuelve a correr `db:seed`.
- **Motor de compatibilidad** ([modules/stylist/engine/](apps/backend/src/modules/stylist/engine/)):
  la Capa 1 del plan. Es **código puro** que trabaja sobre los DTO de
  `shared-types` —no conoce Prisma ni Nest—, así que un caso golden se escribe con
  objetos literales ([engine.fixtures.ts](apps/backend/src/modules/stylist/engine/engine.fixtures.ts)).
  `StylistService` sólo carga clóset y perfil y se los pasa.
  Las reglas duras van como **arrays declarativos** ([garment-rules.ts](apps/backend/src/modules/stylist/engine/garment-rules.ts),
  [fit-rules.ts](apps/backend/src/modules/stylist/engine/fit-rules.ts)) y cada
  descarte sale con su motivo; todos los umbrales viven en
  [engine.constants.ts](apps/backend/src/modules/stylist/engine/engine.constants.ts)
  y en ningún otro sitio. Las reglas de ajuste **jamás excluyen** una prenda por el
  cuerpo del usuario, y las basadas en medidas sólo premian o comentan.
  Las prendas opcionales entran con dos criterios distintos y eso es deliberado
  ([candidates.ts](apps/backend/src/modules/stylist/engine/candidates.ts)): **la capa
  entra cuando la temperatura la pide**, suba o no la nota —exigirle que mejorase
  dejaba conjuntos sin chaqueta a 16 °C porque el color que añadía costaba más que el
  premio por capas—, y **los accesorios entran si no empeoran** más allá de
  `optionalPieceTolerance`, porque un accesorio bien elegido no mueve ninguna señal y
  con la regla de "sólo si mejora" no entraba ninguno jamás.
  Cero candidatos **no** significa improvisar: se devuelve un diagnóstico concreto
  ([diagnostics.ts](apps/backend/src/modules/stylist/engine/diagnostics.ts)). Un
  clóset que no llega a la ventana de formalidad pedida recibe su mejor conjunto
  real más una nota que lo admite, nunca una prenda inventada.
  La Capa 1 **no persiste nada**: es determinista y recalcular es gratis. Lo que se
  guarda son los looks del estilista, que llevan una llamada pagada detrás.
  `POST /api/stylist/looks/debug` expone elegibles, descartes y candidatos
  puntuados, siempre scoped por usuario.
  `buildDraft` ([outfit-draft.ts](apps/backend/src/modules/stylist/engine/outfit-draft.ts))
  es la misma definición de "look válido" mirada al revés —valida un conjunto que
  llega de fuera en vez de construirlo— y vive junto a la enumeración porque esa
  respuesta no puede tener dos versiones.
- **Bucle de aprendizaje** ([learning.ts](apps/backend/src/modules/stylist/engine/learning.ts)):
  la señal `PREFERENCE` del `engineScore`, que es lo que hace que rechazar un look
  cambie el siguiente. **Cada motivo de rechazo alimenta la señal que le
  corresponde**: `COLOR` penaliza volver a juntar esas familias cromáticas,
  `TOO_FORMAL`/`TOO_CASUAL` desplazan la formalidad objetivo, `UNCOMFORTABLE`
  penaliza esos cortes y `GARMENT_UNAVAILABLE` no enseña nada porque eso se arregla
  en el clóset. Un único "penaliza lo rechazado" haría que rechazar tres looks
  vaciara el armario. El historial entra como **dato** en `IEngineInput.feedback`
  —lo carga [style-history.service.ts](apps/backend/src/modules/stylist/style-history.service.ts),
  que comparten las dos capas— así que la Capa 1 sigue siendo código puro y sus
  tests se siguen escribiendo con objetos literales. Añadir la señal subió
  `engineVersion` a `engine-v2` y rebalanceó los pesos, que siguen sumando 1.
- **Estilista LLM** ([modules/stylist/llm/](apps/backend/src/modules/stylist/llm/)
  y [outfits.service.ts](apps/backend/src/modules/stylist/outfits.service.ts)): la
  Capa 2, encima de la 1 y no en su lugar. **Que no invente ropa no se le pide, se
  le impide, en tres capas**: las prendas viajan como ids cortos `g1..gN`, el JSON
  Schema declara `garmentId` como un enum construido en runtime con esos ids
  ([stylist.contract.ts](apps/backend/src/modules/stylist/llm/stylist.contract.ts)),
  y el servidor vuelve a resolver cada id contra el clóset en
  [outfit-assembly.ts](apps/backend/src/modules/stylist/llm/outfit-assembly.ts).
  Los ids son posicionales y sólo significan algo durante la petición.
  **La propiedad y la disponibilidad no se comprueban, se hacen imposibles**: el
  mapa de ids cortos se construye con las prendas elegibles que devolvió el motor,
  que sólo ve `GarmentsService.list(userId)`.
  **El modelo sólo devuelve texto.** El `slot` y el papel de cada prenda salen del
  catálogo, y la paleta, el rango térmico y el `styleTag` los calcula el motor: son
  datos exactos y pedírselos al modelo sólo abriría la puerta a un color que no
  está en la ropa. Es una desviación deliberada del esquema literal del plan y hace
  la garantía más fuerte, no más débil.
  Un look que no pasa la validación **se descarta con su motivo**, no se arregla, y
  los motivos viajan en la respuesta porque explican por qué salieron dos y no tres.
  Que un look sea inválido no tira los otros dos: por eso el chequeo de ids está en
  el ensamblado y no en el Zod de la respuesta.
  **Sin candidatos no se llama al modelo**: se devuelve el diagnóstico del motor y
  no se gasta nada. **Lo que se genera se guarda** —de ahí que no haya botón de
  "guardar": la llamada ya se pagó y tirarla obligaría a pagarla otra vez— junto con
  `generationSnapshot`, que es la entrada exacta que vio el modelo y lo único que
  permite comparar `promptVersion` v1 contra v2 sobre el mismo clóset.
  A diferencia del etiquetado, **cada pulsación es una llamada nueva**: el usuario
  pide looks distintos y devolverle el resultado anterior sería no hacer lo que
  pidió, así que la clave de idempotencia lleva el número de generaciones previas de
  esa misma petición. Lo que sí reutiliza la reserva es un reintento tras un fallo
  mientras queden intentos.
  El prompt está versionado
  ([stylist.prompt.v2.ts](apps/backend/src/modules/stylist/llm/stylist.prompt.v2.ts))
  y va en **bloques nombrados**; lo que el usuario no declaró no aparece, ni como
  "desconocido". Se le enseñan además las combinaciones que el motor ya validó, con
  su nota: no es una restricción, pero es lo que hace que casi siempre devuelva
  conjuntos completos a la primera.
  **La composición del look no se le pregunta al modelo, se le da resuelta.** El
  bloque `COMPOSICIÓN` dice si a esa temperatura toca capa —con el mismo umbral que
  usa el motor, `needsLayerAt`— y nombra los accesorios disponibles. Dejarlo
  implícito daba dos looks de la misma tanda, uno con chaqueta y otro sin ella, sin
  ningún criterio visible: si hace fresco no es una opinión de estilo.
  El enum lleva además **las capas y accesorios elegibles que ningún candidato
  usó**. El motor los deja fuera cuando la temperatura no los pide, pero la ocasión
  sí puede pedirlos, y fuera del enum el modelo no podría ni nombrarlos por mucho
  que el prompt se lo sugiera.
  `Outfit` no tiene columna de confianza a propósito: el modelo puede autoevaluarse
  en `qualityNote`, que es una frase, y un número sin calibración medida se leería
  como una probabilidad.
- **Análisis de vacíos** ([modules/wardrobe-gaps/](apps/backend/src/modules/wardrobe-gaps/)):
  la Fase 5, con la misma división de la 4 y por los mismos motivos.
  [coverage/](apps/backend/src/modules/wardrobe-gaps/coverage/) es **código puro**
  sobre los DTO de `shared-types` —como el motor— y se prueba con objetos
  literales ([coverage.fixtures.ts](apps/backend/src/modules/wardrobe-gaps/coverage/coverage.fixtures.ts)).
  La matriz se recorre por **escenarios** (`estilo × banda térmica`,
  [scenarios.ts](apps/backend/src/modules/wardrobe-gaps/coverage/scenarios.ts)): un
  hueco sólo es un hueco si impide vestirse para algo concreto. Los estilos salen
  del perfil y las dos bandas caen a los dos lados de `layeringTemperatureC`,
  porque es ahí donde aparece la brecha de abrigo.
  Lo que desbloquea una prenda se mide **metiéndola en el clóset y volviendo a
  pasar el motor** ([hypotheses.ts](apps/backend/src/modules/wardrobe-gaps/coverage/hypotheses.ts)),
  y se cuenta sobre el **núcleo** del look, no sobre el conjunto entero: un
  accesorio cambia todos los conjuntos sin crear ninguna combinación nueva, y
  contarlos diría que una bufanda desbloquea el clóset completo. Un abrigo, que
  tampoco crea combinaciones, se justifica por los puntos de nota que gana cuando
  la temperatura lo pide (`minScoreGainPoints`).
  **Un slot vacío se propone aunque medirlo dé cero**: con el clóset a medias
  ninguna prenda suelta desbloquea nada —hacen falta las tres a la vez— y la
  medida literal diría que no hay nada que comprar justo cuando falta todo.
  La cobertura usa `emptyFeedback` a propósito: es una propiedad del **clóset**, no
  del historial, y si entraran los rechazos la lista de la compra cambiaría al
  rechazar un look. Sólo cuenta lo `CONFIRMED`, así que confirmar prendas puede
  cerrar brechas sin comprar nada, y la nota lo dice cuando hay borradores.
  La Capa 2 ([llm/](apps/backend/src/modules/wardrobe-gaps/llm/)) **sólo ordena y
  redacta**: las candidatas viajan como ids cortos `h1..hN` declarados como enum en
  runtime y el servidor las vuelve a resolver; el slot, el tipo, el color, la
  formalidad y cuántos conjuntos desbloquea son medidas del motor. Usa el modelo del
  estilista (`OPENAI_STYLIST_MODEL`) y no una variable propia: es la misma tarea y
  otra variable sólo añadiría un sitio donde desincronizar el precio.
  **Sin candidatas no se llama al modelo** y **repetir el análisis sobre un clóset
  que no cambió no vuelve a pagarse**: cada brecha guarda la huella de su entrada en
  `analysisSnapshot` y la lista se reaplica. Es lo contrario que los looks —donde
  cada pulsación es una tanda nueva— porque una lista de la compra sobre el mismo
  clóset daría exactamente lo mismo.
  Un análisis nuevo reemplaza las brechas `OPEN` y **conserva** `PURCHASED` y
  `DISMISSED`: son decisiones del usuario, no resultados. Descartar una brecha
  además impide que se vuelva a proponer.
  `GET /api/wardrobe-gaps/coverage` expone la matriz y las candidatas sin llamar a
  nadie: es determinista y gratis.
- **Render visual del look** ([modules/stylist/render/](apps/backend/src/modules/stylist/render/)):
  la Fase 6. Cuelga del look y **no es una capa nueva**: la ficha determinista sigue
  siendo la fuente de verdad y el render se suma a ella.
  **Es aspiracional y se dice**: el modelo de imagen puede alterar color, textura,
  logos y ajuste, así que la imagen se etiqueta como generada por IA en la ficha y
  el aviso viaja también en la confirmación de costo. Un fallo o un rechazo del
  proveedor **no toca el look**: se cierra el job con su motivo y la ficha se queda
  como estaba.
  **El costo se confirma antes de gastarlo.** `GET /api/stylist/outfits/:id/render/quote`
  es determinista y gratis —modelo, calidad, tamaño, cuántas fotos viajan y la
  estimación— y es lo que el cliente enseña antes de que el usuario pulse. Por eso
  la calidad y el tamaño salen del entorno y no de la petición, y por eso no se
  ofrece `auto`: un tamaño que decide el proveedor no se puede cotizar.
  **Cada pulsación confirmada es un render nuevo**, como en el estilista y al
  contrario que la lista de la compra: pedir otra imagen del mismo look devuelve
  otra imagen, que es exactamente lo que se está pidiendo. Lo único que reutiliza la
  reserva es un reintento tras un fallo mientras queden intentos.
  **Que no invente ropa no se le pide, se le impide en parte**: las fotos que viajan
  son las de las prendas del look, y el prompt numera cada prenda con su foto
  ([render.prompt.v1.ts](apps/backend/src/modules/stylist/render/render.prompt.v1.ts)).
  Aquí la garantía es más débil que en las capas de texto —un modelo de imagen no
  tiene enum que lo ate— y de ahí que la ficha, y no el render, siga siendo la
  verdad. El prompt va versionado en `OutfitRender.promptVersion` y el texto exacto
  en `promptUsed`, que es lo único que explica por qué una imagen salió como salió.
  **Privacidad**: fotografiar tu propia ropa frente al espejo es normal, así que las
  fotos pueden llevar cara y cuerpo. El prompt prohíbe reproducir a esa persona y
  encuadra la figura con la cara fuera del plano; del perfil sólo entra lo declarado
  y **nunca el peso ni la complexión** (riesgos 7 y 8 del plan).
  `RenderService` sólo habla con `OpenAiClient.editImage`, que aísla endpoint,
  modelo y ajustes. El modelo por defecto es `gpt-image-2`. **Qué ajustes admite
  cada modelo va atado a su id y no al entorno**, igual que los precios:
  `input_fidelity` sólo viaja a los modelos que lo aceptan (`supportsInputFidelity`),
  porque `gpt-image-2` lo rechaza con un 400 y ya procesa toda entrada en alta
  fidelidad. Un ajuste que se omite cuesta calidad; uno que se manda de más tumba
  la llamada entera, así que la lista es de lo permitido y no de lo prohibido. Los precios de los
  modelos de imagen son **tres tarifas** —texto, imagen de entrada, imagen de
  salida— y viven en [openai-pricing.ts](apps/backend/src/modules/ai/openai-pricing.ts)
  con la misma regla que los de texto: un modelo sin tarifa se cobra a la más cara
  que conocemos, así que la reserva no se queda corta pero el costo registrado deja
  de ser cierto. La tarifa de imagen de entrada cacheada **no se aplica** a
  propósito: el `usage` de la API de imágenes no desglosa la caché, y cobrarlo todo
  a precio completo sobreestima antes que quedarse corto. Las cotas del estimador
  ([render.service.ts](apps/backend/src/modules/stylist/render/render.service.ts))
  quedan por encima de lo que cuenta `gpt-image-2` tanto de entrada como de salida,
  así que la confirmación de costo nunca promete menos de lo que va a cobrar.
  El binario se guarda en storage privado con key `userId/outfitId/<archivo>`, así
  que se lee por `/api/media` como cualquier foto. Borrar el look borra sus renders
  por cascada y **sus archivos a mano**: la cascada de la base no sabe nada del disco.
- **¿Me lo compro?** ([modules/purchase-advice/](apps/backend/src/modules/purchase-advice/)):
  la Fase 7. La Fase 5 dice qué falta en abstracto; ésta responde por la prenda
  concreta que estás mirando en la tienda.
  **La candidata _es_ un `Garment`** con `ownership = CONSIDERED`, un eje aparte
  de `GarmentStatus` —que habla de la disponibilidad de ropa que ya posees—. Eso
  regala la subida multipart, la miniatura, `GET /api/media` y el etiquetado por
  visión entero sin escribir nada: se usan `POST /api/garments/draft` (con
  `ownership`), `/photos` y `/tagging` tal como están.
  **Que no se cuele en un look no se comprueba, se hace imposible, en dos barreras
  independientes**: `GarmentsService.list` es el único sitio donde se lee el clóset
  y aplica `ownership: 'OWNED'` **por defecto en el servicio y no en el esquema
  Zod**, porque sus dos consumidores internos —el motor y la cobertura— lo llaman
  con `{}` y nunca pasan por el pipe; y además una candidata vive en `SUGGESTED`,
  que el motor no usa. Consecuencia asumida: **toda lectura nueva del clóset tiene
  que pasar por `GarmentsService.list`**. Por lo mismo `confirm()` del etiquetado
  rechaza una candidata: confirmarla la metería en los looks de ropa que no tienes,
  y para una prenda `CONSIDERED` el estado terminal de sus atributos es `SUGGESTED`
  —ahí la promueve `GarmentsService.update` cuando el usuario los revisa—.
  **La medición reutiliza el motor, no lo reimplementa.** `measureGarmentImpact`
  ([coverage/measure.ts](apps/backend/src/modules/wardrobe-gaps/coverage/measure.ts))
  se extrajo de las hipótesis de la Fase 5 y ahora lo comparten las dos: cuántos
  conjuntos abre una prenda no puede tener dos versiones. La candidata se clona
  como `CONFIRMED` y `ACTIVE` antes de medirla, por lo mismo que la prenda
  hipotética de la Fase 5 nace confirmada: sin eso las reglas duras la descartan y
  la medición daría siempre cero.
  **La candidata se le pide al motor explícitamente**, con el mismo `mustInclude`
  que usa quien quiere un look con una prenda concreta. La enumeración es codiciosa
  y recortada —el beam se queda con los mejores núcleos y `bestLayer` adjudica la
  única plaza de capa a un solo ganador—, así que sin pedirla una prenda que
  **empata** con otra que ya tienes no aparece jamás en la salida y se medía como
  si no combinara con nada: un clóset con once chaquetas daba "entra en 0
  conjuntos" para la duodécima. Pedirla sólo obliga a **considerarla**; la nota la
  sigue poniendo el motor y puede salir peor que la de hoy. Las reglas duras se
  aplican aparte y **sin** `mustInclude`, porque saltárselas colaría en la cuenta un
  color que el usuario evita o una prenda fuera de su rango térmico; y sólo cuentan
  los conjuntos que de verdad la llevan, porque cuando las reglas duras la
  descartan el escenario sigue produciendo los conjuntos de siempre.
  **Se miden y se muestran tres números, y responden a dos preguntas distintas.**
  "¿Me hace falta?" la contestan `unlockedOutfitsEstimate` —núcleos nuevos (base +
  calzado), así que una chaqueta mide 0 aunque sirva— y `outfitsUsingItEstimate`,
  los conjuntos en los que entra. "¿Queda bien con lo que ya tengo?" es otra
  pregunta y la contesta `bestOutfitScore`, la nota del mejor conjunto que la
  lleva, que sólo se puede leer al lado de `baselineBestScore`, la del mejor
  conjunto de hoy sin ella. Un abrigo número doce puede sacar la misma nota que tu
  mejor look y no desbloquear ni un conjunto: las dos cosas son ciertas, y contar
  sólo la primera lo convierte en un "no te sirve" que es falso.
  El medidor acepta `equivalentGarmentIds` y la Fase 7 le pasa los duplicados: un
  núcleo que ya podías armar **cambiando la prenda nueva por la que repite** no es
  un núcleo nuevo. Sin eso una segunda camisa blanca "desbloquearía" tantos
  conjuntos como la primera y comprar dos veces lo mismo saldría recomendado. La
  Fase 5 no pasa nada y su cálculo no cambia.
  **El veredicto lo decide el código, no el modelo** ([verdict.ts](apps/backend/src/modules/purchase-advice/verdict.ts)):
  reglas declarativas y la primera que acierta. El orden es la regla —lo que el
  usuario declaró manda sobre cualquier medida, y el duplicado va al final porque
  una prenda que abre conjuntos sigue valiendo aunque se parezca a otra—. El umbral
  es **el mismo `minScoreGainPoints`** de la Fase 5, importado y no copiado:
  duplicarlo dejaría que las dos fases discreparan sobre la misma chaqueta.
  La duplicación también se determina en código
  ([duplicates.ts](apps/backend/src/modules/purchase-advice/duplicates.ts)): mismo
  tipo, mismo slot, misma familia de color y misma banda de formalidad.
  **Los datos insuficientes no producen un falso rechazo**: `UNUSABLE_IMAGE`,
  `PENDING_ATTRIBUTES` y `NO_CONFIRMED_WARDROBE` salen como `CONDITIONAL` con su
  motivo, sin números inventados y **sin llamar al modelo**.
  **El modelo sólo redacta** ([llm/](apps/backend/src/modules/purchase-advice/llm/)):
  recibe el veredicto ya tomado y no tiene ningún campo donde cambiarlo. Las
  prendas con las que la empareja viajan como ids cortos `g1..gN` declarados como
  enum en runtime y el servidor las vuelve a resolver. Usa `OPENAI_STYLIST_MODEL`,
  como la Fase 5 y por lo mismo.
  **Y además no lo repite**, que es lo que arregló
  [advice.prompt.v2.ts](apps/backend/src/modules/purchase-advice/llm/advice.prompt.v2.ts):
  la v1 le pedía "el veredicto en una frase" cuando la pantalla ya lo enseña con su
  etiqueta y sus números, así que la llamada pagada producía una segunda versión de
  algo que el usuario ya estaba leyendo. Ahora su texto empieza donde el veredicto
  acaba —qué hace ahora con la prenda— y el prompt se lo prohíbe explícitamente.
  **La alternativa sale de sus brechas, no de la imaginación del modelo.** Lo único
  que un algoritmo no sabe decir es "ésta no, pero lo que te falta de verdad es
  aquello": las brechas `OPEN` ya estaban calculadas y ordenadas por la Fase 5 y
  sólo se usaban para un booleano (`matchedGapId`), y ahora viajan enteras como ids
  cortos `b1..bN` declarados como enum. La que la candidata ya cubre se queda fuera
  de la lista —proponerla sería proponer lo que tiene delante— y el modelo sólo
  puede rellenarla si el veredicto no es positivo.
  `PurchaseAdvice.alternativeLabel` **copia la descripción de la brecha al
  redactar** y por eso no es redundante con el id: un análisis nuevo de la Fase 5
  reemplaza las `OPEN`, así que el id puede dejar de existir mientras el texto que
  lo citaba sigue en pantalla. Por lo mismo la columna no lleva relación, igual que
  `matchedGapId`.
  **Viaja la portada de la prenda**, y sólo ella, con `detail: 'low'` atado a la
  tarea y no al entorno: aquí la foto sirve para que el texto no sea genérico, no
  para volver a catalogar —eso ya lo hizo el etiquetado por visión— y `high`
  costaría casi cinco veces más por la misma frase. Una prenda sin fotos o con el
  binario perdido se evalúa igual: se llama sin imagen y el prompt no la menciona.
  **La medición se ve gratis** (`GET /api/purchase-advice/measure/:garmentId`) y
  **re-evaluar sobre una prenda y un clóset que no cambiaron no vuelve a pagarse**:
  `analysisSnapshot` guarda la huella de los atributos corregidos, las fotos,
  `taggingVersion`, el clóset `OWNED`, el perfil, las brechas **y la versión del
  prompt** —sin esta última, subirla dejaría a `_tryReuse` devolviendo para siempre
  el texto de la versión anterior—. Es la regla de la Fase 5 y no la de los looks,
  porque la misma prenda sobre el mismo clóset da exactamente la misma respuesta.
  Todo se direcciona **por la prenda** y no por el veredicto: `PurchaseAdvice` es
  único por `garmentId`, así que el id del veredicto no hace falta para nada.
  "Ya la compré" es `POST /api/purchase-advice/:garmentId/purchase` y hace las
  cuatro cosas **en una transacción** —`ownership = OWNED`, `status = ACTIVE`,
  `taggingStatus = CONFIRMED` y el veredicto a `PURCHASED`—, porque son la misma
  decisión: si la prenda entra y el veredicto no se cierra, la lista miente.
  El listado devuelve las candidatas sin decidir **y las ya compradas**: dejaron de
  ser candidatas, pero la decisión es historial y se consulta días después. Ese
  historial se cierra con `DELETE /api/purchase-advice/:garmentId`, que **borra el
  veredicto y no la prenda**: una vez comprada vive en el clóset, y sacarla de esta
  pantalla no puede significar borrarla de allí.
- **IA** ([modules/ai/](apps/backend/src/modules/ai/)): toda llamada a un proveedor
  pasa por `AiJobsService.reserve()`, que dentro de una transacción `Serializable`
  comprueba el presupuesto mensual y crea el `AiJob` con su `idempotencyKey`
  (única por usuario). El presupuesto se calcula **sobre `AiJob`** — estimado de
  lo que está en vuelo más real de lo ya terminado — y no sobre `AiUsageLog`, para
  no contar dos veces la misma llamada; `AiUsageLog` es el detalle de auditoría
  (modelo, tokens, latencia, error) y se expone en `GET /api/ai/usage`. Los
  reintentos se acotan con `AI_JOB_MAX_ATTEMPTS` y el timeout del proveedor con
  `AI_REQUEST_TIMEOUT_MS` —las llamadas de imagen usan el suyo,
  `AI_IMAGE_REQUEST_TIMEOUT_MS`, porque generar una imagen tarda mucho más que
  devolver JSON y con 60 s un render de calidad alta se cortaría casi siempre—; un
  fallo marcado como no reintentable (una negativa del modelo) agota el job de golpe
  en vez de ofrecer tres intentos estériles.
  **El único que habla con OpenAI es [OpenAiClient](apps/backend/src/modules/ai/openai.client.ts)**
  (Responses API + Structured Outputs). Devuelve el texto crudo y clasifica el
  error en `AiProviderError` con su `code` y si es reintentable; validar la salida
  es cosa de quien la pidió. El mensaje del `code` es genérico porque lo lee el
  usuario, así que el motivo técnico —estado HTTP, `code`, `param` y `request_id`—
  va aparte en `detail` y se registra al clasificar: sin esa línea, un fallo del
  proveedor no se puede diagnosticar desde el log. `maxRetries: 0` a propósito: los intentos los cuenta
  `AiJob` y dos contadores harían imposible saber cuántas llamadas se pagaron.
  Sin `OPENAI_API_KEY` el backend arranca igual y los endpoints de IA responden
  503 con un mensaje claro. Los precios por modelo viven en
  [openai-pricing.ts](apps/backend/src/modules/ai/openai-pricing.ts) y no en el
  entorno: van atados al modelo, y cambiar `OPENAI_VISION_MODEL` sin tocar esa
  tabla dejaría el costo mal calculado en silencio (un modelo desconocido se cobra
  a la tarifa más cara que conocemos).
- **Etiquetado por visión** ([modules/garments/vision/](apps/backend/src/modules/garments/vision/)
  y [garment-tagging.service.ts](apps/backend/src/modules/garments/garment-tagging.service.ts)):
  el enum de tipos de prenda del JSON Schema **se construye en runtime con el
  catálogo real**, y aun así la respuesta se revalida con Zod contra ese mismo
  catálogo: `strict: true` reduce el riesgo, no lo elimina. El `slot` lo pone el
  tipo del catálogo, nunca el modelo. El prompt está versionado
  ([vision.prompt.v3.ts](apps/backend/src/modules/garments/vision/vision.prompt.v3.ts))
  y su versión se guarda en `Garment.taggingVersion` para poder comparar versiones
  sobre las mismas fotos; si cambia el prompt **o la forma de la entrada**, sube
  `visionTaggingVersion` o el campo miente.
  **Lo que el modelo tiene que devolver de forma inequívoca se exige en el JSON
  Schema, no en la prosa del prompt.** `seasons` lleva `minItems: 1` porque pedir
  "vacío si sirve en cualquier época" era ambiguo —una lista vacía y las cuatro
  temporadas son datos distintos— y salía uno u otro según la tirada. Aun así, si
  vuelve vacía el servidor usa las `typicalSeasons` del tipo del catálogo, que es
  el mismo valor que aplica el alta manual: las dos vías coinciden.
  Se mandan **varias fotos de la misma prenda**, la portada primero y hasta
  `maxVisionImages` (4, en `shared-types` y no en el entorno porque el cliente
  necesita el mismo número para decir cuántas va a analizar). El prompt declara
  explícitamente que todas son la misma prenda y que manda la primera: sin eso un
  plano de detalle se lee como otra prenda, y una foto de cuerpo entero como un
  conjunto. La clave de idempotencia lleva una huella del conjunto de fotos, así
  que subir o borrar una abre un job nuevo.
  Lo que devuelve es un **borrador**: la prenda queda `SUGGESTED` y el motor sólo
  usa `CONFIRMED`, así que nada entra en un look sin que el usuario lo revise.
  **`Garment.manualFields` es lo que impide que un reprocesamiento pise una
  corrección**; se calcula comparando contra lo guardado y no contra las claves que
  manda el cliente, porque el formulario reenvía la prenda entera al guardar. Sólo
  un `force` explícito lo sobrescribe, y sólo `force` vuelve a pagar: sin él, un
  borrador de la versión vigente se reaplica gratis y una prenda ya confirmada que
  pasó por la IA no se toca (se comprueba por `taggingVersion` no nula, no por
  versión concreta, para que subir la versión del prompt no convierta un
  reetiquetado accidental en una sobrescritura).
  `brandGuess` nunca toca `brand`, y `attributeConfidence` es una autoevaluación
  del modelo (`HIGH`/`MEDIUM`/`LOW`) que sólo marca qué revisar: no se muestra como
  porcentaje porque no es una probabilidad calibrada.
  El job corre **dentro de la petición HTTP**: no hay cola, la llamada son unos
  segundos y `AI_REQUEST_TIMEOUT_MS` ya la acota.
  Privacidad: el prompt prohíbe describir a la persona de la foto y el esquema no
  tiene ningún campo donde hacerlo; sólo `personVisible`, que dispara un aviso en
  la UI. Sigue en pie el riesgo 8 del plan: nada de inferir género, peso o
  complexión desde una imagen.
  **`personVisible` y `usableForTagging` son señales distintas y no hay que
  confundirlas.** La primera es privacidad y no invalida nada: una foto en el
  espejo con la prenda puesta se cataloga igual, y bloquear por ella rompería la
  forma más natural de fotografiar tu propia ropa desde el móvil. La segunda es la
  salida honesta del modelo cuando de las fotos no sale ninguna prenda —un
  retrato, algo que no es ropa—; entonces **no se escribe ningún atributo**, la
  prenda queda `FAILED` con el motivo y el formulario del cliente se vacía, lo que
  deja el botón de guardar deshabilitado por invalidez y no por un bloqueo aparte.
  Una prenda ya `CONFIRMED` conserva su estado y sus datos si un reetiquetado
  vuelve con la negativa: un fallo no puede sacarla de los looks que ya generaba.

### Frontend

- Arranca con `provideZonelessChangeDetection()`: sin Zone.js. Signals y
  `ChangeDetectionStrategy.OnPush` en todos lados.
- Componentes standalone y rutas perezosas con `loadComponent`
  ([app.routes.ts](apps/frontend/src/app/app.routes.ts)): `login` y `registro`
  detrás de `guestGuard`, y el resto bajo el shell detrás de `authGuard`.
- **Estado**: stores inyectables con signals, no NgRx. Signal privado `_x` expuesto
  con `.asReadonly()` / `computed()`. Lo que deba sobrevivir a una recarga va a
  `localStorage`/`sessionStorage` bajo una clave `closetai:*`, siempre en try/catch.
- **Todo HTTP pasa por [ApiClient](apps/frontend/src/app/core/http/api.client.ts)**,
  nunca `HttpClient` directo. Prefija `/api/`, pone `withCredentials` y centraliza
  el mensaje de error (`ApiClient.messageFromError`). Las cookies van solas: no
  añadas cabeceras Authorization.
- **Inactividad** ([session-idle.service.ts](apps/frontend/src/app/core/auth/session-idle.service.ts)):
  se instancia en el arranque desde [app.ts](apps/frontend/src/app/app.ts) y vigila
  mientras haya sesión. Al vencer la ventana hace `logout()`, avisa y lleva al login;
  mientras haya actividad refresca los tokens al 40 % de la ventana para deslizarla
  antes de que muera el access token. **Es la parte cómoda, no la garantía**: la
  garantía son los TTL del backend.
  Las marcas viven en `localStorage` ([session-activity.ts](apps/frontend/src/app/core/auth/session-activity.ts))
  y no en el servicio, así que las pestañas comparten una sola ventana y el
  interceptor puede anotar su refresh sin depender del store de sesión, igual que
  `session-flag`. **Actividad y refresh son marcas distintas**: si un refresh contara
  como actividad, cualquier petición de fondo dejaría la sesión viva para siempre.
  Sólo la pestaña con el foco recibe eventos de actividad, y por eso no hay dos
  rotaciones compitiendo — que se detectarían como reuso y revocarían la familia.
  Volver a una pestaña **comprueba** la ventana, no la renueva: si no, dejar la app
  abierta en segundo plano media hora la mantendría viva.
- **Nada de `window.alert` / `window.confirm`.** Usa `NotificationService`
  (toasts) y `await ConfirmService.ask(...)`.
- **Responsive**: [LayoutService](apps/frontend/src/app/core/layout/layout.service.ts)
  expone el breakpoint como signal (móvil <640, tablet 640–1023, escritorio ≥1024)
  leyendo `matchMedia`. Úsalo **sólo** cuando cambie la estructura (barra fija vs.
  cajón vs. navegación inferior); lo puramente visual se resuelve con CSS. Nada de
  listeners de `window.resize`.
- **Tema y color**: `ThemeService` alterna `.dark` en `<html>`. Los colores se
  declaran una vez en [styles/_colors.scss](apps/frontend/src/styles/_colors.scss)
  (`--color-*` como triples "R G B" para Tailwind vía `@theme`, y `--qp-*` en hex
  para las superficies). **Nunca hardcodees un hex en un componente**: añade el
  token en `:root` y en `.dark`.
- **UI reutilizable** en [shared/ui/](apps/frontend/src/app/shared/ui/): `dialog`,
  `field`, `submit-button`, `skeleton`, `empty-state`, `error-banner`,
  `image-viewer`, `brand-mark`, `chip-group`, `page-placeholder`. Prefijo de
  selector `closet-`; las páginas y los componentes de `core/` usan `app-`.
- **Formularios reactivos con campos numéricos**: un `input[type=number]` usa
  `NumberValueAccessor`, así que el control guarda un **número** al teclear y
  `null` al vaciarse, no la cadena que se declaró al construir el grupo. Decláralo
  como `string | number | null` y normalízalo con un helper; asumir `string` y
  llamar a `.trim()` revienta el guardado entero.
- El clóset se descarga **completo** una vez ([closet.store.ts](apps/frontend/src/app/features/closet/closet.store.ts))
  y se filtra en memoria con código puro y testeable
  ([closet-filters.ts](apps/frontend/src/app/features/closet/closet-filters.ts)):
  un armario personal son decenas de prendas y así cambiar de filtro no cuesta
  una petición.
- La **ficha de look** ([features/looks/](apps/frontend/src/app/features/looks/))
  es la especificación de [examplepng.png](examplepng.png) armada con prendas
  reales. El panel de generación es **un solo componente** montado en la
  columna fija en escritorio y en un diálogo en el resto; las secciones de la
  ficha se pliegan en móvil vía `LookSectionComponent`, que renderiza siempre un
  `<details>` y desactiva el plegado cuando no toca —dos `<ng-content>` en ramas
  distintas de un `@if` no proyectarían el contenido dos veces.
  **`LookCardComponent` sirve para las dos capas y eso no es casualidad**: un
  `Outfit` es un `Look` más narrativa, así que la ficha no cambió de forma al llegar
  la Fase 4. Sin la entrada `outfit` muestra la ficha determinista y gratuita; con
  ella añade la descripción, las marcas de referencia, la nota de calidad y las
  acciones —guardar, me lo puse, valorar, rechazar con motivo, borrar—, que son las
  que alimentan el bucle de aprendizaje. Las marcas se etiquetan como referencias de
  estilo, nunca como precio ni disponibilidad.
  El **render visual** vive en la columna de lo visual, encima de las fotos reales y
  no en su lugar: la referencia de verdad tiene que quedar a la vista al lado de la
  imagen generada. Cada render lleva su pie "Generado por IA" con el modelo, y el
  botón pregunta el costo al servidor y lo enseña en la confirmación antes de gastar
  nada. Un render que no gusta se borra sin tocar el look. El visor a pantalla
  completa nunca mezcla las dos listas —fotos reales y renders van por separado—
  porque confundir una prenda con una imagen generada es justo lo que la ficha evita.
  **Las acciones de la ficha no viven en la página** sino en
  [outfit-list.component.ts](apps/frontend/src/app/features/looks/outfit-list.component.ts),
  que recibe el store por entrada (`IOutfitActionsStore`): hay dos listas que enseñan
  la misma ficha y la accionan igual, y duplicar sus diálogos y su estado dejaría dos
  sitios donde arreglar el mismo botón.
  El interruptor del estilista vive en el panel y la página decide a qué capa
  llamar; los looks del motor son gratis y no se pueden valorar. La ocasión sólo la
  entiende la Capa 2, así que al pedirle looks al motor se listan los campos que sí
  aplica en vez de inventar un filtro.
  **La página enseña una tanda, no un historial.** Generar sustituye lo anterior y
  entrar la deja en blanco (`reset()` en los dos stores, que son singletons de raíz).
  Si pides un look ves un look: una lista que fuera creciendo haría que "cuántos
  looks: 1" enseñara cinco. Que la pantalla se vacíe no borra nada —el servidor sigue
  guardando cada `Outfit` con su snapshot— y por eso rechazar un look sigue cambiando
  la siguiente tanda aunque el rechazado ya no esté a la vista.
  Por lo mismo, el tope de la petición se cuenta en
  [outfit-assembly.ts](apps/backend/src/modules/stylist/llm/outfit-assembly.ts) sobre
  los looks **aceptados** y no sobre los que llegaron: recortar antes de validar
  dejaba la tanda vacía si el primero era inválido, que con un solo look pedido es
  pagar la llamada para no recibir nada.
- La página **Guardados** ([saved-looks.page.ts](apps/frontend/src/app/features/looks/saved-looks.page.ts))
  es la otra mitad de esa decisión. Un look guardado **sí** es historial —se consulta
  días después y desde otra pantalla—, así que se recupera al entrar, como "Qué
  comprar" y al revés que Looks. Enseña la ficha entera, renders incluidos, porque es
  el mismo `LookCardComponent`: no hay una versión reducida del look que mantener.
  **El filtro lo aplica el servidor** (`GET /api/stylist/outfits?favorite=true`) y no
  la lista: el listado devuelve como mucho los treinta más recientes, así que filtrar
  en el cliente haría desaparecer un guardado en cuanto se generaran treinta looks
  nuevos. Quitar un look de guardados lo saca de la lista en el momento —es la única
  invariante que la lista sostiene— y eso no lo borra ni pierde lo que valoraste.
- La página **Qué comprar** ([features/shopping/](apps/frontend/src/app/features/shopping/))
  enseña dos cosas distintas y las separa: la **cobertura**, que es gratis y se
  recarga en cada visita porque depende del estado real del clóset, y las
  **brechas**, que sí son un historial —una lista de la compra se consulta días
  después y en otro sitio— y por eso se recuperan al entrar, al revés que los looks.
  "Ya la compré" marca la brecha y abre el alta de prenda **precargada** con el
  `prefill` de `GarmentDialogComponent`: la brecha ya describe la prenda, y hacer que
  el usuario la teclee sería pedirle que copie lo que la app acaba de decirle. Al
  cerrar el diálogo se recalcula la cobertura, que acaba de dejar de ser cierta.
- La página **Qué comprar** tiene dos pestañas y son **dos preguntas distintas**:
  "Qué me falta" es la Fase 5 y "¿Me lo compro?" la 7. La pestaña viaja en `?tab=`
  ([shopping.types.ts](apps/frontend/src/app/features/shopping/shopping.types.ts))
  para poder abrir la segunda de un enlace desde el celular, que es donde se usa:
  de pie en la tienda. No hay entrada nueva de menú.
  La pestaña de evaluar ([purchase-tab.component.ts](apps/frontend/src/app/features/shopping/purchase-tab.component.ts))
  es historial y se recupera al entrar, como las brechas y al revés que los looks.
  La ficha separa lo gratis de lo pagado: "Medir mi clóset · gratis" enseña
  veredicto y números sin llamar a nadie, y sólo "Pedir el veredicto · IA" cuesta.
  Una prenda ya comprada conserva su ficha pero **no ofrece borrarla ni editarla
  ahí**: vive en el clóset y se toca desde el clóset. Lo que sí ofrece es quitarla
  de esta lista, que borra el veredicto y deja la prenda intacta — son dos cosas
  distintas y el diálogo de confirmación lo dice.
  **La ficha dice qué está esperando, no sólo que espera**: el store anota la
  acción en vuelo (`PurchaseAction`) y no sólo la prenda, así que medir enseña
  "midiendo tu clóset" y pedir el veredicto enseña que la IA puede tardar unos
  segundos. Un botón deshabilitado sin más no distingue lo instantáneo y gratis de
  lo lento y pagado.
  El bloque **"En su lugar"** vive dentro del texto de la IA y no junto a los
  números, porque eso es exactamente lo que es: lo redactó el modelo, y el pie de
  procedencia que ya estaba ahí lo cubre. Su "Ver en mi lista" **no es un
  `routerLink`**: la página lee `?tab=` del snapshot al entrar, así que un enlace
  cambiaría la URL sin cambiar de pestaña. Sube como output de la ficha a la
  pestaña y de ahí a la página, que llama a `selectTab`. Sólo se ofrece si la
  brecha sigue viva; si desapareció, el texto se sostiene igual sobre
  `alternativeLabel`.
  **El diálogo de prenda es el mismo** y su entrada `mode` dice qué significa
  guardar: `CLOSET` confirma, `CANDIDATE` revisa los atributos sin confirmar —eso la
  metería en los looks— y `PURCHASE` ejecuta la transición de compra. Reescribir un
  formulario de prenda para la Fase 7 habría dejado dos sitios donde arreglar el
  mismo campo. En modo candidata avisa además de que una foto de tienda degrada el
  color y el material: el veredicto sale de esos atributos.
- Un `<select>` cuyas opciones salen de un `@for` **no** puede fijar el valor con
  `[value]` en el select: Angular lo escribe antes de que existan las opciones y
  se queda vacío. Se marca `[selected]` en la opción.
- La subida **no muestra porcentaje**: `provideHttpClient(withFetch())` no emite
  eventos de progreso de subida. El diálogo informa con el estado de cada foto y
  un contador ("subiendo 2 de 5"), que es información real y no una barra
  inventada. El cliente comprime antes de subir con canvas
  ([image-compression.ts](apps/frontend/src/app/features/closet/image-compression.ts)),
  respetando la orientación EXIF y cayendo al archivo original si algo falla.
- **Una foto no tiene por qué estar en el disco**: la rejilla del clóset, el
  diálogo de prenda y la pestaña "¿Me lo compro?" aceptan arrastre y pegado
  ([image-drop.ts](apps/frontend/src/app/features/closet/image-drop.ts)), que es
  cómo llega una captura o una imagen copiada de la web de una tienda. El filtro
  mira el tipo MIME y **nunca la extensión**: una captura pegada llega como
  `image.png` sin haber existido como archivo. Lo que **no** entra es arrastrar
  la imagen desde otra página web: eso viaja como URL y descargarla chocaría con
  el `connect-src 'self'` del CSP.
  El diálogo tiene su propia zona de suelte y se renderiza dentro de sus dos
  contenedores, así que la página y la pestaña **cortan** sus manejadores mientras
  está abierto: sin eso una foto soltada sobre él se añadiría y además reabriría
  el alta en blanco. El pegado sólo se intercepta cuando el portapapeles trae
  imágenes, para que pegar texto en un campo siga funcionando.
- El **etiquetado por IA** vive en el mismo diálogo de prenda
  ([garment-tagging-panel.component.ts](apps/frontend/src/app/features/closet/garment-tagging-panel.component.ts)).
  Por el mismo motivo tampoco hay barra de progreso: dice en qué paso va
  ("subiendo 1 de 2", "analizando la foto") porque son los dos pasos reales.
  El panel decide solo si la siguiente pulsación es un reintento gratis sobre el
  job ya reservado o una llamada nueva que se cobra, y lo dice antes de pulsar.
  También dice cuántas fotos van a entrar y avisa cuando sobran, porque quien tiene
  seis fotos necesita saber que sólo cuentan cuatro y elegir bien la portada.
  Etiquetar una prenda que aún no existe crea primero un **borrador**
  (`POST /api/garments/draft`, estado `PENDING`) al que colgarle la foto; si se
  cierra el diálogo sin confirmarlo se pregunta antes de descartarlo, porque
  dejarlo suelto ensuciaría el clóset y borrarlo en silencio tiraría un etiquetado
  que quizá ya se pagó. Una prenda sin un etiquetado que haya salido bien
  —`PENDING` o `FAILED`— no enseña tipo ni color en la rejilla: los que tiene son
  de relleno y mostrarlos los haría pasar por datos.
- `node-forge` se importa de forma **perezosa** en `PasswordCryptoService`: pesa
  ~250 kB y sólo hace falta en login/registro. No lo conviertas en import estático
  o vuelve al bundle inicial.
- [index.html](apps/frontend/src/index.html) lleva un CSP estricto con
  `connect-src 'self'`, por lo que **SPA y API deben servirse desde el mismo
  origen en producción**. `style-src` necesita `'unsafe-inline'` porque Angular
  inyecta los estilos de componente en línea.

## Convenciones de código

Aplican las reglas del CLAUDE.md personal (global) y, sobre ellas, estas del
proyecto. Ante conflicto, mandan las globales.

- **Nunca `any`.** `unknown` + narrowing. TS estricto con `noUncheckedIndexedAccess`.
- Zod de punta a punta vía `shared-types`.
- Miembros privados con prefijo `_` (incluidos los inyectados por constructor) y
  JSDoc en español en clases y métodos.
- Interfaces con prefijo `I` y campos en **inglés**; comentarios y textos de UI en
  **español**. Los tipos inferidos de Zod (`z.infer`) no llevan prefijo.
- Constantes en camelCase, nunca SCREAMING_SNAKE_CASE. Sin números mágicos ni
  literales repetidos más de tres veces.
- Nombres descriptivos: nada de `e`, `r`, `v`, `tmp`. Los errores capturados
  siempre se llaman `error`.
- Logs con formato `log.<nivel>('Clase > método - descripción', error?.message)`.
  En el backend se usa el `Logger` de Nest con ese mismo formato.
- `data-test` en todo componente nuevo, con formato `[tipo]-[identificador]-[contenedor]`
  (`action-login-page`, `input-email-modal`, `div-closet-page`).
- Sin `::ng-deep`, sin modificadores BEM `--`, ceros CSS sin unidad.

## Trampas conocidas

- **Fastify está fijado a `4.28.1` exacta** en el backend y con `overrides` en
  [pnpm-workspace.yaml](pnpm-workspace.yaml). `@nestjs/platform-fastify` fija esa
  versión y, con dos copias instaladas, la ampliación de tipos de `@fastify/cookie`
  deja de aplicar al adaptador y `app.register(...)` no compila. Si aparece un
  error de tipos raro en `main.ts`, comprueba `pnpm why fastify`.
- Si editas `shared-types` con `pnpm dev` ya corriendo, Vite sigue sirviendo el
  bundle preoptimizado de antes y verás errores raros del tipo "cannot read
  properties of undefined" sobre un export nuevo. Recompila el paquete y borra
  `apps/frontend/.angular/cache` antes de reiniciar. **No siempre falla con una
  excepción**: un `export const` nuevo llega como `undefined` y se cuela hasta la
  pantalla como un `NaN` en cualquier cuenta que lo use. Si ves un dato imposible
  y no un error, comprueba primero
  `apps/frontend/.angular/cache/*/frontend/vite/deps/@closetai_shared-types.js`.
- Windows sin Docker: PostgreSQL corre nativo. `DATABASE_URL` sale de
  `apps/backend/.env` (gitignored); la plantilla es
  [apps/backend/.env.example](apps/backend/.env.example).
- Prisma usa `binaryTargets = ["native", "windows"]`. Campos en camelCase en TS y
  snake_case en la base vía `@map`/`@@map`.
- Un script suelto con `tsx` **no puede levantar el `AppModule`**: `tsx` compila
  con esbuild, que no implementa `emitDecoratorMetadata`, así que Nest no ve los
  tipos del constructor y las dependencias llegan `undefined`. Para probar el
  arranque, `pnpm --filter @closetai/backend build` y `node dist/main.js`.
- El aviso "Module '@closetai/shared-types' … is not ESM" al construir el frontend
  es esperado: el paquete compila a CommonJS porque el backend también lo consume.
