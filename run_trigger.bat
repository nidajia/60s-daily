@echo off
rem 供 Windows 计划任务调用：静默运行本地触发器（不弹黑窗）
setlocal
set "PY=C:\Users\nidajia\AppData\Local\Programs\Python\Python312\pythonw.exe"
set "SCRIPT=C:\Users\nidajia\WorkBuddy\2026-10-26-02-34-00\60s-api\local_trigger.py"
if not exist "%PY%" set "PY=pythonw"
start "" /b "%PY%" "%SCRIPT%" %*
endlocal
