# Comprueba que el backend responde y que la base contesta.
#
# Devuelve 0 si todo está bien y 1 si no, así que sirve tanto para mirar a mano
# después de un despliegue como para una tarea programada cada pocos minutos que
# escriba en el log cuando algo se cae.
#
# Se apunta a 127.0.0.1 a propósito: comprobar el dominio público mediría también
# el túnel y Cloudflare, y entonces un fallo no diría qué se rompió.

[CmdletBinding()]
param(
  # Vacío toma el puerto del .env del backend, para que cambiarlo allí no deje
  # esta comprobación mirando a un puerto donde no hay nadie.
  [string]$BaseUrl = '',
  # Margen para que el proceso termine de arrancar después de un despliegue.
  [int]$TimeoutSeconds = 60,
  [int]$RetryDelaySeconds = 3
)

$ErrorActionPreference = 'Stop'

$defaultPort = 3000
if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $port = $defaultPort
  $envFile = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'apps\backend\.env'
  if (Test-Path $envFile) {
    $portLine = Get-Content $envFile |
      Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)\s*$' } |
      Select-Object -Last 1
    if ($null -ne $portLine) {
      $port = [int]($portLine -split '=', 2)[1].Trim()
    }
  }
  $BaseUrl = "http://127.0.0.1:$port"
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$lastError = 'sin intentos'

while ((Get-Date) -lt $deadline) {
  try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/health" -TimeoutSec 10
    $database = Invoke-RestMethod -Uri "$BaseUrl/health/db" -TimeoutSec 10
    if ($health.status -eq 'ok' -and $database.status -eq 'ok') {
      Write-Host "OK - $($health.service) responde; la base contesta en $($database.latencyMs) ms"
      exit 0
    }
    $lastError = "estado inesperado: proceso=$($health.status) base=$($database.status)"
  }
  catch {
    $lastError = $_.Exception.Message
  }
  Start-Sleep -Seconds $RetryDelaySeconds
}

# Se avisa con Write-Warning y no con Write-Error: quien llama a este script mira
# el código de salida, y un error terminante lo mataría antes de poder leerlo.
Write-Warning "El backend no respondió sano en $TimeoutSeconds s. Último error: $lastError"
exit 1
