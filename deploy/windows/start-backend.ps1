# Arranca el backend de closetAI y deja su salida en un log diario.
#
# Es el script que ejecuta la tarea programada, y también sirve para arrancarlo a
# mano y ver qué pasa. Bloquea mientras el proceso vive: eso es lo que hace que
# la tarea se vea "en ejecución" y que su política de reinicio tenga sentido.

[CmdletBinding()]
param(
  # Días de logs que se conservan. Los más viejos se borran al arrancar.
  [int]$LogRetentionDays = 30
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$backendDir = Join-Path $repoRoot 'apps\backend'
$entryPoint = Join-Path $backendDir 'dist\main.js'
$envFile = Join-Path $backendDir '.env'
$logDir = Join-Path $repoRoot 'logs'

if (-not (Test-Path $entryPoint)) {
  throw "No existe $entryPoint. Compila con: pnpm build"
}
if (-not (Test-Path $envFile)) {
  throw "No existe $envFile. Copia deploy\.env.production.example y complétalo."
}
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

# Retención: un log por día, y los anteriores se van solos.
Get-ChildItem -Path $logDir -Filter 'closetai-*.log' -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$LogRetentionDays) } |
  Remove-Item -Force -ErrorAction SilentlyContinue

$logFile = Join-Path $logDir ("closetai-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))
"[{0}] start-backend - arrancando {1}" -f (Get-Date -Format 's'), $entryPoint |
  Out-File -FilePath $logFile -Append -Encoding utf8

# ConfigModule lee el .env del directorio de trabajo, así que hay que estar en
# apps\backend y no en la raíz del repo.
Set-Location $backendDir

# La redirección la hace cmd y no PowerShell a propósito: PowerShell 5.1 envuelve
# cada línea de stderr de un ejecutable nativo en un ErrorRecord, y con
# ErrorActionPreference = 'Stop' el primer log de error del backend mataría este
# envoltorio. Así los dos flujos caen en el mismo archivo, en orden.
& cmd.exe /c "node `"$entryPoint`" >> `"$logFile`" 2>&1"

$code = $LASTEXITCODE
"[{0}] start-backend - el proceso terminó con código {1}" -f (Get-Date -Format 's'), $code |
  Out-File -FilePath $logFile -Append -Encoding utf8
exit $code
