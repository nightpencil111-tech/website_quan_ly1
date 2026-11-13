# Gỡ tác vụ tự chạy và tự sao lưu (Windows). Chạy bằng PowerShell "Run as administrator".
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principalCheck = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Cần chạy với quyền Administrator: bấm chuột phải vào PowerShell, chọn "Run as administrator", rồi chạy lại.' -ForegroundColor Red
    exit 1
}

foreach ($name in @('QuanLyCTV-Web', 'QuanLyCTV-SaoLuu')) {
    $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($t) {
        Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "Đã gỡ tác vụ $name."
    } else {
        Write-Host "Không có tác vụ $name (bỏ qua)."
    }
}

# Tiến trình node còn chạy do tác vụ vừa dừng: dừng theo dòng lệnh để chắc chắn.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*src\server.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$rules = Get-NetFirewallRule -DisplayName 'QuanLyCTV-Web' -ErrorAction SilentlyContinue
if ($rules) {
    $rules | Remove-NetFirewallRule
    Write-Host 'Đã xóa luật tường lửa QuanLyCTV-Web.'
}

Write-Host 'Gỡ cài đặt xong. Dữ liệu (data) và bản sao lưu (backups) vẫn được giữ nguyên.' -ForegroundColor Green
