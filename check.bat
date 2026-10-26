@echo off
chcp 65001 >nul
cd /d "%~dp0"
python check_urls.py
if errorlevel 1 (
  echo.
  echo 没检测到 python，试试在命令提示符里运行：py check_urls.py
)
echo.
pause
