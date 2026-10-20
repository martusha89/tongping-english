@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title TongPing

where node >nul 2>nul
if errorlevel 1 (
  echo [Error] Node.js was not found. Install Node.js 20 LTS first: https://nodejs.org/en
  echo        After installation, close this window and double-click the launcher again.
  pause
  exit /b 1
)

for /f %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 20 (
  echo [Error] Node.js is too old, current major version: %NODE_MAJOR%; version 20 or newer is required.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo First run: installing dependencies, only once, about 1-3 minutes...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo [Error] Dependency installation failed. For mainland China networks, first run: npm config set registry https://registry.npmmirror.com
    pause
    exit /b 1
  )
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo Created .env from .env.example, using local Chrome by default.
)

echo.
echo Starting TongPing... Keep this window open; closing it stops TongPing.
echo.
call npm run up
echo.
echo TongPing stopped. If this was unexpected, run npm run doctor in another window and send the output to AI.
pause
