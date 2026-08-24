@echo off
chcp 65001 >nul
node "%~dp0..\apps\cli\dist\index.js" %*
