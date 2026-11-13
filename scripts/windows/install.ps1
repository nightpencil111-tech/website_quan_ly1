# Cài đặt tự chạy khi bật máy và tự sao lưu hằng ngày (Windows). Chạy bằng PowerShell "Run as administrator".
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principalCheck = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Cần chạy với quyền Administrator: bấm chuột phải vào PowerShell, chọn "Run as administrator", rồi chạy lại.' -ForegroundColor Red
    exit 1
}

$AppDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host 'Không tìm thấy Node.js. Cài Node.js bản 22.13 trở lên (https://nodejs.org) rồi chạy lại.' -ForegroundColor Red
    exit 1
}
$NodeExe = $nodeCmd.Source
$WebTask = 'QuanLyCTV-Web'
$BackupTask = 'QuanLyCTV-SaoLuu'
$FwRule = 'QuanLyCTV-Web'

# Đọc cấu hình (nếu có) để biết cổng và chế độ.
$port = 3000
$mode = 'noi_bo'
$listenLan = $false
$cfgFile = Join-Path $AppDir 'quanly.config.json'
if (Test-Path $cfgFile) {
    $cfg = Get-Content -Raw -Encoding UTF8 $cfgFile | ConvertFrom-Json
    if ($cfg.PSObject.Properties['port'] -and $cfg.port) { $port = [int]$cfg.port }
    if ($cfg.PSObject.Properties['mode'] -and $cfg.mode) { $mode = [string]$cfg.mode }
    if ($cfg.PSObject.Properties['listenLan'] -and $cfg.listenLan -eq $true) { $listenLan = $true }
}
if ($env:PORT) { $port = [int]$env:PORT }
if ($env:QLCTV_MODE) { $mode = $env:QLCTV_MODE }

New-Item -ItemType Directory -Force -Path (Join-Path $AppDir 'logs') | Out-Null

$user = $identity.Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Highest

# Tác vụ 1: chạy máy chủ web khi khởi động máy, tự chạy lại khi lỗi.
$webAction = New-ScheduledTaskAction -Execute 'cmd.exe' `
    -Argument ('/c ""{0}" src\server.js >> logs\server.log 2>&1"' -f $NodeExe) `
    -WorkingDirectory $AppDir
$webTrigger = New-ScheduledTaskTrigger -AtStartup
$webSettings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $WebTask -Action $webAction -Trigger $webTrigger -Principal $principal `
    -Settings $webSettings -Description 'Quản lý CTV: máy chủ web' -Force | Out-Null

# Tác vụ 2: sao lưu hằng ngày lúc 02:30.
$bkAction = New-ScheduledTaskAction -Execute 'cmd.exe' `
    -Argument ('/c ""{0}" scripts\backup.js >> logs\backup.log 2>&1"' -f $NodeExe) `
    -WorkingDirectory $AppDir
$bkTrigger = New-ScheduledTaskTrigger -Daily -At '02:30'
$bkSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $BackupTask -Action $bkAction -Trigger $bkTrigger -Principal $principal `
    -Settings $bkSettings -Description 'Quản lý CTV: sao lưu dữ liệu hằng ngày' -Force | Out-Null

# Tường lửa: chỉ mở cổng khi chạy nội bộ hoặc cho phép LAN.
if ($mode -eq 'noi_bo' -or $listenLan) {
    Get-NetFirewallRule -DisplayName $FwRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $FwRule -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port | Out-Null
    Write-Host "Đã mở cổng $port trên tường lửa cho các máy trong mạng nội bộ."
}

Start-ScheduledTask -TaskName $WebTask

Write-Host ''
Write-Host 'Đã cài đặt xong:' -ForegroundColor Green
Write-Host "  - Máy chủ web tự chạy khi bật máy (tác vụ $WebTask), nhật ký ở logs\server.log"
Write-Host "  - Sao lưu tự động lúc 02:30 hằng ngày (tác vụ $BackupTask), bản sao ở thư mục backups"
Write-Host ''
Write-Host 'Bước tiếp theo:'
Write-Host "  1. Mở trình duyệt, truy cập http://localhost:$port và đăng nhập."
Write-Host '  2. Để truy cập từ Internet, xem hướng dẫn trong README (mục Internet).'
Write-Host '  3. Gỡ cài đặt: chạy scripts\windows\uninstall.ps1 với quyền Administrator.'
