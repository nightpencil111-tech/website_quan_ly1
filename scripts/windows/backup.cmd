@echo off
rem Sao luu du lieu ngay lap tuc vao thu muc backups.
cd /d "%~dp0..\.."
node --no-warnings=ExperimentalWarning scripts\backup.js
if errorlevel 1 (
  echo.
  echo Sao luu that bai, xem thong bao loi o tren.
)
pause
