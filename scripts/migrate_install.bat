@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================================
echo   4D-Print Installation Script
echo   Run this on the NEW computer
echo ============================================================
echo.
echo   This script will:
echo     1. Check Python 3.10+, Node.js and MySQL are installed
echo     2. Install all required dependencies
echo     3. Configure the MySQL database connection
echo     4. Create required upload folders
echo.
echo   If any software is missing, the script will tell you
echo   where to download it.
echo.
pause

:: ============================================================
:: PHASE 1: Check required software
:: ============================================================

echo.
echo ============================================================
echo   [Phase 1/4] Checking required software
echo ============================================================

:: Check Python 3.10+ (prefer py launcher, then python/python3)
echo.
echo [Check] Looking for Python 3.10+...
set "PYTHON_CMD="
py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1 && set "PYTHON_CMD=py -3"
if not defined PYTHON_CMD (
    python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1 && set "PYTHON_CMD=python"
)
if not defined PYTHON_CMD (
    python3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1 && set "PYTHON_CMD=python3"
)
if not defined PYTHON_CMD (
    echo.
    echo [ERROR] Python 3.10+ not found!
    echo.
    echo   run.py works with Python 3.10+ or the backend .venv.
    echo   Please install it:
    echo     1. Go to: https://www.python.org/downloads/
    echo     2. Download Python 3.10 or later
    echo     3. Run the installer
    echo     4. IMPORTANT: check "Add Python to PATH"
    echo     5. Close this window and re-run the script
    echo.
    pause
    exit /b 1
)
echo [OK] Python found: %PYTHON_CMD%
%PYTHON_CMD% --version

:: ── Check Node.js ───────────────────────────────────────────
echo.
echo [Check] Looking for Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Node.js not found!
    echo.
    echo   Please install it:
    echo     1. Go to: https://nodejs.org/
    echo     2. Download the LTS version
    echo     3. Run the installer (keep all defaults)
    echo     4. Close this window and re-run the script
    echo.
    pause
    exit /b 1
)
echo [OK] Node.js found.
node --version

:: ── Check MySQL ─────────────────────────────────────────────
echo.
echo [Check] Looking for MySQL...
mysql --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] MySQL not found!
    echo.
    echo   Please install MySQL Community Server:
    echo     1. Go to: https://dev.mysql.com/downloads/installer/
    echo     2. Download "MySQL Installer for Windows"
    echo        (click "No thanks, just start my download")
    echo     3. Run the installer
    echo        - Setup type: "Developer Default" or "Server only"
    echo     4. IMPORTANT: remember the root password you set!
    echo     5. Close this window and re-run the script
    echo.
    pause
    exit /b 1
)
echo [OK] MySQL found.
mysql --version

:: ============================================================
:: PHASE 2: Configure database
:: ============================================================

echo.
echo ============================================================
echo   [Phase 2/4] Configure database connection
echo ============================================================
echo.
echo   You will be asked for your MySQL connection details.
echo   These were set when you installed MySQL.
echo.

set /p "DB_HOST=MySQL host address (press Enter for default: localhost): "
if "!DB_HOST!"=="" set "DB_HOST=localhost"

set /p "DB_PORT=MySQL port (press Enter for default: 3306): "
if "!DB_PORT!"=="" set "DB_PORT=3306"

set /p "DB_USER=MySQL username (press Enter for default: root): "
if "!DB_USER!"=="" set "DB_USER=root"

echo.
echo   Next: enter your MySQL password.
echo   NOTE: no characters will appear as you type - this is normal.
echo   NOTE: do not use the @ symbol in your password.
echo.
set /p "DB_PASS=MySQL password: "

set /p "DB_NAME=Database name (press Enter for default: makerworld): "
if "!DB_NAME!"=="" set "DB_NAME=makerworld"

echo.
echo [Info] Connection summary:
echo        Host : !DB_HOST!
echo        Port : !DB_PORT!
echo        User : !DB_USER!
echo        Pass : (hidden)
echo        DB   : !DB_NAME!
echo.

:: ── Test MySQL connection ───────────────────────────────────
echo [Check] Testing MySQL connection...
mysql -h !DB_HOST! -P !DB_PORT! -u !DB_USER! -p!DB_PASS! -e "SELECT 1;" >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Cannot connect to MySQL!
    echo.
    echo   Possible causes:
    echo     - Wrong password
    echo     - MySQL service is not running
    echo     - Wrong username
    echo.
    echo   How to fix:
    echo     1. Press Win+R, type services.msc, press Enter
    echo        Find "MySQL..." service and make sure it is Running
    echo     2. Re-run this script and enter the correct credentials
    echo.
    pause
    exit /b 1
)
echo [OK] MySQL connection successful!

:: ── Create database if not exists ──────────────────────────
echo.
echo [Check] Checking if database '!DB_NAME!' exists...
mysql -h !DB_HOST! -P !DB_PORT! -u !DB_USER! -p!DB_PASS! -e "SHOW DATABASES LIKE '!DB_NAME!';" 2>nul | findstr "!DB_NAME!" >nul
if errorlevel 1 (
    echo [Info] Database '!DB_NAME!' does not exist. Creating...
    mysql -h !DB_HOST! -P !DB_PORT! -u !DB_USER! -p!DB_PASS! -e "CREATE DATABASE IF NOT EXISTS `!DB_NAME!` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>nul
    if errorlevel 1 (
        echo [ERROR] Failed to create database!
        echo         Make sure user '!DB_USER!' has CREATE DATABASE permission.
        pause
        exit /b 1
    )
    echo [OK] Database '!DB_NAME!' created.
) else (
    echo [OK] Database '!DB_NAME!' already exists.
)

:: ============================================================
:: PHASE 3: Write config files
:: ============================================================

echo.
echo ============================================================
echo   [Phase 3/4] Writing config files
echo ============================================================

set "PROJECT_ROOT=%~dp0.."
pushd "%PROJECT_ROOT%"
set "PROJECT_ROOT=%CD%"
popd
echo [Info] Project location: %PROJECT_ROOT%

:: ── Create backend .env if missing ─────────────────────────
set "ENV_FILE=%PROJECT_ROOT%\backend\.env"

if not exist "!ENV_FILE!" (
    if exist "%PROJECT_ROOT%\backend\.env.example" (
        copy "%PROJECT_ROOT%\backend\.env.example" "!ENV_FILE!" >nul
        echo [Info] Created backend\.env from template.
    ) else (
        echo. > "!ENV_FILE!"
        echo [Info] Created blank backend\.env
    )
) else (
    echo [OK] backend\.env already exists. Will update DATABASE_URL.
)

:: ── Write DATABASE_URL via Python (safe for special chars) ──
echo [Run] Writing DATABASE_URL to backend\.env ...

set "ENV_DB_HOST=!DB_HOST!"
set "ENV_DB_PORT=!DB_PORT!"
set "ENV_DB_USER=!DB_USER!"
set "ENV_DB_PASS=!DB_PASS!"
set "ENV_DB_NAME=!DB_NAME!"
set "ENV_FILE_PATH=!ENV_FILE!"

%PYTHON_CMD% -c "import os,re; h=os.environ['ENV_DB_HOST']; p=os.environ['ENV_DB_PORT']; u=os.environ['ENV_DB_USER']; pw=os.environ['ENV_DB_PASS']; n=os.environ['ENV_DB_NAME']; f=os.environ['ENV_FILE_PATH']; url='mysql+pymysql://'+u+':'+pw+'@'+h+':'+p+'/'+n; txt=open(f,encoding='utf-8').read() if os.path.exists(f) else ''; txt=re.sub(r'DATABASE_URL=.*',  'DATABASE_URL='+url, txt) if 'DATABASE_URL=' in txt else txt.rstrip()+'\nDATABASE_URL='+url+'\n'; open(f,'w',encoding='utf-8').write(txt); print('[OK] DATABASE_URL written.')"

if errorlevel 1 (
    echo [ERROR] Failed to write config!
    echo         Please manually add this line to backend\.env:
    echo         DATABASE_URL=mysql+pymysql://!DB_USER!:PASSWORD@!DB_HOST!:!DB_PORT!/!DB_NAME!
    pause
    exit /b 1
)

echo [OK] DATABASE_URL written: mysql+pymysql://!DB_USER!:***@!DB_HOST!:!DB_PORT!/!DB_NAME!

:: ── Create frontend .env if missing ────────────────────────
if not exist "%PROJECT_ROOT%\frontend\.env" (
    if exist "%PROJECT_ROOT%\frontend\.env.example" (
        copy "%PROJECT_ROOT%\frontend\.env.example" "%PROJECT_ROOT%\frontend\.env" >nul
        echo [OK] Created frontend\.env from template.
    )
) else (
    echo [OK] frontend\.env already exists.
)

:: ============================================================
:: PHASE 4: Install dependencies
:: ============================================================

echo.
echo ============================================================
echo   [Phase 4/4] Installing dependencies
echo ============================================================

:: ── Python backend dependencies ─────────────────────────────
echo.
echo [Step 4a] Installing Python dependencies (5-10 min)...

cd /d "%PROJECT_ROOT%\backend"

if exist "venv" (
    echo [Info] Removing old virtual environment...
    rmdir /s /q "venv"
)

%PYTHON_CMD% -m venv venv
if errorlevel 1 (
    echo [ERROR] Failed to create Python virtual environment!
    pause
    exit /b 1
)

call venv\Scripts\activate.bat
python -m pip install --upgrade pip --quiet

echo [Run] Installing requirements.txt...
pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo [ERROR] Dependency installation failed! Check your internet connection.
    pause
    exit /b 1
)

echo [OK] Python dependencies installed.

:: ── Node.js frontend dependencies ───────────────────────────
echo.
echo [Step 4b] Installing Node.js dependencies (5-10 min)...

cd /d "%PROJECT_ROOT%\frontend"
npm install
if errorlevel 1 (
    echo [ERROR] Frontend dependency installation failed!
    pause
    exit /b 1
)
echo [OK] Node.js dependencies installed.

:: ── Create required upload directories ──────────────────────
cd /d "%PROJECT_ROOT%\backend"
if not exist "uploads"             mkdir "uploads"
if not exist "uploads\thumbnails"  mkdir "uploads\thumbnails"
if not exist "uploads\temp"        mkdir "uploads\temp"
if not exist "uploads\avatars"     mkdir "uploads\avatars"
if not exist "uploads\models"      mkdir "uploads\models"
if not exist "uploads\slices"      mkdir "uploads\slices"

:: ============================================================
:: Done
:: ============================================================

echo.
echo ============================================================
echo   Installation complete!
echo.
echo   Database configured:
echo     Host : !DB_HOST!:!DB_PORT!
echo     User : !DB_USER!
echo     DB   : !DB_NAME!
echo.
echo   BEFORE starting the app, open this file in Notepad:
echo     %PROJECT_ROOT%\backend\.env
echo.
echo   Fill in these required fields:
echo     TRIPO_API_KEY=   (must start with tsk_)
echo     JWT_SECRET_KEY=  (replace with a random string)
echo     HTTP_PROXY=      (DELETE this line if you have no proxy software)
echo.
echo   See the migration guide (Migration_Guide.md) for details.
echo.
echo   To start the app: double-click run.py
echo ============================================================
echo.
pause
