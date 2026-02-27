@echo off
echo ========================================
echo    Qwen Image Edit - 一键启动
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] 检查并安装依赖...
if not exist node_modules (
    echo 正在安装依赖，请稍候...
    call npm install
    if errorlevel 1 (
        echo 依赖安装失败！
        pause
        exit /b 1
    )
)

echo.
echo [2/3] 构建前端...
call npm run build
if errorlevel 1 (
    echo 前端构建失败！
    pause
    exit /b 1
)

echo.
echo [3/3] 启动服务器...
echo.
echo 启动成功！请在浏览器中打开: http://localhost:3000
echo.
echo 按 Ctrl+C 可停止服务器
echo.

call npm start

pause