@echo off
rem Chay he thong Quan ly CTV (cua so nay phai mo trong luc dung).
cd /d "%~dp0..\.."
node --no-warnings=ExperimentalWarning src\server.js
if errorlevel 1 (
  echo.
  echo Khong chay duoc. Kiem tra da cai Node.js ^(ban 22.13 tro len^) va xem thong bao loi o tren.
  pause
)
