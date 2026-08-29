# Registra el backend como tarea programada que arranca con Windows y se
# reinicia sola si el proceso muere.
#
# Se usa el Programador de tareas y no un envoltorio tipo NSSM porque no hay nada
# que descargar: viene con el sistema y sabe reiniciar un proceso caído, que es
# lo único que se le pide. `cloudflared` y PostgreSQL sí traen su propio
# instalador de servicio y se registran con el suyo.
#
# Requiere PowerShell como administrador.

[CmdletBinding()]
param(
  [string]$TaskName = 'closetAI backend',
  # SYSTEM arranca sin que nadie inicie sesión. Si tu Node está instalado sólo
  # para tu usuario, pasa tu cuenta aquí y se te pedirá la contraseña.
  [string]$RunAsUser = 'SYSTEM',
  # Cada cuánto se reintenta el arranque cuando el proceso muere.
  [int]$RestartIntervalMinutes = 1,
  [int]$RestartCount = 999
)

$ErrorActionPreference = 'Stop'

$startScript = Join-Path $PSScriptRoot 'start-backend.ps1'
if (-not (Test-Path $startScript)) {
  throw "No se encontró $startScript"
}

# La tarea corre como SYSTEM, que no hereda el PATH de tu usuario: se resuelve
# ahora la ruta completa de node y se guarda en la acción.
$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
  throw 'No se encontró node en el PATH. Instala Node 22+ para todos los usuarios.'
}
Write-Host "Node encontrado en $($node.Source)"
if ($RunAsUser -eq 'SYSTEM' -and $node.Source -like "$env:LOCALAPPDATA*") {
  Write-Warning 'Node está instalado sólo para tu usuario: SYSTEM no podrá verlo. Vuelve a lanzar con -RunAsUser <tu cuenta> o reinstala Node para todos los usuarios.'
}

$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$startScript`""

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartInterval (New-TimeSpan -Minutes $RestartIntervalMinutes) `
  -RestartCount $RestartCount `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

if ($RunAsUser -eq 'SYSTEM') {
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null
}
else {
  $credential = Get-Credential -UserName $RunAsUser -Message 'Contraseña de la cuenta que ejecutará closetAI'
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -User $credential.UserName `
    -Password $credential.GetNetworkCredential().Password -RunLevel Highest -Force | Out-Null
}

Start-ScheduledTask -TaskName $TaskName
Write-Host "Tarea '$TaskName' registrada y arrancada."
Write-Host 'Comprueba con: .\healthcheck.ps1'
Write-Host "Para quitarla: Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
