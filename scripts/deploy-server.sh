#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="4d-print"
APP_DIR="/opt/4d-print"
DATA_DIR="/var/lib/4d-print"
DOMAIN="_"
API_PORT="8000"
MIRROR="china"
INSTALL_PRUSASLICER="auto"
NODE_MAJOR="20"
PYTHON_BIN="python3"
PYTHON_BIN_EXPLICIT="no"
PYTHON_BIN_CANDIDATES=("python3.12" "python3.11" "python3.10" "python3")
BUILD_FRONTEND="yes"
FRONTEND_BUILD_NODE_OPTIONS="${FRONTEND_BUILD_NODE_OPTIONS:---max-old-space-size=768}"
FRONTEND_DIST_SRC=""
MYSQL_HOST="localhost"
MYSQL_PORT="3306"
MYSQL_USER="makerworld"
MYSQL_NAME="makerworld"
MYSQL_PASSWORD=""
MIGRATE_SQLITE="no"
SOURCE_SQLITE_DB=""
OS_ID=""
OS_VERSION_CODENAME=""
OS_FAMILY=""
PKG_MGR=""
NGINX_SITE_DIR=""
NGINX_CONF_FILE=""

log() {
  printf '\033[1;34m[%s]\033[0m %s\n' "$(date '+%H:%M:%S')" "$*"
}

python_is_compatible() {
  local cmd=("$@")
  "${cmd[@]}" - <<'PY'
import sys
raise SystemExit(0 if sys.version_info >= (3, 10) else 1)
PY
}

warn() {
  printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2
}

die() {
  printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2
  exit 1
}

run() {
  log "$*"
  "$@"
}

usage() {
  cat <<'USAGE'
Usage: sudo bash scripts/deploy-server.sh [options]

Options:
  --domain DOMAIN              Nginx server_name. Default: _
  --app-dir PATH               Deployment directory. Default: /opt/4d-print
  --data-dir PATH              Runtime data directory. Default: /var/lib/4d-print
  --api-port PORT              Local FastAPI port. Default: 8000
  --mirror china|default       Use fast China mirrors for apt/pip/npm. Default: china
  --install-prusaslicer        Install PrusaSlicer if missing.
  --skip-prusaslicer           Do not install PrusaSlicer.
  --python-bin COMMAND         Python executable used for venv/build. Default: python3
  --skip-frontend-build        Skip frontend npm install/build on the server.
  --frontend-dist PATH         Copy a prebuilt frontend/dist directory from PATH.
  --mysql-host HOST            MySQL host for backend/.env. Default: localhost
  --mysql-port PORT            MySQL port for backend/.env. Default: 3306
  --mysql-user USER            MySQL user for backend/.env. Default: makerworld
  --mysql-name NAME            MySQL database name. Default: makerworld
  --mysql-password PASS        MySQL password for backend/.env.
  --migrate-sqlite             Import the existing SQLite server database into MySQL.
  --source-sqlite PATH         Source SQLite database for migration. Default: backend/makerworld.db
  -h, --help                   Show help.

Environment created:
  backend/.env                 Created only when missing.
  frontend/.env.production     Created/updated for same-domain /api deployment.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="${2:?Missing value for --domain}"
      shift 2
      ;;
    --app-dir)
      APP_DIR="${2:?Missing value for --app-dir}"
      shift 2
      ;;
    --data-dir)
      DATA_DIR="${2:?Missing value for --data-dir}"
      shift 2
      ;;
    --api-port)
      API_PORT="${2:?Missing value for --api-port}"
      shift 2
      ;;
    --mirror)
      MIRROR="${2:?Missing value for --mirror}"
      shift 2
      ;;
    --install-prusaslicer)
      INSTALL_PRUSASLICER="yes"
      shift
      ;;
    --skip-prusaslicer)
      INSTALL_PRUSASLICER="no"
      shift
      ;;
    --python-bin)
      PYTHON_BIN="${2:?Missing value for --python-bin}"
      PYTHON_BIN_EXPLICIT="yes"
      shift 2
      ;;
    --skip-frontend-build)
      BUILD_FRONTEND="no"
      shift
      ;;
    --frontend-dist)
      FRONTEND_DIST_SRC="${2:?Missing value for --frontend-dist}"
      shift 2
      ;;
    --mysql-host)
      MYSQL_HOST="${2:?Missing value for --mysql-host}"
      shift 2
      ;;
    --mysql-port)
      MYSQL_PORT="${2:?Missing value for --mysql-port}"
      shift 2
      ;;
    --mysql-user)
      MYSQL_USER="${2:?Missing value for --mysql-user}"
      shift 2
      ;;
    --mysql-name)
      MYSQL_NAME="${2:?Missing value for --mysql-name}"
      shift 2
      ;;
    --mysql-password)
      MYSQL_PASSWORD="${2:?Missing value for --mysql-password}"
      shift 2
      ;;
    --migrate-sqlite)
      MIGRATE_SQLITE="yes"
      shift
      ;;
    --source-sqlite)
      SOURCE_SQLITE_DB="${2:?Missing value for --source-sqlite}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || die "Run as root: sudo bash scripts/deploy-server.sh"
[[ "$MIRROR" == "china" || "$MIRROR" == "default" ]] || die "--mirror must be china or default"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ ! -f "$REPO_DIR/backend/main.py" || ! -f "$REPO_DIR/frontend/package.json" ]]; then
  die "Run this script from the 4D-Print repository, or keep it under scripts/."
fi

source_os_release() {
  [[ -r /etc/os-release ]] || die "/etc/os-release not found"
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="${ID:-}"
  OS_VERSION_CODENAME="${VERSION_CODENAME:-}"
}

detect_platform() {
  source_os_release
  if command -v apt-get >/dev/null 2>&1; then
    PKG_MGR="apt"
    OS_FAMILY="debian"
    NGINX_SITE_DIR="/etc/nginx/sites-available"
    NGINX_CONF_FILE=""
    return 0
  fi
  if command -v dnf >/dev/null 2>&1; then
    PKG_MGR="dnf"
    OS_FAMILY="rhel"
    NGINX_SITE_DIR=""
    NGINX_CONF_FILE="/etc/nginx/conf.d/${APP_NAME}.conf"
    return 0
  fi
  if command -v yum >/dev/null 2>&1; then
    PKG_MGR="yum"
    OS_FAMILY="rhel"
    NGINX_SITE_DIR=""
    NGINX_CONF_FILE="/etc/nginx/conf.d/${APP_NAME}.conf"
    return 0
  fi
  die "No supported package manager found (apt-get, dnf, yum). Detected OS: ${OS_ID:-unknown}"
}

configure_apt_mirror() {
  [[ "$PKG_MGR" == "apt" ]] || return 0
  [[ "$MIRROR" == "china" ]] || return 0

  local backup_dir="/etc/apt/backup-${APP_NAME}-$(date +%Y%m%d%H%M%S)"
  run mkdir -p "$backup_dir"

  if [[ -f /etc/apt/sources.list ]]; then
    run cp /etc/apt/sources.list "$backup_dir/sources.list"
  fi
  if [[ -d /etc/apt/sources.list.d ]]; then
    run cp -a /etc/apt/sources.list.d "$backup_dir/sources.list.d"
  fi

  if [[ "$OS_ID" == "ubuntu" ]]; then
    cat >/etc/apt/sources.list <<EOF
deb https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ ${OS_VERSION_CODENAME} main restricted universe multiverse
deb https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ ${OS_VERSION_CODENAME}-updates main restricted universe multiverse
deb https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ ${OS_VERSION_CODENAME}-backports main restricted universe multiverse
deb https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ ${OS_VERSION_CODENAME}-security main restricted universe multiverse
EOF
  else
    cat >/etc/apt/sources.list <<EOF
deb https://mirrors.tuna.tsinghua.edu.cn/debian/ ${OS_VERSION_CODENAME} main contrib non-free non-free-firmware
deb https://mirrors.tuna.tsinghua.edu.cn/debian/ ${OS_VERSION_CODENAME}-updates main contrib non-free non-free-firmware
deb https://mirrors.tuna.tsinghua.edu.cn/debian-security ${OS_VERSION_CODENAME}-security main contrib non-free non-free-firmware
EOF
  fi

  log "Apt sources backed up to $backup_dir and switched to Tsinghua mirror."
}

pkg_update() {
  case "$PKG_MGR" in
    apt)
      run apt-get update
      ;;
    dnf)
      run dnf -y makecache
      ;;
    yum)
      run yum makecache -y
      ;;
    *)
      die "Unsupported package manager: $PKG_MGR"
      ;;
  esac
}

pkg_install() {
  case "$PKG_MGR" in
    apt)
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
      ;;
    dnf)
      dnf install -y "$@"
      ;;
    yum)
      yum install -y "$@"
      ;;
    *)
      die "Unsupported package manager: $PKG_MGR"
      ;;
  esac
}

install_base_packages() {
  pkg_update

  if [[ "$PKG_MGR" == "apt" ]]; then
    pkg_install \
      ca-certificates curl wget gnupg lsb-release git rsync nginx build-essential pkg-config \
      python3 python3-venv python3-dev \
      libgl1 libglib2.0-0 libgomp1 libegl1 libopengl0 libxrender1 libxext6 libsm6 \
      libdbus-1-3 libfontconfig1 libfreetype6 libx11-6 libxcb1 libxkbcommon0 libxi6
  else
    pkg_install \
      ca-certificates curl wget gnupg2 git rsync nginx gcc gcc-c++ make pkgconf-pkg-config \
      python3 python3-pip python3-devel \
      libglvnd-glx mesa-libGL mesa-libEGL mesa-libGLU glib2 libgomp dbus-libs \
      fontconfig freetype libX11 libxcb libxkbcommon libXi libXext libXrender libSM
  fi

  if [[ "$PYTHON_BIN_EXPLICIT" == "no" ]]; then
    for candidate in "${PYTHON_BIN_CANDIDATES[@]}"; do
      if command -v "$candidate" >/dev/null 2>&1 && python_is_compatible "$candidate"; then
        PYTHON_BIN="$candidate"
        break
      fi
    done
  fi

  command -v "$PYTHON_BIN" >/dev/null 2>&1 || die "Python executable not found after package install: $PYTHON_BIN"
  python_is_compatible "$PYTHON_BIN" || die "Python 3.10+ is required for backend builds: $PYTHON_BIN"
}

node_major_version() {
  if ! command -v node >/dev/null 2>&1; then
    echo 0
    return
  fi
  node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0
}

install_node_if_needed() {
  [[ "$BUILD_FRONTEND" == "yes" ]] || return 0
  local current_major
  current_major="$(node_major_version)"
  if [[ "$current_major" -ge "$NODE_MAJOR" ]]; then
    log "Node.js $(node --version) is suitable."
    return 0
  fi

  log "Node.js ${NODE_MAJOR}.x is required; installing NodeSource package."
  local nodesource_base="https://deb.nodesource.com"
  if [[ "$MIRROR" == "china" ]]; then
    nodesource_base="https://mirrors.tuna.tsinghua.edu.cn/nodesource"
  fi
  if [[ "$PKG_MGR" == "apt" ]]; then
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL "${nodesource_base}/gpgkey/nodesource-repo.gpg.key" \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] ${nodesource_base}/node_${NODE_MAJOR}.x nodistro main" \
      >/etc/apt/sources.list.d/nodesource.list
    pkg_update
    pkg_install nodejs
  else
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    if [[ "$MIRROR" == "china" && -f /etc/yum.repos.d/nodesource-nodejs.repo ]]; then
      sed -i "s#https://rpm.nodesource.com#https://mirrors.tuna.tsinghua.edu.cn/nodesource/rpm#g" /etc/yum.repos.d/nodesource-nodejs.repo
    fi
    pkg_update
    pkg_install nodejs
  fi

  current_major="$(node_major_version)"
  [[ "$current_major" -ge "$NODE_MAJOR" ]] || die "Node.js installation failed or version is too old."
}

configure_language_mirrors() {
  [[ "$MIRROR" == "china" ]] || return 0
  if [[ "$BUILD_FRONTEND" == "yes" ]]; then
    run npm config set registry https://registry.npmmirror.com
  fi
  export PIP_INDEX_URL="https://pypi.tuna.tsinghua.edu.cn/simple"
  export PIP_TRUSTED_HOST="pypi.tuna.tsinghua.edu.cn"
}

install_prusaslicer_if_needed() {
  if command -v prusa-slicer >/dev/null 2>&1; then
    log "PrusaSlicer found: $(command -v prusa-slicer)"
    return 0
  fi

  if [[ "$INSTALL_PRUSASLICER" == "no" ]]; then
    warn "PrusaSlicer is missing; slicing features will be unavailable."
    return 0
  fi

  log "PrusaSlicer is missing; trying package-manager install."
  if [[ "$PKG_MGR" == "apt" ]]; then
    if apt-cache show prusa-slicer >/dev/null 2>&1; then
      pkg_install prusa-slicer || warn "apt could not install prusa-slicer."
    fi
  else
    if "$PKG_MGR" list prusa-slicer >/dev/null 2>&1; then
      pkg_install prusa-slicer || warn "$PKG_MGR could not install prusa-slicer."
    fi
  fi

  if ! command -v prusa-slicer >/dev/null 2>&1; then
    warn "PrusaSlicer was not installed. Set PRUSASLICER_PATH manually or rerun after enabling a package source that provides it."
    if [[ "$INSTALL_PRUSASLICER" == "yes" ]]; then
      die "PrusaSlicer was requested but could not be installed."
    fi
    return 0
  fi
}

sync_code_to_app_dir() {
  run mkdir -p "$APP_DIR"
  run rsync -a --delete \
    --exclude .git \
    --exclude .codegraph \
    --exclude .history \
    --exclude .pytest_cache \
    --exclude node_modules \
    --exclude frontend/node_modules \
    --exclude frontend/dist \
    --exclude backend/.venv \
    --exclude backend/venv \
    --exclude backend/uploads \
    --exclude backend/.env \
    --exclude frontend/.env \
    "$REPO_DIR/" "$APP_DIR/"
  run chmod -R a+rX "$APP_DIR"
}

generate_secret() {
  "$PYTHON_BIN" - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
}

url_encode() {
  "$PYTHON_BIN" - "$1" <<'PY'
import sys
from urllib.parse import quote

print(quote(sys.argv[1], safe=""))
PY
}

mysql_database_url() {
  local encoded_user
  local encoded_password
  encoded_user="$(url_encode "$MYSQL_USER")"
  encoded_password="$(url_encode "$MYSQL_PASSWORD")"
  printf 'mysql+pymysql://%s:%s@%s:%s/%s\n' \
    "$encoded_user" "$encoded_password" "$MYSQL_HOST" "$MYSQL_PORT" "$MYSQL_NAME"
}

service_user_name() {
  if [[ "$OS_FAMILY" == "rhel" ]]; then
    echo "nginx"
  else
    echo "www-data"
  fi
}

detect_prusaslicer_path() {
  command -v prusa-slicer-console 2>/dev/null \
    || command -v prusa-slicer 2>/dev/null \
    || command -v prusaslicer 2>/dev/null \
    || true
}

ensure_service_user() {
  local user_name
  user_name="$(service_user_name)"
  if id -u "$user_name" >/dev/null 2>&1; then
    return 0
  fi
  if [[ "$user_name" == "nginx" ]]; then
    run useradd --system --no-create-home --shell /sbin/nologin nginx
    return 0
  fi
  die "Required service user does not exist: $user_name"
}

secure_backend_env() {
  local env_file="$APP_DIR/backend/.env"
  local user_name
  user_name="$(service_user_name)"
  [[ -f "$env_file" ]] || die "backend/.env missing: $env_file"
  run chown "root:${user_name}" "$env_file"
  run chmod 640 "$env_file"
}

ensure_backend_env() {
  local env_file="$APP_DIR/backend/.env"
  local cors_origin
  local mysql_url
  if [[ "$DOMAIN" == "_" ]]; then
    cors_origin="http://localhost"
  else
    cors_origin="https://${DOMAIN},http://${DOMAIN}"
  fi
  mysql_url="$(mysql_database_url)"

  if [[ -f "$env_file" ]]; then
    log "Keeping existing backend/.env"
    grep -q '^DATA_DIR=' "$env_file" || echo "DATA_DIR=${DATA_DIR}" >>"$env_file"
    grep -q '^UPLOAD_ROOT=' "$env_file" || echo "UPLOAD_ROOT=${DATA_DIR}/uploads" >>"$env_file"
    grep -q '^DATABASE_URL=' "$env_file" || echo "DATABASE_URL=${mysql_url}" >>"$env_file"
    grep -q '^CORS_ORIGINS=' "$env_file" || echo "CORS_ORIGINS=${cors_origin}" >>"$env_file"
    grep -q '^PRUSASLICER_PATH=' "$env_file" || echo "PRUSASLICER_PATH=$(detect_prusaslicer_path)" >>"$env_file"
    secure_backend_env
    return 0
  fi

  local secret
  secret="$(generate_secret)"
  cat >"$env_file" <<EOF
DATABASE_URL=${mysql_url}
DATA_DIR=${DATA_DIR}
UPLOAD_ROOT=${DATA_DIR}/uploads
JWT_SECRET_KEY=${secret}
CORS_ORIGINS=${cors_origin}
TRIPO_API_KEY=
OPENAI_API_KEY=
IFLYTEK_APP_ID=
IFLYTEK_API_KEY=
IFLYTEK_API_SECRET=
SPARK_API_PASSWORD=
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM=
SMTP_USE_TLS=true
PRUSASLICER_PATH=$(detect_prusaslicer_path)
MOONRAKER_URL=http://localhost:7125
EOF
  secure_backend_env
}

run_sqlite_migration() {
  [[ "$MIGRATE_SQLITE" == "yes" ]] || return 0
  local backend_python="$APP_DIR/backend/.venv/bin/python"
  local source_sqlite
  source_sqlite="${SOURCE_SQLITE_DB:-$APP_DIR/backend/makerworld.db}"
  [[ -f "$source_sqlite" ]] || die "SQLite source database not found: $source_sqlite"
  [[ -f "$APP_DIR/scripts/migrate_sqlite_to_mysql.py" ]] || die "Migration script missing: $APP_DIR/scripts/migrate_sqlite_to_mysql.py"
  [[ -x "$backend_python" ]] || die "Backend virtualenv Python not found: $backend_python"
  run "$backend_python" "$APP_DIR/scripts/migrate_sqlite_to_mysql.py" \
    --source-sqlite "$source_sqlite" \
    --mysql-url "$(mysql_database_url)" \
    --upload-root "${DATA_DIR}/uploads" \
    --env-file "$APP_DIR/backend/.env"
}

prepare_runtime_dirs() {
  run mkdir -p "$DATA_DIR/uploads" "$DATA_DIR/backups"
  local web_user
  web_user="$(service_user_name)"
  ensure_service_user
  run chown -R "${web_user}:${web_user}" "$DATA_DIR"
}

build_backend() {
  cd "$APP_DIR/backend"
  command -v "$PYTHON_BIN" >/dev/null 2>&1 || die "Python executable not found: $PYTHON_BIN"
  run "$PYTHON_BIN" -m venv .venv
  # shellcheck disable=SC1091
  . .venv/bin/activate
  python -m pip install --upgrade pip setuptools wheel
  if [[ "$MIRROR" == "china" ]]; then
    pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
  fi
  pip install -r requirements.txt
  python -m compileall app main.py
}

build_frontend() {
  if [[ "$BUILD_FRONTEND" == "no" ]]; then
    if [[ -n "$FRONTEND_DIST_SRC" ]]; then
      [[ -d "$FRONTEND_DIST_SRC" ]] || die "frontend dist source not found: $FRONTEND_DIST_SRC"
      run mkdir -p "$APP_DIR/frontend/dist"
      run rsync -a --delete "${FRONTEND_DIST_SRC%/}/" "$APP_DIR/frontend/dist/"
      return 0
    fi
    if [[ -d "$APP_DIR/frontend/dist" ]]; then
      log "Skipping frontend build; keeping existing frontend/dist."
      return 0
    fi
    die "frontend/dist is missing. Provide --frontend-dist PATH or allow server build."
  fi
  cd "$APP_DIR/frontend"
  cat >.env.production <<'EOF'
VITE_API_BASE_URL=/api
EOF
  run npm ci
  run env NODE_OPTIONS="$FRONTEND_BUILD_NODE_OPTIONS" npm run build
}

write_systemd_service() {
  local service_user
  local service_group
  service_user="$(service_user_name)"
  service_group="$service_user"
  ensure_service_user
  cat >/etc/systemd/system/${APP_NAME}-api.service <<EOF
[Unit]
Description=4D-Print FastAPI
After=network.target

[Service]
User=${service_user}
Group=${service_group}
WorkingDirectory=${APP_DIR}/backend
EnvironmentFile=${APP_DIR}/backend/.env
ExecStart=${APP_DIR}/backend/.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port ${API_PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  run systemctl daemon-reload
  run systemctl enable --now "${APP_NAME}-api.service"
}

write_nginx_site() {
  if [[ "$PKG_MGR" == "apt" ]]; then
    cat >/etc/nginx/sites-available/${APP_NAME} <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 120m;

    root ${APP_DIR}/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location /health {
        proxy_pass http://127.0.0.1:${API_PORT}/health;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
    run ln -sfn "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
  else
    cat >/etc/nginx/conf.d/${APP_NAME}.conf <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 120m;

    root ${APP_DIR}/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location /health {
        proxy_pass http://127.0.0.1:${API_PORT}/health;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
  fi
  run nginx -t
  run systemctl enable --now nginx
  run systemctl reload nginx
}

check_drivers_and_tools() {
  log "Checking runtime tools and 3D processing dependencies."
  command -v "$PYTHON_BIN" >/dev/null 2>&1 || die "Python not found"
  if [[ "$BUILD_FRONTEND" == "yes" ]]; then
    command -v node >/dev/null 2>&1 || die "Node not found"
    command -v npm >/dev/null 2>&1 || die "npm not found"
  fi
  command -v nginx >/dev/null 2>&1 || die "nginx not found"
  ldconfig -p 2>/dev/null | grep -q 'libGL.so.1' || die "libGL.so.1 missing"
  if command -v prusa-slicer >/dev/null 2>&1; then
    prusa-slicer --version || warn "PrusaSlicer exists but version check failed."
  else
    warn "PrusaSlicer missing; slicing endpoints need PRUSASLICER_PATH before use."
  fi
}

health_check() {
  sleep 2
  run systemctl --no-pager --full status "${APP_NAME}-api.service" || true
  curl -fsS "http://127.0.0.1:${API_PORT}/health" || die "Backend health check failed"
  curl -fsS "http://127.0.0.1/health" || die "Nginx health check failed"
}

main() {
  detect_platform
  configure_apt_mirror
  install_base_packages
  install_node_if_needed
  configure_language_mirrors
  install_prusaslicer_if_needed
  sync_code_to_app_dir
  prepare_runtime_dirs
  ensure_backend_env
  build_backend
  run_sqlite_migration
  build_frontend
  write_systemd_service
  write_nginx_site
  check_drivers_and_tools
  health_check
  local open_host
  open_host="$DOMAIN"
  if [[ "$open_host" == "_" ]]; then
    open_host="server-ip"
  fi
  log "Deployment complete."
  log "Open: http://${open_host}"
}

main "$@"
