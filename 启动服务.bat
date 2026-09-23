@echo off
chcp 65001 >nul
title 小微行业知识库 V3 · 一键启动
cd /d "%~dp0"

echo ============================================================
echo   小微行业知识库管理系统 V3 - 一键启动
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 20 或更高版本
  echo        下载地址: https://nodejs.org/
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do echo   Node 版本: %%v

if not exist "node_modules" (
  echo.
  echo   首次运行，正在安装依赖（需联网，约 1 分钟）...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络
    pause
    exit /b 1
  )
)

if not exist "data\seed.json" (
  echo [错误] 缺少数据文件 data\seed.json，无法启动
  pause
  exit /b 1
)

echo.
echo   正在启动服务...
echo   本机访问地址将在下方显示
echo   关闭本窗口即停止服务
echo.
echo ------------------------------------------------------------
node server.js

pause
