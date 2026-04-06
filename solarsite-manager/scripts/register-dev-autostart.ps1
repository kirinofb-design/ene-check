#Requires -Version 5.1
# Register a Scheduled Task: run "npm run dev" in this project at Windows user logon.
# Run once from PowerShell: .\scripts\register-dev-autostart.ps1

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")

$npmCmd = $null
$npmFound = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmFound) {
  $npmCmd = $npmFound.Source
}
if (-not $npmCmd -and (Test-Path "$env:ProgramFiles\nodejs\npm.cmd")) {
  $npmCmd = "$env:ProgramFiles\nodejs\npm.cmd"
}
$programFilesX86 = [Environment]::GetFolderPath("ProgramFilesX86")
if (-not $npmCmd -and (Test-Path "$programFilesX86\nodejs\npm.cmd")) {
  $npmCmd = "$programFilesX86\nodejs\npm.cmd"
}
if (-not $npmCmd) {
  Write-Error "npm.cmd not found. Install Node.js and ensure it is on PATH."
}

$taskName = "Enecheck-SolarSiteManager-npm-run-dev"

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction -Execute $npmCmd -Argument "run dev" -WorkingDirectory $projectRoot.Path
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "solarsite-manager: npm run dev at user logon"

Write-Host "Registered task: $taskName"
Write-Host "Project: $($projectRoot.Path)"
Write-Host "To remove: .\scripts\unregister-dev-autostart.ps1"
