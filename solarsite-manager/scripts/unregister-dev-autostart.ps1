#Requires -Version 5.1
<#
.SYNOPSIS
  register-dev-autostart.ps1 で登録したタスクを削除します。
#>

$ErrorActionPreference = "Stop"
$taskName = "Enecheck-SolarSiteManager-npm-run-dev"

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Host "タスク [$taskName] は登録されていません。"
  exit 0
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "削除しました: [$taskName]"
