@echo off
rem AI Tools Panel double-click launcher (User request 2026-09-02).
rem Keeps this console open for logs; closing the window stops the service.
setlocal
title AI Tools Panel
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [AI Tools Panel] Node.js not found. Install Node.js 22+ from https://nodejs.org and retry.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies - first run, this can take a few minutes...
    call npm install
    if errorlevel 1 (
        echo npm install failed. See output above.
        pause
        exit /b 1
    )
)

if not exist "apps\local-agent\dist\main.js" (
    echo Building packages - first run only...
    call npm run build
    if errorlevel 1 (
        echo Build failed. Run "npm run verify" for details.
        pause
        exit /b 1
    )
)

echo Starting AI Tools Panel...
node "apps\local-agent\dist\start.js" --open
echo.
echo Panel stopped.
pause
