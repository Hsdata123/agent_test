@echo off
setlocal
cd /d "%~dp0"
set DATABASE_URL=file:./dev.db

echo.
echo This will remove the broken node_modules folder and reinstall dependencies.
echo If npm previously showed ENOSPC, please free at least 2GB on C: first.
echo.
pause

echo [1/5] Removing broken install...
if exist node_modules rmdir /s /q node_modules
if exist package-lock.json del /q package-lock.json

echo.
echo [2/5] Installing dependencies...
call npm.cmd install --no-audit --no-fund
if errorlevel 1 goto :error

echo.
echo [3/5] Preparing database schema...
call npm.cmd run db:push
if errorlevel 1 goto :error

echo.
echo [4/5] Creating demo users...
call npm.cmd run db:seed
if errorlevel 1 goto :error

echo.
echo [5/5] Starting the web app...
echo Open http://localhost:3000 after the server starts.
call npm.cmd run dev
goto :end

:error
echo.
echo Setup failed. Please copy the last error lines and send them to Codex.
pause

:end
endlocal
