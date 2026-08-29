# Copia de seguridad de la base y de las fotos.
#
# Son las dos cosas que no se pueden regenerar: el código vuelve de git y el
# build de un `pnpm build`, pero una foto borrada no vuelve de ninguna parte.
# La cadena de conexión se lee del .env y se le pasa entera a pg_dump, así que la
# contraseña no aparece en la línea de comandos ni en el historial.

[CmdletBinding()]
param(
  [string]$Destination = 'C:\closetai\backups',
  # Copias que se conservan. Con una diaria son dos semanas.
  [int]$RetentionDays = 14
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$envFile = Join-Path $repoRoot 'apps\backend\.env'
if (-not (Test-Path $envFile)) {
  throw "No existe $envFile"
}

$envLines = Get-Content $envFile
$databaseLine = $envLines | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -Last 1
if ($null -eq $databaseLine) {
  throw "No se encontró DATABASE_URL en $envFile"
}
$databaseUrl = ($databaseLine -split '=', 2)[1].Trim().Trim('"')

# Las fotos pueden vivir fuera del repo (STORAGE_ROOT). Si no se declara, el
# backend usa <repo>\storage\uploads, así que aquí se aplica la misma regla.
$storageLine = $envLines | Where-Object { $_ -match '^\s*STORAGE_ROOT\s*=' } | Select-Object -Last 1
$storageRoot = ''
if ($null -ne $storageLine) {
  $storageRoot = ($storageLine -split '=', 2)[1].Trim().Trim('"')
}
if ([string]::IsNullOrWhiteSpace($storageRoot)) {
  $storageRoot = Join-Path $repoRoot 'storage\uploads'
}

if (-not (Test-Path $Destination)) {
  New-Item -ItemType Directory -Path $Destination | Out-Null
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dumpFile = Join-Path $Destination "closetai-$stamp.dump"
$photosFile = Join-Path $Destination "closetai-storage-$stamp.zip"

Write-Host "Volcando la base en $dumpFile"
# -Fc es el formato propio de PostgreSQL: comprime y lo restaura pg_restore.
& pg_dump --format=custom --no-owner --file $dumpFile $databaseUrl
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump falló con código $LASTEXITCODE"
}

if (Test-Path $storageRoot) {
  Write-Host "Comprimiendo las fotos de $storageRoot en $photosFile"
  Compress-Archive -Path (Join-Path $storageRoot '*') -DestinationPath $photosFile -Force
}
else {
  Write-Warning "No existe $storageRoot todavía: no hay fotos que copiar."
}

$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -Path $Destination -Filter 'closetai-*' -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  ForEach-Object {
    Write-Host "Borrando copia caducada $($_.Name)"
    Remove-Item $_.FullName -Force
  }

Write-Host 'Copia terminada.'
Write-Host 'Una copia que no se ha restaurado nunca no es una copia: prueba restore.ps1 contra una base de prueba.'
