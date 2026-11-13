@echo off
setlocal

set "BAT=%~dp0run_trigger.bat"
if not exist "%BAT%" (
  echo [错误] 同目录下找不到 run_trigger.bat
  pause
  exit /b 1
)
if not exist "%~dp0local_trigger.py" (
  echo [错误] 同目录下找不到 local_trigger.py
  pause
  exit /b 1
)

echo ============================================================
echo  安装「60秒日报本地兜底触发器」
echo ============================================================
echo.
echo 作用：GitHub 的定时任务会被延迟甚至丢弃，本机每天替它叫醒一次。
echo 将创建两个计划任务：
echo   1. Daily60sReport        每天 08:20 检查
echo   2. Daily60sReport_Logon  每次开机登录时检查（补上错过了 08:20 的情况）
echo.
echo 注意：只有在「已更新」判断为否时才会触发，不会重复生成。
echo.
pause

echo.
echo [1/2] 注册每日 08:20 ...
schtasks /Create /TN "Daily60sReport" /TR "%BAT%" /SC DAILY /ST 08:20 /F
if errorlevel 1 goto fail

echo.
echo [2/2] 注册登录时检查 ...
schtasks /Create /TN "Daily60sReport_Logon" /TR "%BAT%" /SC ONLOGON /F
if errorlevel 1 (
  echo [警告] 登录触发器创建失败，不影响每日 08:20 那个，可忽略
)

echo.
echo ============================================================
echo  安装完成
echo ============================================================
echo  查看运行记录：%~dp0trigger.log
echo  立即测试一次：双击 run_trigger.bat 后稍等，看 trigger.log
echo  卸载：双击「卸载计划任务.bat」，或运行
echo        schtasks /Delete /TN "Daily60sReport" /F
echo        schtasks /Delete /TN "Daily60sReport_Logon" /F
echo.
pause
exit /b 0

:fail
echo.
echo [失败] 计划任务创建被拒绝。
echo 解决办法：右键「以管理员身份运行」本文件再试一次。
echo.
pause
exit /b 1
