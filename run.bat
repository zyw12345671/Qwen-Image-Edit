@echo off
echo ========================================
echo    Qwen Image Edit - 启动服务器
echo ========================================
echo.

cd /d "%~dp0"

echo 正在启动服务器...
echo.
echo 启动成功！请在浏览器中打开: http://localhost:3000
echo.
echo 按 Ctrl+C 可停止服务器
echo.

call npm start

pause