@echo off
REM PrusaSlicer 自动下载脚本 (Windows)

echo === PrusaSlicer 自动下载工具 ===
echo.

set VERSION=2.8.1
set FILENAME=PrusaSlicer-%VERSION%+win64-202409181019.zip
set DOWNLOAD_URL=https://github.com/prusa3d/PrusaSlicer/releases/download/version_%VERSION%/%FILENAME%
set DOWNLOAD_DIR=downloads\prusaslicer

echo 下载版本: %VERSION%
echo 文件名: %FILENAME%
echo.

REM 创建下载目录
if not exist "%DOWNLOAD_DIR%" mkdir "%DOWNLOAD_DIR%"

echo 开始下载...
echo 下载地址: %DOWNLOAD_URL%
echo.

REM 使用 PowerShell 下载
powershell -Command "& {Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%DOWNLOAD_DIR%\%FILENAME%'}"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [成功] 下载完成!
    echo 文件位置: %DOWNLOAD_DIR%\%FILENAME%
    echo.
    echo 下一步操作:
    echo 1. 解压 %FILENAME%
    echo 2. 运行 prusa-slicer.exe
    echo 3. 将安装目录添加到 PATH
    echo.
    echo 是否现在解压? (Y/N^)
    set /p EXTRACT=
    if /i "%EXTRACT%"=="Y" (
        echo 正在解压...
        powershell -Command "& {Expand-Archive -Path '%DOWNLOAD_DIR%\%FILENAME%' -DestinationPath '%DOWNLOAD_DIR%\PrusaSlicer' -Force}"
        echo 解压完成: %DOWNLOAD_DIR%\PrusaSlicer
    )
) else (
    echo.
    echo [失败] 下载失败
    exit /b 1
)

pause
