@echo off
if "%~1"=="" (
  echo Usage: scripts\build.cmd PROFILE_JSON OUTPUT_ZIP
  exit /b 2
)
if "%~2"=="" (
  echo Usage: scripts\build.cmd PROFILE_JSON OUTPUT_ZIP
  exit /b 2
)
node "%~dp0..\apps\cli\dist\index.js" build --profile "%~1" --output "%~2"
