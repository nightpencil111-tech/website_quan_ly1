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
$nodeCmd = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $nodeCmd) {
    Write-Host 'Không tìm thấy Node.js. Cài Node.js bản 22.13 trở lên (https://nodejs.org) rồi chạy lại.' -ForegroundColor Red
    exit 1
}
$NodeExe = $nodeCmd.Source
$WebTask = 'QuanLyCTV-Web'
$BackupTask = 'QuanLyCTV-SaoLuu'
$FwRule = 'QuanLyCTV-Web'

# Đọc cấu hình (nếu có) để biết cổng và chế độ. Cố ý chỉ đọc từ quanly.config.json,
# không đọc biến môi trường PORT / QLCTV_MODE của phiên cài đặt (chúng không áp dụng cho tác vụ chạy nền).
$port = 3000
$mode = 'noi_bo'
$listenLan = $false
$cfgFile = Join-Path $AppDir 'quanly.config.json'
if (Test-Path $cfgFile) {
    try {
        $cfg = Get-Content -Raw -Encoding UTF8 $cfgFile | ConvertFrom-Json
        if ($cfg.PSObject.Properties['port'] -and $cfg.port) { $port = [int]$cfg.port }
        if ($cfg.PSObject.Properties['mode'] -and $cfg.mode) { $mode = [string]$cfg.mode }
        if ($cfg.PSObject.Properties['listenLan'] -and $cfg.listenLan -eq $true) { $listenLan = $true }
    } catch {
        Write-Host "Không đọc được tệp cấu hình quanly.config.json: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host 'Kiểm tra lại dấu ngoặc, dấu phẩy, dấu nháy kép trong tệp rồi chạy lại.' -ForegroundColor Red
        exit 1
    }
}
if ($port -lt 1 -or $port -gt 65535) {
    Write-Host "Cổng $port không hợp lệ (phải từ 1 đến 65535). Sửa trong quanly.config.json rồi chạy lại." -ForegroundColor Red
    exit 1
}

# Chạy lại để áp dụng cấu hình mới: dừng bản đang chạy trước khi đăng ký lại.
if (Get-ScheduledTask -TaskName $WebTask -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $WebTask -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*src\server.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path (Join-Path $AppDir 'logs') | Out-Null

$user = $identity.Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Highest

# Tác vụ 1: chạy máy chủ web khi khởi động máy. Task Scheduler KHÔNG tự chạy lại khi tiến trình thoát với mã lỗi,
# nên chạy qua run-server.cmd (vòng lặp: node thoát thì chờ 60 giây rồi chạy lại, ghi nhật ký vào logs\server.log).
# cmd.exe nhận: /c ""<AppDir>\scripts\windows\run-server.cmd" "<đường dẫn node.exe>""
# (cmd bỏ cặp nháy kép ngoài cùng, còn lại: "<run-server.cmd>" "<node.exe>" - an toàn khi đường dẫn có dấu cách).
# Cài đặt khởi động lại của Task Scheduler giữ làm lớp bảo vệ thứ hai.
$runCmd = Join-Path $AppDir 'scripts\windows\run-server.cmd'
$webAction = New-ScheduledTaskAction -Execute 'cmd.exe' `
    -Argument ('/c ""{0}" "{1}""' -f $runCmd, $NodeExe) `
    -WorkingDirectory $AppDir
$webTrigger = New-ScheduledTaskTrigger -AtStartup
$webSettings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -Priority 5
Register-ScheduledTask -TaskName $WebTask -Action $webAction -Trigger $webTrigger -Principal $principal `
    -Settings $webSettings -Description 'Quản lý CTV: máy chủ web' -Force | Out-Null

# Tác vụ 2: sao lưu hằng ngày lúc 02:30.
$bkAction = New-ScheduledTaskAction -Execute 'cmd.exe' `
    -Argument ('/c ""{0}" --no-warnings=ExperimentalWarning scripts\backup.js >> logs\backup.log 2>&1"' -f $NodeExe) `
    -WorkingDirectory $AppDir
$bkTrigger = New-ScheduledTaskTrigger -Daily -At '02:30'
$bkSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $BackupTask -Action $bkAction -Trigger $bkTrigger -Principal $principal `
    -Settings $bkSettings -Description 'Quản lý CTV: sao lưu dữ liệu hằng ngày' -Force | Out-Null

# Tường lửa: luôn xóa luật cũ; chỉ tạo lại khi chạy nội bộ hoặc cho phép LAN (chỉ hồ sơ Domain/Private, không mở Wi-Fi công cộng).
Get-NetFirewallRule -DisplayName $FwRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if ($mode -eq 'noi_bo' -or $listenLan) {
    New-NetFirewallRule -DisplayName $FwRule -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port `
        -Profile Domain,Private | Out-Null
    Write-Host "Đã mở cổng $port trên tường lửa cho mạng nội bộ (hồ sơ Domain/Private)."
}

Start-ScheduledTask -TaskName $WebTask

Write-Host ''
Write-Host 'Đã cài đặt xong:' -ForegroundColor Green
Write-Host "  - Máy chủ web tự chạy khi bật máy (tác vụ $WebTask), nhật ký ở logs\server.log (tự chạy lại sau 60 giây nếu bị lỗi)"
Write-Host "  - Sao lưu tự động lúc 02:30 hằng ngày (tác vụ $BackupTask), bản sao ở thư mục backups"
Write-Host ''
Write-Host 'Bước tiếp theo:'
Write-Host "  1. Mở trình duyệt, truy cập http://localhost:$port và đăng nhập."
Write-Host '  2. Để truy cập từ Internet, xem hướng dẫn trong README (mục Internet).'
Write-Host '  3. Gỡ cài đặt: chạy scripts\windows\uninstall.ps1 với quyền Administrator.'
