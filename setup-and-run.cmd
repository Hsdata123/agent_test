@echo off
setlocal
cd /d "%~dp0"
set DATABASE_URL=file:./dev.db

echo.
echo [1/4] Installing dependencies...
call npm.cmd install --no-audit --no-fund
if errorlevel 1 goto :error

echo.
echo [2/4] Preparing database schema...
call npm.cmd run db:push
if errorlevel 1 goto :error

echo.
echo [3/4] Creating demo users...
call npm.cmd run db:seed
if errorlevel 1 goto :error

echo.
echo [4/4] Starting the web app...
echo Open http://localhost:3000 after the server starts.
call npm.cmd run dev
goto :end

:error
echo.
echo Setup failed. Please copy the last error lines and send them to Codex.
pause

:end
endlocal
