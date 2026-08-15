# closetAI — Clóset inteligente con IA

> **Seguimiento.** Cada fase lleva una casilla de estado que se marca al cumplir su verificación, así el avance queda en el repo y no depende de recordar en qué punto quedamos.

| Fase                              | Estado |
| --------------------------------- | ------ |
| 0 — Fundaciones                   | ☑      |
| 1 — Perfil y clóset               | ☑      |
| 2 — Motor y ficha de look         | ☑      |
| 3 — Etiquetado por visión         | ☐      |
| 4 — Estilista LLM y ficha         | ☐      |
| 5 — Análisis de vacíos y feedback | ☐      |
| 6 — Render visual con IA          | ☐      |
| 7 — PWA y despliegue              | ☐      |

> **Alcance del MVP.** La primera versión útil termina en la Fase 4: perfil, prendas, motor determinista, etiquetado automático, looks usando exclusivamente prendas existentes y feedback. El análisis de compras y el render son extensiones posteriores; no bloquean la validación del producto principal.

## Contexto

`closetAI/` arranca vacío salvo [examplepng.png](examplepng.png), que es la especificación visual del producto: se sube la foto de una prenda, se pide "1 opción minimalista y otra smart casual", y la salida es una ficha tipo lookbook con **PRENDAS** (lista con marca), **PALETA DE COLORES**, **MARCAS DE REFERENCIA** (lujo / asequible), **CUÁNDO USARLO**, **NOTAS DE ESTILO** y un bloque **ALTURA / AJUSTE RECOMENDADO**.

La diferencia con ese ejemplo de ChatGPT es la que da valor real al proyecto: ahí la IA **inventó** la sudadera Uniqlo, el jean Levi's y los sneakers Common Projects. Aquí los looks deben armarse **exclusivamente con prendas que están en la base de datos**, y las sugerencias de compra deben ser una salida aparte y explícita ("te falta una chaqueta de cuero negra"). Eso, más el perfil físico (género, altura en cm, complexión, medidas) y el estilo editable, es el producto.

Resultado esperado: una app web que funciona igual de bien en el escritorio y en el celular, donde fotografías una prenda, la IA la cataloga sola, y puedes pedir looks con lo que ya tienes más un análisis de qué te falta comprar.

## Decisiones tomadas

| Tema             | Decisión                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Plataforma       | **Web responsive**, un solo código para escritorio y móvil, instalable como PWA en ambos.                                              |
| Render del look  | **Ambos**: ficha determinista siempre (gratis, con las fotos reales) + botón opcional de generación de imagen por look.                |
| Recomendación    | Motor híbrido: filtrado determinista en código + LLM como estilista/curador. Detallado abajo.                                          |
| Perfil corporal  | Género opcional; las medidas, preferencias de ajuste y comodidad son la fuente principal. El género nunca excluye prendas por sí solo. |
| Compras          | Fase 5 solo describe la prenda faltante con marcas de referencia. Sin links ni scraping.                                               |
| Usuarios         | Multiusuario con login (auth portada de `journal`).                                                                                    |
| Procesamiento IA | Visión, estilismo y render se modelan como `AiJob` asíncronos, con estado, reintentos, idempotencia y costo.                           |
| Privacidad       | Imágenes privadas, sin publicación estática directa; acceso mediante endpoints autenticados o URLs firmadas.                           |

## Arquitectura

Monorepo pnpm + Turborepo, clonando la estructura de `journal` (que ya está en producción) para reutilizar código en vez de reinventarlo:

```
closetAI/
├─ apps/
│  ├─ backend/          NestJS + adaptador Fastify, Prisma + PostgreSQL 16
│  └─ frontend/         Angular 21 standalone zoneless + Tailwind 4 + PWA
├─ packages/
│  ├─ shared-types/     esquemas Zod + tipos inferidos, compartidos front/back
│  └─ config/           tsconfig-base.json + prettier-base.json
└─ storage/             uploads locales de desarrollo (gitignored)
```

Se mantienen las mismas versiones mayores que `journal` (Nest sobre Fastify, Angular 21 zoneless, Prisma 6, Zod 3, sharp 0.33) para reutilizar patrones probados. El código de `journal` se adapta y se revisa; no se asume que sea copy-paste literal, especialmente en auth, permisos, cookies y configuración.

### Código reutilizable identificado

| Qué                                                                                                                            | De dónde                                                       | Uso                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth completa (login RSA, JWT en cookies httpOnly, rotación de refresh, `JwtAuthGuard` global + `@Public()`, `@CurrentUser()`) | `journal/apps/backend/src/modules/auth/`                       | Port directo                                                                                                                                                                  |
| `StorageDriver` abstracto + `LocalDiskDriver` (keys `userId/entityId/<file>`)                                                  | `journal/apps/backend/src/storage/`                            | Adaptar para desarrollo; producción usa storage privado compatible con S3 y URLs firmadas                                                                                     |
| `ZodValidationPipe`, `AllExceptionsFilter`, `request-id.ts`, `config/env.validation.ts`                                        | `journal/apps/backend/src/common/` y `src/config/`             | Port directo                                                                                                                                                                  |
| `ApiClient`, `auth-refresh.interceptor`, `NotificationService`, `ConfirmService`, `ThemeService`                               | `journal/apps/frontend/src/app/core/`                          | Port directo                                                                                                                                                                  |
| `shared/ui/` (`dialog`, `field`, `submit-button`, `skeleton`, `empty-state`, `error-banner`, `image-viewer`)                   | `journal/apps/frontend/src/app/shared/ui/`                     | Port directo                                                                                                                                                                  |
| Cliente OpenAI + `images.edit` con MIME real y `toFile`                                                                        | `imageOpen/server/src/services/openai.ts` y `routes/images.ts` | Base de `RenderService` (Fase 6). El adaptador debe aislar endpoint, modelo y esquema para poder migrar de Chat Completions a Responses API sin tocar los módulos de dominio. |
| Patrón de modelo configurable por env                                                                                          | `imageOpen/server/src/config.ts`                               | `OPENAI_VISION_MODEL`, `OPENAI_STYLIST_MODEL`, `OPENAI_IMAGE_MODEL`                                                                                                           |

## Web responsive: escritorio y móvil

Un solo código Angular con layouts adaptativos. No hay app aparte ni detección por user-agent.

| Ancho      | Navegación            | Clóset            | Detalle de look                                     | Generar look                                 |
| ---------- | --------------------- | ----------------- | --------------------------------------------------- | -------------------------------------------- |
| ≥1024px    | Sidebar fija          | Grid 4–6 columnas | Dos columnas: fotos/render izquierda, ficha derecha | Panel lateral con todos los filtros visibles |
| 640–1023px | Sidebar colapsable    | Grid 3 columnas   | Una columna, ficha completa                         | Diálogo                                      |
| <640px     | Bottom nav de 4 items | Grid 2 columnas   | Una columna, secciones colapsables                  | Bottom sheet                                 |

- **Subida de fotos en ambos escenarios:** el mismo `<input type="file" accept="image/*" multiple>` puede sugerir la cámara en móvil con `capture="environment"` y abre el explorador en escritorio. `capture` es una sugerencia del navegador, no una garantía. En escritorio se añade drag & drop sobre el grid y pegar desde el portapapeles (`paste` event). El cliente comprime antes de subir, muestra progreso/reintento y el servidor valida MIME real, tamaño, dimensiones y elimina EXIF.
- Breakpoints como tokens de Tailwind 4. Cuando el layout debe cambiar de **estructura** y no solo de estilo, un `LayoutService` con signals derivados de `matchMedia` (zoneless-safe, sin `window.resize` listeners sueltos).
- Atajos de teclado en escritorio para lo repetitivo: subir prenda, generar look, marcar favorito.
- PWA instalable en móvil y en Chrome de escritorio.
- La PWA no promete funcionamiento offline para operaciones de IA: solo shell, prendas ya cargadas y formularios pueden funcionar sin conexión.
- **Cada fase se verifica en los dos anchos**, no solo en uno.

## Modelo de datos (Prisma)

```
User                 auth (de journal)

StyleProfile         1:1 con User
                     gender? (MALE | FEMALE | NON_BINARY | UNSPECIFIED)
                     heightCm?, weightKg?, bodyShape?, shoeSize?, skinTone?, hairColor?
                     measurements (Json versionado, unidades explícitas, opcional)
                     presentationPreferences[], styleArchetypes[], preferredFits[]
                     avoidedColors[], avoidedGarmentTypes[]
                     budgetTier, country, currency, city, climate, notes

GarmentType          catálogo seeded — slot, nombre, appliesTo (MALE | FEMALE | BOTH),
                     defaultFormality, typicalSeasons[], defaultWeatherMinC?, defaultWeatherMaxC?
                     `appliesTo` es una ayuda de catálogo, nunca una exclusión automática.

Garment              userId, name, slot, garmentTypeId, primaryColorHex, primaryColorName,
                     secondaryColorHex?, pattern, patternScale, material, fit,
                     formality (1-5), seasons[], weatherMinC?, weatherMaxC?, brand?, brandGuess?, size?,
                     aiAttributes (Json), attributeConfidence (Json), taggingVersion?, taggedAt?,
                     taggingStatus (PENDING|SUGGESTED|CONFIRMED),
                     status (ACTIVE|LAUNDRY|STORED|DONATED|ARCHIVED), wearCount, lastWornAt

GarmentImage         garmentId, kind (ORIGINAL|THUMB|DETAIL), storageKey, mimeType,
                     width, height, byteSize, isPrimary, sortOrder

Outfit               userId, title, styleTag, oneLiner, description, occasions[],
                     styleNotes[], fitNotes[], colorPalette[] (hex), referenceBrands (Json),
                     weatherMinC?, weatherMaxC?, engineScore, aiConfidence? (no mostrar sin calibrar),
                     source (AI|MANUAL), promptVersion, modelUsed,
                     engineVersion, candidateSetHash, generationSnapshot (Json),
                     isFavorite, rating?, rejectedReason?, wornAt?

OutfitItem           outfitId, garmentId, slot, role, why (por qué esta prenda), order
                     @@unique([outfitId, garmentId])

OutfitRender         outfitId, kind (AI_MODEL), imageKey, modelUsed, promptUsed

WardrobeGap          userId, slot, garmentTypeId, colorName, description, reason,
                     unlockedOutfitsEstimate, priority, referenceBrands (Json),
                     status (OPEN|PURCHASED|DISMISSED), createdAt, resolvedAt?

OutfitFeedback       outfitId, userId, kind (RATING|FAVORITE|REJECTED|WORN),
                     reason?, note?, createdAt

AiJob                userId, kind (TAGGING|STYLING|GAP_ANALYSIS|RENDER),
                     status (QUEUED|RUNNING|SUCCEEDED|FAILED|CANCELLED),
                     idempotencyKey, attempts, providerRequestId?, model?,
                     estimatedCostUsd?, actualCostUsd?, errorMessage?, startedAt?, finishedAt?

AiUsageLog           userId, kind, model, inputTokens, outputTokens, imageCount,
                     cachedInputTokens?, costUsd, latencyMs, providerRequestId?,
                     status, errorCode?, errorMessage, createdAt
```

`GarmentSlot` enum: `TOP | MID_LAYER | OUTERWEAR | BOTTOM | FULL_BODY | FOOTWEAR | ACCESSORY`.

Dos niveles (enum de slot + `GarmentType` editable) mantienen simple la lógica de "un look necesita TOP + BOTTOM + FOOTWEAR" sin encerrar el vocabulario en un enum que habría que migrar cada vez que compres algo nuevo. Varias `GarmentImage` por prenda permiten usar foto frontal, detalle y referencia para el render.

Convención de `journal`: campos y enums en **inglés**, etiquetas de UI en **español** vía `enumLabels` en `shared-types`. Cada servicio usa consultas scoped por `userId` y una prueba de ownership/IDOR; no se confía únicamente en que cada desarrollador recuerde agregar el filtro manual.

`AiUsageLog` y `AiJob` no son opcionales: registran el consumo, permiten reintentos idempotentes y alimentan una reserva transaccional del presupuesto mensual antes de llamar a la API.

---

# El motor de recomendación

Esta es la parte central del proyecto y donde va el detalle.

## Enfoque: híbrido, no LLM puro

Mandarle el clóset completo a un LLM y pedirle "arma un look" falla de tres maneras: inventa prendas, produce combinaciones incoherentes (blazer con chanclas), y es caro e irreproducible. Un algoritmo puro, en cambio, produce combinaciones válidas pero sin gusto ni narrativa.

La arquitectura es de dos capas:

```
Clóset + Perfil + Petición
        │
        ▼
┌─────────────────────────────────────────────┐
│ CAPA 1 — Motor de compatibilidad (código)   │
│ Genera y puntúa candidatos válidos.         │
│ Determinista, testeable, gratis.            │
└─────────────────────────────────────────────┘
        │  top-K candidatos con ids cortos g1..gN
        ▼
┌─────────────────────────────────────────────┐
│ CAPA 2 — Estilista LLM (OpenAI)             │
│ Elige los mejores 2-3, los ordena y         │
│ escribe la narrativa. Structured Outputs    │
│ con enum de ids reales.                     │
└─────────────────────────────────────────────┘
        │
        ▼
Validación de salida → persistencia → LookCard
```

Lo que gana: las restricciones duras (propiedad, disponibilidad, slots obligatorios y `mustInclude`) quedan **garantizadas por código y cubiertas por tests**; el gusto y el lenguaje los pone el LLM. Además baja los tokens y permite diagnosticar cada decisión. El motor es reproducible; la redacción del LLM no se considera determinista, por eso se guarda el snapshot de entrada, el modelo, el prompt y la versión del motor.

## Capa 1 — Motor de compatibilidad

Módulo `apps/backend/src/modules/stylist/engine/`, sin dependencias de red.

### Reglas duras (descartan el candidato)

1. **Completitud de slots.** Un look válido es `TOP + BOTTOM + FOOTWEAR` **o** `FULL_BODY + FOOTWEAR`. `MID_LAYER`, `OUTERWEAR` y `ACCESSORY` son opcionales. Sin la rama `FULL_BODY` un clóset con vestidos no genera nada.
2. **Disponibilidad.** Solo `status = ACTIVE`. Lo que está en la lavadora o guardado no se propone.
3. **Clima incompatible.** Si el usuario proporciona temperatura, lluvia o preferencia térmica, se excluye una prenda cuyo rango sea claramente incompatible. La temporada es una señal regional, no una obligación; para Colombia se priorizan temperatura, lluvia y peso de la capa.
4. **`mustIncludeGarmentId`.** Si viene, todo candidato debe contenerla. Es el caso exacto del ejemplo: "dame looks con esta chaqueta".

### Preferencias blandas (puntúan o penalizan)

Estas reglas no descartan automáticamente: un clóset pequeño debe producir el mejor resultado disponible y explicar sus compromisos.

1. **Formalidad.** Se puntúa la cercanía a la ventana del `styleTag` (minimalista 2–4, smart casual 3–4, formal 4–5, streetwear 1–3), sin prometer smart casual si los datos disponibles solo permiten casual.
2. **Color.** Se calcula desde los hex, considerando tono, saturación, luminosidad y neutros. Las relaciones HSL son una señal, no una ley; `avoidedColors` sí puede ser una exclusión explícita del usuario.
3. **Estampados.** Se penaliza el choque visual. Máximo un estampado llamativo como preferencia inicial; dos pueden sobrevivir si la escala y el contraste son razonables.
4. **Ajuste y proporción.** `fit-rules.ts` puede premiar o penalizar cortes, largos y capas según altura, medidas y preferencias, pero no descarta una prenda por el cuerpo del usuario.
5. **Repetición y variedad.** Se penalizan prendas usadas recientemente y conjuntos ya generados, manteniendo al menos una alternativa distinta cuando exista.

Cada regla devuelve `{ kind: HARD | SOFT, score, reason }`. Los umbrales se mantienen en `engine.constants.ts` y se prueban con casos sintéticos.

### Puntuación (ordena los que sobrevivieron)

`engineScore` suma: cercanía a la ventana de formalidad, calidad de la armonía de color, adecuación climática, ajuste a las preferencias, riqueza de capas cuando el clima lo pide, uso de prendas favoritas y **penalización por repetición** (prendas usadas en los últimos N días, outfits ya generados con el mismo conjunto).

Se manda al LLM el top-K (arranca en 40). La enumeración dinámica de IDs se limita por configuración y se registra si hubo truncamiento. Si el clóset crece, el motor usa pools por slot y beam search para evitar una explosión combinatoria. Todo truncamiento queda en logs estructurados.

### Fallback cuando no hay candidatos

Si el motor devuelve cero, **no se le pide al LLM que improvise**. Se devuelve un diagnóstico concreto ("no tienes calzado con formalidad ≥4 para esta ocasión", "no tienes abrigo para 8 °C") y un enlace directo al análisis de vacíos de la Fase 5. Un clóset de 5 prendas puede caer aquí seguido, y eso es información útil, no un error.

## Reglas de ajuste por cuerpo y altura

En `fit-rules.ts` como **datos tipados**, no como prosa dentro de un prompt. Cada regla tiene condición, efecto (premiar o penalizar) y el texto en español que el LLM usará en `fitNotes`. Así la misma fuente de verdad calcula el resultado y redacta la explicación sin convertir recomendaciones de estilo en juicios sobre el cuerpo.

Ejemplos de reglas por altura:

- `heightCm < 170` → puede sugerir pantalón al tobillo, líneas verticales y largos proporcionados. No descarta automáticamente un abrigo largo.
- `heightCm > 185` → puede admitir largos y capas amplias; advierte sobre mangas y bajos cortos.

Las reglas se basan primero en altura, medidas disponibles y preferencias de ajuste. `bodyShape` es opcional y no se infiere desde una fotografía. El género no es un filtro corporal:

| Fuente  | `bodyShape` o preferencia                                            | Ejemplos de regla                                                                                             |
| ------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Usuario | `RELAXED`, `REGULAR`, `SLIM`, `OVERSIZED`, o preferencias propias    | Se prioriza el corte que el usuario marca como cómodo; nunca se etiqueta el cuerpo automáticamente.           |
| Medidas | proporciones hombro/cintura/cadera cuando el usuario las proporciona | Puede sugerir equilibrar volumen, marcar cintura o usar líneas verticales; siempre como explicación opcional. |
| Altura  | rango de altura, si el usuario lo proporciona                        | Puede sugerir largos y proporciones, sin convertir un umbral en una regla universal.                          |

## Capa 2 — El estilista LLM

### Entrada

Un mensaje estructurado en bloques nombrados, no un párrafo:

- **PERFIL** — género opcional, altura en cm si fue proporcionada, medidas relevantes, preferencias de ajuste/ comodidad, tono de piel opcional, arquetipos de estilo, colores que evitas, presupuesto, país/moneda, ciudad y clima.
- **PETICIÓN** — `styleTag`, ocasión, clima/temperatura, `mustInclude` si aplica.
- **CANDIDATOS** — los top-K con ids cortos `g1..gN`: slot, tipo, color (nombre + hex), patrón, material, fit, formalidad, temporadas, marca. Compacto, sin UUIDs.
- **REGLAS DE AJUSTE** — las reglas de `fit-rules.ts` ya **resueltas para este usuario**, no el catálogo genérico. El LLM recibe "prefiere corte regular y largos proporcionados", no una etiqueta corporal ni la tabla completa.
- **PREFERENCIAS APRENDIDAS** — prendas más usadas, favoritas, y combinaciones rechazadas con su motivo.

### Configuración

- Usar un adaptador de OpenAI basado en **Responses API + Structured Outputs**, con esquema Zod compartido y `strict: true`. El contrato del dominio no depende del endpoint concreto.
- No fijar `temperature` como decisión universal. El modelo y sus parámetros se configuran por entorno y se comparan mediante evaluaciones sobre el mismo conjunto de casos.
- Manejar explícitamente respuesta rechazada, respuesta incompleta, timeout, rate limit y error de esquema. Un retry solo procede para errores transitorios o una salida reparable, con límite de intentos y costo registrado.
- Prompts versionados en `src/modules/stylist/prompts/stylist.prompt.v1.ts`. `Outfit.promptVersion`, `modelUsed`, `engineVersion` y `candidateSetHash` permiten comparar v1 vs v2 sobre el mismo clóset sin afirmar reproducibilidad exacta del LLM.

### Cómo se garantiza que no invente ropa

Es el requisito central y **no se resuelve pidiéndoselo en el prompt**. Tres capas:

1. **Ids cortos con mapa en memoria.** Los candidatos se serializan como `g1..gN` y el mapa `g3 → uuid` vive durante la petición.
2. **`enum` construido en tiempo de ejecución.** El esquema declara `garmentId` como `enum: ["g1","g2",…]` con los IDs de _esa_ petición. Esto reduce fuertemente la posibilidad de IDs inexistentes, pero se respeta el límite de tamaño del esquema y nunca sustituye la validación del servidor.
3. **Validación post-respuesta.** Se comprueba que cada look traiga los slots obligatorios, no repita prenda indebidamente, respete `mustInclude`, pertenezca al usuario y sea coherente con los datos del candidato. El `slot` se obtiene del servidor a partir de la prenda; no se confía en un `slot` escrito por el modelo. Si falla, se intenta reparar o reintentar solo cuando corresponda; si vuelve a fallar, ese look se descarta y se registra.

Las **sugerencias de compra van en una llamada aparte** con su propio esquema, para que el modelo nunca mezcle "lo que tienes" con "lo que deberías tener".

### Esquema de salida

```
{
  looks: [{
    title, styleTag, oneLiner, description,
    items: [{ garmentId: enum[g1..gN], role, why }], // slot lo completa el servidor
    colorPalette: [hex],
    occasions: [string],
    styleNotes: [string],
    fitNotes: [string],              // ancladas a datos reales y preferencias, sin juicios corporales
    referenceBrands: { luxury: [], affordable: [] },
    weatherRange: { minC, maxC },
    qualityNote?: string             // no es una probabilidad calibrada
  }],
  diagnostics: { note?, missingSlots?: [] }
}
```

Cada campo tiene su lugar en la ficha del ejemplo, uno a uno.

### Bucle de aprendizaje

Sin esto la app no mejora, y es barato:

- `Outfit.rating` (1–5) y `rejectedReason` (`COLOR`, `DEMASIADO_FORMAL`, `DEMASIADO_CASUAL`, `INCOMODO`, `NO_ES_MI_ESTILO`, `PRENDA_NO_DISPONIBLE`), más `isFavorite` y `wornAt`.
- `OutfitFeedback` conserva eventos y una nota opcional; no se sobreescribe la historia cuando el usuario cambia de opinión.
- `Garment.wearCount` / `lastWornAt` se actualizan al marcar un look como usado.
- Esas señales alimentan el bloque PREFERENCIAS APRENDIDAS del prompt **y** el `engineScore` de la Capa 1. Nada de fine-tuning: todo es contexto + puntuación. El sistema no presenta `confidence` como probabilidad hasta tener una calibración medida.

### Evaluación (lo que evita romper el estilista en silencio)

Casos golden en `apps/backend/test/stylist/` con clósets sintéticos y asserts sobre el motor y sobre la salida validada:

- nunca devuelve un `garmentId` fuera del enum;
- honra `mustIncludeGarmentId`;
- respeta la ventana de formalidad del `styleTag`;
- respeta `avoidedColors`;
- genera looks válidos para un clóset cuya única base es un vestido (`FULL_BODY`);
- con una altura proporcionada, las `fitNotes` pueden mencionar largos relevantes, pero no inventan medidas ni imponen un corte;
- con un clóset sin calzado formal y ocasión formal, devuelve diagnóstico y no un look inventado.

Además, se mantiene un conjunto de evaluación de al menos 30 escenarios: clóset pequeño, prendas repetidas, clima cálido/frío, colores evitados, prendas en lavandería, múltiples imágenes y errores/refusals del proveedor.

Es lo único que permite iterar el prompt sin miedo.

---

## Personalización sin excluir por género

El perfil puede guardar género si el usuario desea proporcionarlo, pero no se utiliza como una regla rígida ni como inferencia automática. La personalización se divide así:

1. **Catálogo amplio.** `GarmentType.appliesTo` sirve para ordenar y sugerir categorías, pero no impide registrar ni combinar una prenda. Vestidos, faldas, blusas, polos, blazers, mocasines, botas, bolsos y accesorios caben en el mismo catálogo.
2. **Slot `FULL_BODY`.** Vestidos y jumpsuits ocupan TOP y BOTTOM a la vez, y el motor los acepta como base completa con solo calzado.
3. **Medidas opcionales.** El formulario muestra campos relevantes según lo que el usuario elija proporcionar, no según una suposición de género. Se validan con esquemas Zod por tipo de medida y unidad.
4. **Preferencias de ajuste.** `RELAXED`, `REGULAR`, `SLIM`, `OVERSIZED` y preferencias personalizadas tienen prioridad sobre etiquetas de complexión. El usuario puede pedir marcar cintura, evitar prendas ajustadas, preferir cortes rectos o priorizar comodidad.
5. **Arquetipos.** El catálogo puede ofrecer minimalista, smart casual, clásico, streetwear, boho, romántico, andrógino y otros sin bloquearlos por género. Las reglas explican la combinación real de prendas disponibles.
6. **Render y marcas.** El render describe las prendas, el nivel de cobertura y las preferencias del usuario; no necesita asumir un cuerpo o género. Las marcas de referencia se filtran por país, moneda, presupuesto y disponibilidad cuando esos datos existan, no solamente por género.

El valor por defecto es catálogo completo, perfil corporal opcional y recomendaciones basadas en medidas/preferencias disponibles. Ningún flujo se bloquea por no declarar género, peso o complexión.

---

## Fases

Cada fase entrega algo usable y verificable en escritorio **y** móvil. No se pasa a la siguiente sin cumplir su verificación.

### ☑ Fase 0 — Fundaciones

- Scaffold del monorepo (pnpm + Turborepo), `packages/config`, `packages/shared-types`.
- `apps/backend`: NestJS + Fastify, Prisma + PostgreSQL, env validado con Zod al arrancar, Swagger en `/docs` (solo dev), helmet, throttler, `AllExceptionsFilter`, `request-id`.
- Port de auth desde `journal`: HTTPS en despliegue, contraseña hasheada en servidor, JWT en cookies httpOnly, rotación de refresh y `JwtAuthGuard` global. La capa RSA del login se conserva solo si sigue siendo necesaria; no sustituye HTTPS ni el hash.
- Port de `StorageDriver` + `LocalDiskDriver` para desarrollo. Las imágenes no se sirven como carpeta pública; el contrato de storage contempla driver privado compatible con S3 y URLs firmadas.
- Crear `AiJob` y `AiUsageLog` desde el inicio, aunque el primer worker sea simple y local. Toda llamada IA tiene idempotency key, timeout, reintento limitado y presupuesto reservado antes de ejecutarse.
- `apps/frontend`: Angular 21 zoneless + Tailwind 4, `ApiClient`, interceptor de refresh, notificaciones, confirm, tema, `shared/ui/`, `LayoutService`, shell responsive (sidebar en escritorio / bottom nav en móvil), proxy de dev para `/api` `/health` y endpoint autenticado de imágenes.
- `AGENTS.md` o `CLAUDE.md` según el agente utilizado, con una sola fuente de verdad para comandos y convenciones; no duplicar reglas contradictorias.
- Añadir CI mínimo: format check, typecheck, lint, unit tests y build.
- **Verificar:** `pnpm dev` levanta ambos; te registras, entras, recargas y sigues logueado; el shell se ve correcto a 1440px y a 390px; `/docs` responde; un usuario no puede leer IDs de otro usuario.

### ☑ Fase 1 — Perfil y clóset (sin IA todavía)

- `profile`: CRUD de `StyleProfile` con género, peso, altura y complexión opcionales. El flujo prioriza preferencias de ajuste, comodidad, medidas que el usuario quiera proporcionar, arquetipos, colores evitados, presupuesto, país/moneda y ciudad/clima.
- `garment-types`: catálogo seeded con `appliesTo`, formalidad por defecto y señales climáticas. `appliesTo` ordena, pero no excluye prendas.
- `garments`: CRUD + subida multipart. `sharp` normaliza a WebP (imagen principal ≤1600px, thumb 400px), elimina EXIF y guarda `GarmentImage` vía `StorageDriver`. Se aceptan varias fotos por prenda.
- Frontend: página **Perfil** y página **Clóset** (grid responsive, filtros por slot/color/clima, alta manual, drag & drop y pegar en escritorio, cámara sugerida en móvil, progreso y reintento).
- **Verificar:** subes tus prendas reales (camiseta blanca, camiseta negra, jean azul, chino negro, sneakers blancos) desde el celular y desde el escritorio; editas preferencias y medidas opcionales; confirmas que las imágenes no sean públicas y que otro usuario no pueda accederlas.

### ☑ Fase 2 — Motor de compatibilidad y ficha determinista

- `engine/`: generación de candidatos, reglas HARD/SOFT, `fit-rules.ts` por altura, medidas y preferencias, puntuación de color/formalidad/clima, variedad y diagnóstico de fallback.
- La Capa 1 usa solo prendas `CONFIRMED` y `ACTIVE` para generación automática. Las sugeridas pueden incluirse únicamente con una acción explícita del usuario.
- Endpoint de depuración que expone candidatos, puntuación y razón de descarte o penalización; no expone datos de otros usuarios.
- `LookCardComponent` determinista con fotos reales, prendas, colores y razones del motor. Sin llamada a OpenAI.
- Tests golden del motor con clósets sintéticos, incluida una base `FULL_BODY`, clóset pequeño y caso sin calzado formal.
- **Verificar:** con tus cinco prendas el motor produce solo combinaciones realmente posibles; si no existe un smart casual válido, devuelve diagnóstico en vez de inventar una camisa, blazer o mocasín.

### ☑ Fase 3 — Etiquetado automático por visión

- `VisionService`: imágenes → OpenAI con Structured Outputs → `{ slot, garmentType, primaryColorHex, primaryColorName, secondaryColorHex?, pattern, patternScale, material, fit, formality, weatherMinC?, weatherMaxC?, brandGuess? }`. El tipo de prenda se restringe al catálogo completo y `brandGuess` nunca sobrescribe la marca confirmada por el usuario. Se mandan varias fotos de la misma prenda (hasta 4, portada primero): la etiqueta de composición da el material y un plano de detalle da el tejido, que una sola foto frontal no resuelve. El prompt declara que todas son la misma prenda y que manda la primera, porque si no un plano de detalle se lee como otra prenda. Lo que deba ser inequívoco se exige en el esquema y no en la prosa: pedir "temporadas vacías si sirve en cualquier época" era ambiguo y el modelo devolvía una cosa u otra según la tirada.
- La subida crea `AiJob(TAGGING)` y deja la prenda en `PENDING`; el worker la procesa y pasa a `SUGGESTED` o `FAILED`. La UI muestra progreso, reintento y costo.
- **Los atributos de IA son un borrador**: se muestran como sugerencia y se confirman o corrigen antes de `CONFIRMED`. Un atributo corregido manualmente no debe ser sobrescrito por un reprocesamiento automático sin autorización.
- JSON crudo en `Garment.aiAttributes` para reprocesar sin volver a pagar cuando sea posible. Registro en `AiUsageLog`, incluyendo modelo, tokens/imágenes, latencia y error.
- **Verificar:** subes una foto y el job termina; los atributos salen razonables; corriges uno y persiste; un timeout se puede reintentar; el costo aparece en el log; una imagen que contiene una cara recibe manejo conforme a la política de privacidad del producto.

### ☐ Fase 4 — Estilista LLM y ficha del look

- `OutfitsService` + `modules/stylist/llm/`: construcción del prompt por bloques, Responses API + Structured Outputs con enum en runtime, validación de rechazo/incompleto y salida, remapeo de IDs a UUID, persistencia de `Outfit` + `OutfitItem` + snapshot de generación. El motor sigue siendo `StylistService`, y la Capa 2 parte de sus candidatos en vez de volver a enumerar.
- El esquema del LLM devuelve únicamente IDs, explicación y narrativa. `slot` y rol los pone el catálogo, y **la paleta, el rango térmico y el `styleTag` los calcula el motor**: son datos exactos que ya existen, y pedírselos al modelo sólo abriría la puerta a un color que no está en la ropa. Sale de aquí también el `role` que este plan ponía en `items`: el vocabulario de `OutfitItemRole` ya declaraba desde la Fase 2 que lo deriva el servidor.
- **La composición del look tampoco la decide el modelo.** El bloque `COMPOSICIÓN` del prompt le llega resuelto: si a esa temperatura toca capa (mismo umbral que usa el motor) y qué accesorios hay disponibles. Dejarlo implícito daba dos looks de la misma tanda, uno con chaqueta y otro sin ella, sin criterio visible. Un look completo es base + calzado + capa cuando el clima o la ocasión la piden, más los accesorios que sumen.
- Un look que no pasa la validación **se descarta con su motivo y el motivo se devuelve**; los demás sobreviven. Por eso la comprobación de que el id existe está en el ensamblado y no en el esquema Zod de la respuesta: invalidarla entera perdería los looks que sí valían.
- Los valores de `rejectedReason` van **en inglés** (`TOO_FORMAL`, `NOT_MY_STYLE`…) con su etiqueta en español en `enumLabels`, como el resto de los enums del proyecto. La lista en español de este documento era informal.
- Bucle de aprendizaje en el motor: la señal `PREFERENCE` (`engine-v2`) donde **cada motivo de rechazo penaliza la señal que le corresponde**, no el conjunto entero. Rechazar por color aparta esa paleta, no las prendas; rechazar por demasiado formal desplaza la formalidad objetivo. Si no, rechazar tres looks vaciaría el clóset.
- `LookCardComponent`: la ficha del ejemplo como componente Angular real — fotos reales de tus prendas, swatches de la paleta, marcas de referencia por rango, cuándo usarlo, notas de estilo y bloque de ajuste basado en datos proporcionados. **Es el mismo componente para las dos capas**, porque un `Outfit` es un `Look` más narrativa. Responsive (dos columnas en escritorio, una con secciones colapsables en móvil), respeta el tema. Compartir/descargar con `html-to-image` en el cliente queda después del flujo principal.
- Panel de generación: `styleTag`, ocasión, clima, "usar esta prenda" e interruptor del estilista. Favorito, marcar usado, valorar, rechazar con motivo y borrar. **No hay botón de "guardar"**: la generación ya persiste porque la llamada se pagó, y tirar el resultado obligaría a pagarlo otra vez. Lo que decide el usuario después es si le gusta, si se lo pone o si lo borra.
- **Verificar:** pides "minimalista" y "smart casual"; ambos looks usan **solo** prendas confirmadas que subiste, o el sistema explica por qué una petición no es posible; las notas usan únicamente datos reales; la ficha se ve comparable al ejemplo en ambos anchos; rechazas un look por color y el siguiente lo tiene en cuenta.

### ☐ Fase 5 — Análisis de vacíos y feedback

- La **cobertura se calcula en código**, reutilizando el motor de la Fase 2: matriz slot × formalidad × clima × color, más el conteo de looks válidos posibles y cuántos desbloquearía cada prenda hipotética. Determinista y auditable.
- El LLM solo prioriza y redacta: recibe la matriz y devuelve `WardrobeGap`s con descripción concreta ("chaqueta de cuero negra, corte regular"), motivo, looks que desbloquea y marcas de referencia lujo/asequible filtradas por país, moneda y presupuesto.
- Página **Qué comprar** con las brechas priorizadas; marcar como comprada abre el alta de prenda precargada.
- No se promete un número fijo de compras: cada sugerencia debe explicar qué desbloquea, qué supuestos usa y por qué tiene prioridad. Las marcas son referencias, no disponibilidad ni precio garantizados.
- **Verificar:** con un clóset de 5–6 prendas sugiere brechas coherentes con tu país y presupuesto, y cada una explica qué desbloquea. El resultado es vacío si el clóset ya tiene cobertura suficiente.

### ☐ Fase 6 — Render visual con IA (opcional, por look)

- Botón "generar visual" → `RenderService` crea `AiJob(RENDER)` y manda las fotos reales de las prendas del look a la Image API (`images.edit`) o al flujo de imágenes de Responses API, según el adaptador elegido.
- El prompt describe las prendas confirmadas, el estilo, el clima y las preferencias proporcionadas. No infiere género, peso ni medidas que no existan.
- El resultado es aspiracional: la ficha con fotos reales sigue siendo la fuente de verdad porque el render puede alterar color, textura, logos o ajuste.
- Confirmación de costo antes de generar, cuota transaccional y registro en `AiUsageLog`. Se guarda como `OutfitRender` con modelo, calidad, tamaño y prompt versionado.
- **Verificar:** el render se parece razonablemente al look, se identifica como generado por IA, queda guardado junto al outfit y el costo aparece registrado. Un error o rechazo no rompe la ficha determinista.

### ☐ Fase 7 — PWA, control de gasto y despliegue

- `@angular/pwa`: manifest, iconos, service worker, prompt de instalación.
- Throttling estricto en los endpoints de IA + techo de gasto mensual por usuario usando reserva transaccional y `AiUsageLog` (corta **antes** de llamar a OpenAI). Esto ya existe funcionalmente desde la Fase 0/3; aquí se endurece.
- El mini-PC con nginx + Cloudflare Tunnel sirve para beta personal. Para varios usuarios, producción usa PostgreSQL gestionado, storage privado compatible con S3, backups probados y separación de entornos.
- El CSP estricto exige servir SPA y API desde el mismo origen o configurar explícitamente los orígenes permitidos. Añadir monitoreo de errores, métricas de jobs y prueba de restauración.
- **Verificar:** instalas la app en el celular y en Chrome de escritorio; tomas la foto de una prenda nueva con la cámara y recorres el flujo completo (etiquetado → look → ficha) sin tocar el escritorio.

## Modelos de OpenAI y costo

Configurables por env (`OPENAI_VISION_MODEL`, `OPENAI_STYLIST_MODEL`, `OPENAI_IMAGE_MODEL`) siguiendo el patrón de `imageOpen/server/src/config.ts`. **Confirmar los ids vigentes contra la lista de modelos de OpenAI al empezar la Fase 3**, no fijarlos ahora.

**Confirmado el 7 de agosto de 2026** contra el catálogo y la tabla de precios de OpenAI, al implementar la Fase 3:

| Modelo          | Entrada / salida por MTok | Caché de entrada | Uso                                |
| --------------- | ------------------------- | ---------------- | ---------------------------------- |
| `gpt-5.6-luna`  | 0,20 / 1,20 USD           | 0,02 USD         | Visión (`OPENAI_VISION_MODEL`)     |
| `gpt-5.6-terra` | 2 / 12 USD                | 0,20 USD         | Estilista (`OPENAI_STYLIST_MODEL`) |
| `gpt-5.6-sol`   | 5 / 30 USD                | 0,50 USD         | Sólo si hace falta el tope         |

Los tres aceptan imagen y Structured Outputs. La visión usa `gpt-5.6-luna` con `detail: low` (configurable) y manda hasta 4 fotos de la misma prenda, la portada primero: etiquetar una prenda son unos 2 600 tokens y ~0,0007 USD, así que el techo por defecto de 10 USD/mes da de sobra. El estilista usa `gpt-5.6-terra`, que es diez veces más caro por token pero sobre una entrada diez veces menor —sólo texto, y sólo las prendas de los mejores candidatos—: unos 3 800 tokens de entrada y hasta 3 000 de salida, del orden de 0,04 USD por tanda de looks. Aquí sí se paga un modelo mediano porque elegir entre conjuntos y escribir la ficha es la tarea con criterio del producto. Los precios viven en `apps/backend/src/modules/ai/openai-pricing.ts`, atados al id del modelo; el costo real se calcula siempre desde el `usage` que devuelve la API.

- Cada rol debe declarar modelo, endpoint, nivel de detalle de imagen, esfuerzo de razonamiento si aplica, límite de tokens, timeout y precio vigente. No usar la etiqueta ambigua "modelo pequeño de GPT-5".
- Etiquetado por visión: una imagen por prenda cuando sea suficiente, con `detail` elegido por precisión/costo. Si se reetiqueta una prenda, se registra el motivo y se conserva el resultado anterior.
- Estilista: solo texto (las prendas de los mejores candidatos, no el clóset entero), con Structured Outputs. La Capa 1 reduce tokens, pero el costo real se calcula desde el usage devuelto por la API. El enum de prendas está topado en 40 (`maxGarmentsInEnum`), así que un armario de 300 prendas cuesta lo mismo que uno de 40.
- Render de imagen: modelo de imagen configurable y detrás de confirmación explícita. El costo depende de modelo, tamaño, calidad y tokens de imágenes de entrada; no se fija un rango universal en este documento.
- Referencias oficiales a verificar antes de implementar: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [imágenes y visión](https://developers.openai.com/api/docs/guides/images-vision), [generación y edición de imágenes](https://developers.openai.com/api/docs/guides/image-generation), [catálogo de modelos](https://developers.openai.com/api/docs/models).

## Riesgos y cosas a vigilar

1. **Alucinación de prendas** — reducida con el `enum` en Structured Outputs, mapa de IDs y validación de servidor; no se considera resuelta únicamente por el prompt o el esquema.
2. **Etiquetado incorrecto en silencio** — mitigado con job visible, confirmación humana, versión de atributos y posibilidad de corregir/reprocesar.
3. **El render IA no reproduce fielmente tus prendas.** Por eso la ficha determinista, no el render, es la fuente de verdad del look.
4. **Calidad de las fotos.** Flat-lay sobre fondo neutro mejora muchísimo el etiquetado y el render; vale decirlo en la UI de subida.
5. **Clóset pequeño = pocos looks.** Con 5 prendas el motor puede caer en fallback; debe explicarlo y dirigir a Fase 5, nunca rellenar con prendas inventadas.
6. **Gasto de API** — `AiUsageLog`, cuota y reserva transaccional desde las primeras llamadas; confirmación para render y límites separados por tipo de job.
7. **Privacidad** — fotos, medidas y tono de piel requieren storage privado, eliminación de EXIF, acceso autenticado, exportación/eliminación y política de retención.
8. **Sesgo corporal o de género** — no inferir género, peso o complexión desde imágenes; usar datos proporcionados por el usuario y reglas blandas de comodidad/ajuste.
9. **Marcas y precios desactualizados** — las marcas son referencias filtradas por país, moneda y presupuesto; no se presentan como disponibilidad o precio actual sin una fuente externa incorporada en una fase posterior.

## Convenciones (de tu CLAUDE.md global + `journal`)

- Nunca `any`; `unknown` + narrowing. TS estricto con `noUncheckedIndexedAccess`.
- Zod de punta a punta vía `shared-types`; nada de `class-validator`.
- Sin números mágicos ni literales repetidos >3 veces; constantes en camelCase. El motor de la Capa 1 está lleno de umbrales: todos van a un `engine.constants.ts` con nombre y unidad.
- Interfaces con prefijo `I` y campos en inglés; comentarios y strings de UI en español.
- Nombres descriptivos (nada de `e`, `r`, `v`, `tmp`); errores capturados siempre como `error`.
- Logs con formato `log.<level>('ClassName > methodName - descripción', error?.message)`.
- Angular: standalone, `OnPush`, signal stores con `_signal` privado expuesto por `.asReadonly()`/`computed()`; atributos `data-test` en todo componente nuevo; sin `::ng-deep`, sin `--` estilo BEM, ceros CSS sin unidad.
- Complejidad cognitiva: el motor de reglas se escribe como reglas declarativas en un array, no como un `if` anidado gigante.
- CI obligatorio para format check, typecheck, lint, unit tests y build; SonarQube puede complementar la revisión, no reemplazarla.

## Primer paso concreto

Primer vertical slice: Fase 0 mínima, una prenda creada manualmente, un perfil con preferencias opcionales y la Fase 2 generando una ficha determinista con fotos reales. Después se añade visión y LLM. Así el proyecto demuestra valor antes de invertir en render, compras o una taxonomía extensa.
