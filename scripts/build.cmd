@echo off
if "%~1"=="" (
  echo Usage: scripts\build.cmd PROFILE_JSON OUTPUT_ZIP [LIBRARY_DIR]
  exit /b 2
)
if "%~2"=="" (
  echo Usage: scripts\build.cmd PROFILE_JSON OUTPUT_ZIP [LIBRARY_DIR]
  exit /b 2
)
if "%~3"=="" (
  node "%~dp0..\apps\cli\dist\index.js" build --profile "%~1" --output "%~2"
) else (
  node "%~dp0..\apps\cli\dist\index.js" build --profile "%~1" --output "%~2" --library "%~3"
)
