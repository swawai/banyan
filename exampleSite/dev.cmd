@echo off
setlocal

set "EXAMPLE_DIR=%~dp0"

cd /d "%EXAMPLE_DIR%"

npm run dev
