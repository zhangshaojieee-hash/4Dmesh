@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================================
echo   4D-Print Migration Export Script
echo   Run this on the OLD computer
echo ============================================================
echo.

:: Check PowerShell availability
where powershell >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell not found. Cannot continue.
    pause
    exit /b 1
)

:: Determine project root directory
set "PROJECT_ROOT=%~dp0.."
pushd "%PROJECT_ROOT%"
set "PROJECT_ROOT=%CD%"
popd

echo [INFO] Project location: %PROJECT_ROOT%
echo.

:: Export directory - use English name only to avoid encoding issues
set "EXPORT_DIR=%USERPROFILE%\Desktop\4DPrint_Export"
set "ZIP_PATH=%USERPROFILE%\Desktop\4DPrint_Migration.zip"

:: Copy exclude file to TEMP path (no spaces, no Chinese) for xcopy /EXCLUDE
set "EXCL=%TEMP%\4dp_excl.txt"
copy /Y "%PROJECT_ROOT%\scripts\migrate_exclude.txt" "%EXCL%" >nul 2>&1
if not exist "%EXCL%" (
    echo [ERROR] Cannot copy exclude list to temp.
    pause
    exit /b 1
)

:: Clean up old export folder
if exist "%EXPORT_DIR%" (
    echo [INFO] Removing old export folder...
    rmdir /s /q "%EXPORT_DIR%"
)
mkdir "%EXPORT_DIR%"

echo [Step 1/5] Copying backend...
xcopy "%PROJECT_ROOT%\backend" "%EXPORT_DIR%\backend" /E /I /H /Y /EXCLUDE:%EXCL% >nul
if errorlevel 1 ( echo [WARN] Some backend files may have been skipped. )

echo [Step 2/5] Copying frontend...
xcopy "%PROJECT_ROOT%\frontend" "%EXPORT_DIR%\frontend" /E /I /H /Y /EXCLUDE:%EXCL% >nul
if errorlevel 1 ( echo [WARN] Some frontend files may have been skipped. )

echo [Step 3/5] Copying root files...
for %%F in (
    "run.py"
    "SETUP.md"
    "PIPELINE.md"
    "goal.md"
    ".gitignore"
    "install-prusaslicer.bat"
) do (
    if exist "%PROJECT_ROOT%\%%~F" (
        copy /Y "%PROJECT_ROOT%\%%~F" "%EXPORT_DIR%\%%~F" >nul
    )
)

echo [Step 4/5] Copying scripts directory...
if exist "%PROJECT_ROOT%\scripts" (
    xcopy "%PROJECT_ROOT%\scripts" "%EXPORT_DIR%\scripts" /E /I /H /Y >nul
)

:: Also copy migration guide (Chinese filename handled via PowerShell)
powershell -NoProfile -Command ^
    "$src = '%PROJECT_ROOT%'; $dst = '%EXPORT_DIR%'; Get-ChildItem $src -Filter '*.md' | ForEach-Object { Copy-Item $_.FullName -Destination $dst -Force }"

echo [Step 5/5] Creating ZIP archive...
if exist "%ZIP_PATH%" del /f /q "%ZIP_PATH%"

powershell -NoProfile -Command ^
    "Compress-Archive -Path '%EXPORT_DIR%\*' -DestinationPath '%ZIP_PATH%' -Force"

if errorlevel 1 (
    echo.
    echo [ERROR] ZIP compression failed!
    echo You can manually zip the folder on your Desktop: 4DPrint_Export
) else (
    echo.
    echo [OK] ZIP created: %ZIP_PATH%
)

:: Cleanup temp exclude file
del /f /q "%EXCL%" >nul 2>&1

echo.
echo ============================================================
echo   Export complete!
echo.
echo   Copy this file to your USB drive / new computer:
echo     %ZIP_PATH%
echo.
echo   Then run migrate_install.bat on the new computer.
echo ============================================================
echo.
pause
