# Restaura una copia de seguridad.
#
# Por defecto restaura sobre una base **de prueba** y no sobre la de verdad: el
# uso normal de este script es comprobar que la copia sirve, y una restauración
# que se ejecuta por error sobre producción destruye justo lo que se quería
# proteger. Para restaurar de verdad hay que pasar -Force y la URL de destino.

[CmdletBinding()]
param(
  # Archivo .dump generado por backup.ps1.
  [Parameter(Mandatory = $true)][string]$DumpFile,
  # Base donde restaurar. Vacío usa la de la app con el sufijo _restore_test.
  [string]$TargetDatabaseUrl = '',
  # Restaura sobre una base que ya tiene datos, borrando lo que había.
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $DumpFile)) {
  throw "No existe $DumpFile"
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$envFile = Join-Path $repoRoot 'apps\backend\.env'

if ([string]::IsNullOrWhiteSpace($TargetDatabaseUrl)) {
  if (-not (Test-Path $envFile)) {
    throw "No existe $envFile y no se indicó -TargetDatabaseUrl"
  }
  $databaseLine = Get-Content $envFile |
    Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } |
    Select-Object -Last 1
  if ($null -eq $databaseLine) {
    throw "No se encontró DATABASE_URL en $envFile"
  }
  $sourceUrl = ($databaseLine -split '=', 2)[1].Trim().Trim('"')
  $builder = [System.UriBuilder]::new($sourceUrl)
  $builder.Path = $builder.Path.TrimStart('/') + '_restore_test'
  $TargetDatabaseUrl = $builder.Uri.AbsoluteUri
  Write-Host "Sin destino indicado: se restaura en la base de prueba $($builder.Path)"
}
else {
  if (-not $Force) {
    throw 'Restaurar sobre una base indicada a mano requiere -Force. Comprueba que es la que quieres.'
  }
}

$targetName = ([System.UriBuilder]::new($TargetDatabaseUrl)).Path.TrimStart('/')
$adminUrl = ([System.UriBuilder]::new($TargetDatabaseUrl))
$adminUrl.Path = 'postgres'

Write-Host "Preparando la base $targetName"
& psql $adminUrl.Uri.AbsoluteUri -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ""$targetName"";"
if ($LASTEXITCODE -ne 0) { throw "No se pudo borrar $targetName (código $LASTEXITCODE)" }
& psql $adminUrl.Uri.AbsoluteUri -v ON_ERROR_STOP=1 -c "CREATE DATABASE ""$targetName"";"
if ($LASTEXITCODE -ne 0) { throw "No se pudo crear $targetName (código $LASTEXITCODE)" }

Write-Host "Restaurando $DumpFile"
& pg_restore --no-owner --dbname $TargetDatabaseUrl $DumpFile
if ($LASTEXITCODE -ne 0) {
  throw "pg_restore falló con código $LASTEXITCODE"
}

# Una restauración que no se comprueba tampoco es una prueba: se cuentan filas.
$check = & psql $TargetDatabaseUrl -t -A -c 'SELECT count(*) FROM garments;'
Write-Host "Restauración terminada. Prendas en la copia: $check"
Write-Host 'Las fotos van aparte: descomprime el .zip correspondiente sobre STORAGE_ROOT.'
