# Despliega una versión nueva en el mini PC.
#
# El orden importa: primero la copia de seguridad (una migración es lo único de
# aquí que no se puede deshacer), después las migraciones, y sólo al final se
# reinicia el proceso. Compilar antes de parar nada mantiene la app en pie
# mientras dura el build.

[CmdletBinding()]
param(
  [string]$TaskName = 'closetAI backend',
  # No trae cambios de git: útil cuando el código llega copiado a mano.
  [switch]$NoPull,
  # Se salta la copia de seguridad. Sólo si acabas de hacer una.
  [switch]$SkipBackup,
  [int]$HealthTimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

if (-not $SkipBackup) {
  Write-Host '== Copia de seguridad =='
  & (Join-Path $PSScriptRoot 'backup.ps1')
}

if (-not $NoPull) {
  Write-Host '== Trayendo cambios =='
  & git pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw "git pull falló con código $LASTEXITCODE" }
}

Write-Host '== Dependencias =='
& pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "pnpm install falló con código $LASTEXITCODE" }

Write-Host '== Cliente de Prisma =='
& pnpm --filter @closetai/backend prisma:generate
if ($LASTEXITCODE -ne 0) { throw "prisma:generate falló con código $LASTEXITCODE" }

Write-Host '== Compilando =='
& pnpm build
if ($LASTEXITCODE -ne 0) { throw "pnpm build falló con código $LASTEXITCODE" }

Write-Host '== Migraciones =='
# `migrate deploy` sólo aplica migraciones ya escritas: nunca genera ni resetea nada.
& pnpm --filter @closetai/backend prisma:deploy
if ($LASTEXITCODE -ne 0) { throw "prisma:deploy falló con código $LASTEXITCODE" }

Write-Host '== Catálogo de tipos de prenda =='
# Idempotente por slug: correrlo de más no duplica nada y sí recoge tipos nuevos.
& pnpm --filter @closetai/backend db:seed
if ($LASTEXITCODE -ne 0) { throw "db:seed falló con código $LASTEXITCODE" }

Write-Host '== Reiniciando el servicio =='
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
  throw "No existe la tarea '$TaskName'. Regístrala con install-service.ps1."
}
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $TaskName

Write-Host '== Comprobando =='
& (Join-Path $PSScriptRoot 'healthcheck.ps1') -TimeoutSeconds $HealthTimeoutSeconds
if ($LASTEXITCODE -ne 0) {
  throw 'El backend no respondió sano después del despliegue. Mira logs\closetai-<fecha>.log'
}

Write-Host 'Despliegue terminado.'
