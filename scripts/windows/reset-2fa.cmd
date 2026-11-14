@echo off
rem Dat lai xac thuc 2 lop cho mot tai khoan (khi mat ca dien thoai lan ma du phong).
rem Chay NGAY TREN MAY CHU, trong thu muc ung dung.
cd /d "%~dp0..\.."
set "QLCTV_USER="
set /p "QLCTV_USER=Nhap ten dang nhap can dat lai xac thuc 2 lop (vi du: admin): "
if "%QLCTV_USER%"=="" (
  echo Chua nhap ten dang nhap.
  pause
  exit /b 1
)
node --no-warnings=ExperimentalWarning scripts\reset-2fa.js "%QLCTV_USER%"
if errorlevel 1 (
  echo.
  echo Dat lai that bai, xem thong bao loi o tren.
)
pause
