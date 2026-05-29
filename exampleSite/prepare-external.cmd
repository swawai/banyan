@echo off
setlocal

set "EXAMPLE_DIR=%~dp0"
cd /d "%EXAMPLE_DIR%"

call npm run prepare:external -- %*
exit /b %errorlevel%
