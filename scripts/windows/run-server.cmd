@echo off
rem Vong lap chay may chu: neu node thoat (loi, kiem tra khoi dong that bai) thi cho 60 giay roi chay lai.
rem Dung: run-server.cmd "duong\dan\node.exe"
cd /d "%~dp0..\.."
if not exist logs mkdir logs
:loop
for %%A in (logs\server.log) do if %%~zA GTR 10485760 move /y logs\server.log logs\server.old.log >nul
"%~1" --no-warnings=ExperimentalWarning src\server.js >> logs\server.log 2>&1
echo [%date% %time%] server exited %errorlevel%, restart in 60s >> logs\server.log
timeout /t 60 /nobreak >nul
goto loop
