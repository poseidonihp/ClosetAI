# Despliegue en el mini PC (Windows + Cloudflare Tunnel)

Guía para dejar closetAI corriendo en un mini PC con Windows, accesible desde el
celular y desde Chrome de escritorio, con HTTPS y sin abrir puertos del router.

Los archivos de esta guía viven en [deploy/](../deploy). Los comandos de
desarrollo (build, tests, migraciones) están en [CLAUDE.md](../CLAUDE.md) y no se
repiten aquí.

## Por qué esta forma y no otra

- **Un solo proceso sirve la API y la SPA.** El CSP de la app declara
  `connect-src 'self'`, así que SPA y API tienen que compartir origen. Con
  `SERVE_SPA=true` el backend sirve el `dist/` de Angular, y el mismo origen pasa
  de ser algo que hay que configurar bien en un proxy a una propiedad de
  construcción. De paso desaparece nginx, que en Windows significa un segundo
  proceso sin gestor de servicios y un segundo sitio donde desincronizar las
  cabeceras de seguridad.
- **Cloudflare Tunnel y no un puerto abierto.** El túnel abre una conexión
  saliente, así que no se publica la IP de casa ni se toca el router. Y da HTTPS
  válido, que es lo que hace posible **tomar fotos con la cámara**: el navegador
  sólo expone `getUserMedia`, el service worker y la instalación de la PWA en un
  contexto seguro.
- **El origen escucha en loopback.** `HOST=127.0.0.1` deja el backend fuera de la
  red local aunque el cortafuegos falle; el único que llega es `cloudflared`.

## Requisitos en el mini PC

| Pieza                    | Cómo                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| Node 22+                 | Instalador oficial, **para todos los usuarios** (ver nota del servicio) |
| pnpm 11+                 | `npm install -g pnpm`                                                   |
| PostgreSQL 16+           | Instalador oficial; deja `pg_dump`, `pg_restore` y `psql` en el PATH    |
| Git                      | Para `deploy.ps1`                                                       |
| cloudflared              | `winget install --id Cloudflare.cloudflared`                            |
| Un dominio en Cloudflare | Necesario para el túnel con nombre                                      |

> **Nota del servicio.** La tarea programada corre como `SYSTEM`, que no ve un
> Node instalado sólo para tu usuario. Si lo instalaste así, registra el servicio
> con `-RunAsUser <tu cuenta>`; `install-service.ps1` lo detecta y avisa.

## 1. Base de datos

```powershell
# Desde "SQL Shell (psql)" o con psql en el PATH
psql -U postgres -c "CREATE USER closetai WITH PASSWORD 'una-clave-larga';"
psql -U postgres -c "CREATE DATABASE closetai OWNER closetai;"
```

## 2. Código y configuración

```powershell
git clone <tu-remoto> C:\closetai\app
Set-Location C:\closetai\app
pnpm install --frozen-lockfile

Copy-Item deploy\.env.production.example apps\backend\.env
pnpm --filter @closetai/backend gen:rsa   # pega la línea RSA_PRIVATE_KEY_B64 en el .env
```

Completa en `apps\backend\.env` al menos: `DATABASE_URL`, `JWT_SECRET`,
`JWT_REFRESH_SECRET`, `COOKIE_SECRET`, `RSA_PRIVATE_KEY_B64`, `CORS_ORIGINS` con
tu dominio y `OPENAI_API_KEY` si quieres las funciones de IA.

Genera cada secreto con:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**`STORAGE_ROOT` fuera del repo** (la plantilla propone `C:\closetai\storage`):
así un `git clean` o un despliegue no se lleva las fotos por delante.

Con `NODE_ENV=production` el arranque **falla** si `COOKIE_SECURE` no es `true`.
Es intencionado: detrás del túnel el navegador siempre habla HTTPS.

## 3. Esquema, catálogo y build

```powershell
pnpm --filter @closetai/backend prisma:generate
pnpm --filter @closetai/backend prisma:deploy
pnpm --filter @closetai/backend db:seed
pnpm build
```

`prisma:deploy` sólo aplica migraciones ya escritas: nunca genera ni resetea nada.
`db:seed` es idempotente por `slug`, así que correrlo de más no duplica tipos.

## 4. El servicio

```powershell
Set-Location C:\closetai\app\deploy\windows
# Como administrador
.\install-service.ps1
.\healthcheck.ps1
```

Registra una tarea programada que arranca con Windows, se reinicia sola si el
proceso muere y deja la salida en `logs\closetai-<fecha>.log` con 30 días de
retención.

Para quitarla: `Unregister-ScheduledTask -TaskName 'closetAI backend' -Confirm:$false`.

## 5. El túnel

```powershell
cloudflared tunnel login
cloudflared tunnel create closetai
# Apunta el dominio al túnel
cloudflared tunnel route dns closetai closet.tudominio.com
```

Copia [deploy/cloudflared/config.example.yml](../deploy/cloudflared/config.example.yml)
a `C:\Users\<usuario>\.cloudflared\config.yml`, sustituye el UUID y el dominio, y
registra el servicio:

```powershell
cloudflared service install
```

Abre `https://closet.tudominio.com` y comprueba que carga la app.

### Cerrar el acceso a quien no toca

La app pide sesión en todo endpoint, pero el formulario de acceso queda expuesto
a internet. Dos capas que valen la pena:

- **Cloudflare Access** delante del dominio, con una lista de correos permitidos.
  Es la barrera de verdad: nadie sin invitación llega ni al formulario.
- Aunque no la pongas, `login` y `registro` bloquean cinco minutos tras cinco
  intentos fallidos en un minuto, y `TRUST_PROXY=true` es lo que hace que ese
  límite cuente por IP real y no por la del túnel.

## 6. Instalar la app y usar la cámara

En el celular (Chrome o Safari) y en Chrome de escritorio, abre el dominio y usa
**Instalar la app** —el botón aparece en la barra lateral y en la superior cuando
el navegador la ofrece—. En iOS se instala desde Compartir → Añadir a la pantalla
de inicio, que es como funciona ahí.

La cámara aparece como **Tomar foto** en el diálogo de prenda y en la pestaña
"¿Me lo compro?". Funciona igual en el celular y en Chrome de escritorio con una
webcam. La primera vez el navegador pide permiso; si lo niegas, se vuelve a
habilitar desde el candado de la barra de direcciones.

Si el botón no aparece, el navegador no está en contexto seguro: comprueba que
entras por `https://` y no por la IP del mini PC.

## Operación

### Desplegar una versión nueva

```powershell
Set-Location C:\closetai\app\deploy\windows
.\deploy.ps1
```

Hace copia de seguridad, trae los cambios, instala, compila, migra, siembra el
catálogo, reinicia el servicio y comprueba la salud. Falla ruidosamente en el
primer paso que no salga bien.

Después de desplegar, quien tenga la app abierta ve el aviso **"Hay una versión
nueva"** y actualiza cuando quiera: no se recarga sola en mitad de un formulario.

### Copias de seguridad

```powershell
.\backup.ps1                       # base + fotos, con 14 días de retención
```

Programa una diaria:

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\closetai\app\deploy\windows\backup.ps1'
Register-ScheduledTask -TaskName 'closetAI backup' -Action $action `
  -Trigger (New-ScheduledTaskTrigger -Daily -At 3am) -User 'SYSTEM' -RunLevel Highest
```

### Probar la restauración

Una copia que no se ha restaurado nunca no es una copia. `restore.ps1` restaura
**sobre una base de prueba** salvo que se le pase `-Force` con un destino
explícito, justo para que probar no pueda destruir lo que se quería proteger:

```powershell
.\restore.ps1 -DumpFile C:\closetai\backups\closetai-20260828-030000.dump
```

Cuenta las prendas restauradas al terminar. Las fotos van en el `.zip` de la
misma fecha y se descomprimen sobre `STORAGE_ROOT`.

### Ver qué pasa

| Qué                 | Dónde                                                            |
| ------------------- | ---------------------------------------------------------------- |
| Log del backend     | `logs\closetai-<fecha>.log` en la raíz del repo                  |
| ¿Está vivo?         | `.\healthcheck.ps1` (proceso y base, contra 127.0.0.1)           |
| Gasto de IA del mes | `GET /api/ai/usage` con sesión, y en pantalla en Looks y Comprar |
| Estado del túnel    | Panel de Cloudflare → Zero Trust → Networks → Tunnels            |

Para vigilar sin mirar, programa `healthcheck.ps1` cada cinco minutos: devuelve
código 1 cuando algo falla y el Programador de tareas lo registra.

## Control de gasto

Tres capas, y ninguna sustituye a la anterior:

1. **Reserva antes de llamar.** Ningún endpoint habla con OpenAI sin haber
   reservado el costo estimado dentro de una transacción `Serializable`. Si no
   cabe en el presupuesto, no se llama y no se gasta.
2. **Dos techos mensuales.** `AI_MONTHLY_BUDGET_USD` por usuario y
   `AI_GLOBAL_MONTHLY_BUDGET_USD` para toda la instalación. El segundo importa
   porque el primero multiplicado por N usuarios no acota nada y la clave de
   OpenAI es una sola.
3. **Límite agregado por minuto.** Cada endpoint pagado ya tenía el suyo, pero
   eran independientes: sumados dejaban pasar la tanda de looks, el análisis, el
   render y el etiquetado a la vez. Ahora hay además un tope conjunto de 12
   llamadas por minuto para todos ellos.

El techo de la instalación se ajusta en el `.env` y hace falta reiniciar el
servicio. Sin `OPENAI_API_KEY` la app funciona igual y los endpoints de IA
responden 503 explicándolo.

## Problemas conocidos

**El botón de instalar no aparece.** Chrome sólo lo ofrece sobre HTTPS, con
manifest e iconos válidos y con el service worker registrado. Comprueba en
DevTools → Application → Manifest. Si ya la instalaste, no vuelve a aparecer.

**La cámara no abre.** Necesita contexto seguro (`https://` o `localhost`). Por la
IP del mini PC en la LAN Chrome la bloquea, y la app enseña ese motivo en vez de
un error genérico. En escritorio, comprueba también que ninguna otra aplicación
tenga tomada la webcam.

**Un render devuelve 524.** El borde de Cloudflare corta cualquier petición que
pase de 100 segundos. Sólo le ocurre al render de imagen con calidad `high`; con
la `medium` por defecto no llega. Cuando pasa, la imagen suele haberse guardado
igual —y cobrado—: recarga la ficha del look antes de volver a pedirla.

**Todos los usuarios comparten el límite de peticiones.** Falta `TRUST_PROXY=true`.
Sin él todas las peticiones llegan desde `127.0.0.1` y el limitador las cuenta
como si fueran de una sola persona.

**La app se quedó en la versión anterior.** El service worker sirve la copia que
tiene hasta que se acepta la actualización. Fuerza con DevTools → Application →
Service Workers → Update, o cierra y abre la app instalada.

## Lo que este despliegue no es

Es una beta personal en una caja. Para varios usuarios de verdad hacen falta
PostgreSQL gestionado, storage privado compatible con S3, entornos separados y
copias fuera del mismo equipo: si el mini PC se moja, ahora mismo se moja también
la única copia. El plan lo dice en la [Fase 8](../plan.md) y sigue siendo cierto.
