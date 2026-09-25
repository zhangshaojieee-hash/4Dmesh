#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="${SCREEN_SESSION_NAME:-4d-print}"
RUN_DIR="${SCREEN_RUN_DIR:-/tmp/4d-print-screen-${USER:-user}}"
LOG_FILE="${SCREEN_LOG_FILE:-$RUN_DIR/app.log}"
STOP_FILE="$RUN_DIR/stop"
PID_FILE="$RUN_DIR/runner.pid"
RESTART_DELAY="${SCREEN_RESTART_DELAY:-5}"

usage() {
  cat <<EOF
Usage: bash scripts/screen-run.sh <command>

Commands:
  start      Start python run.py in a detached screen session with auto-restart
  stop       Stop the managed screen session
  restart    Stop and start the managed screen session
  status     Show screen session and recent log status
  logs       Follow the managed log file
  attach     Attach to the screen session

Environment:
  SCREEN_SESSION_NAME   Screen session name, default: 4d-print
  SCREEN_RESTART_DELAY  Restart delay in seconds, default: 5
  SCREEN_RUN_DIR        Runtime dir, default: /tmp/4d-print-screen-\$USER
  SCREEN_LOG_FILE       Log file, default: \$SCREEN_RUN_DIR/app.log
EOF
}

ensure_screen() {
  if ! command -v screen >/dev/null 2>&1; then
    echo "screen is not installed. Install it first, for example: sudo apt-get install -y screen" >&2
    exit 1
  fi
}

session_exists() {
  screen -ls 2>/dev/null | grep -Eq "[[:space:]][0-9]+\\.${SESSION_NAME}[[:space:]]"
}

python_command() {
  if [[ -n "${PYTHON:-}" ]]; then
    printf '%s\n' "$PYTHON"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    printf '%s\n' "python3"
    return
  fi
  if command -v python >/dev/null 2>&1; then
    printf '%s\n' "python"
    return
  fi
  echo "python3/python not found" >&2
  exit 1
}

run_loop() {
  mkdir -p "$RUN_DIR"
  rm -f "$STOP_FILE"
  echo "$$" >"$PID_FILE"
  trap 'touch "$STOP_FILE"; exit 0' INT TERM

  cd "$ROOT_DIR"
  local python_bin
  python_bin="$(python_command)"

  {
    echo "============================================================"
    echo "screen runner started at $(date '+%Y-%m-%d %H:%M:%S')"
    echo "root: $ROOT_DIR"
    echo "session: $SESSION_NAME"
    echo "python: $python_bin"
    echo "restart delay: ${RESTART_DELAY}s"
    echo "============================================================"
  } | tee -a "$LOG_FILE"

  while [[ ! -f "$STOP_FILE" ]]; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] starting python run.py" | tee -a "$LOG_FILE"
    set +e
    env NO_BROWSER="${NO_BROWSER:-1}" "$python_bin" run.py 2>&1 | tee -a "$LOG_FILE"
    local exit_code="${PIPESTATUS[0]}"
    set -e

    if [[ -f "$STOP_FILE" ]]; then
      break
    fi

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] run.py exited with code ${exit_code}; restarting in ${RESTART_DELAY}s" | tee -a "$LOG_FILE"
    sleep "$RESTART_DELAY" &
    wait $! || true
  done

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] screen runner stopped" | tee -a "$LOG_FILE"
  rm -f "$PID_FILE" "$STOP_FILE"
}

start_session() {
  ensure_screen
  mkdir -p "$RUN_DIR"
  if session_exists; then
    echo "screen session '$SESSION_NAME' is already running."
    screen -ls | grep -E "[[:space:]][0-9]+\\.${SESSION_NAME}[[:space:]]" || true
    return
  fi
  rm -f "$STOP_FILE"
  : >"$LOG_FILE"
  screen -dmS "$SESSION_NAME" bash "$0" run-loop
  echo "started screen session '$SESSION_NAME'"
  echo "attach: bash scripts/screen-run.sh attach"
  echo "logs:   bash scripts/screen-run.sh logs"
}

stop_session() {
  ensure_screen
  mkdir -p "$RUN_DIR"
  touch "$STOP_FILE"
  if ! session_exists; then
    echo "screen session '$SESSION_NAME' is not running."
    rm -f "$PID_FILE" "$STOP_FILE"
    return
  fi

  screen -S "$SESSION_NAME" -X stuff $'\003' || true
  for _ in $(seq 1 20); do
    if ! session_exists; then
      echo "stopped screen session '$SESSION_NAME'"
      rm -f "$PID_FILE" "$STOP_FILE"
      return
    fi
    sleep 0.5
  done

  screen -S "$SESSION_NAME" -X quit || true
  echo "forced screen session '$SESSION_NAME' to quit"
  rm -f "$PID_FILE" "$STOP_FILE"
}

status_session() {
  ensure_screen
  if session_exists; then
    echo "screen session '$SESSION_NAME' is running:"
    screen -ls | grep -E "[[:space:]][0-9]+\\.${SESSION_NAME}[[:space:]]" || true
  else
    echo "screen session '$SESSION_NAME' is not running."
  fi
  if [[ -f "$PID_FILE" ]]; then
    echo "runner pid: $(cat "$PID_FILE")"
  fi
  if [[ -f "$LOG_FILE" ]]; then
    echo "log file: $LOG_FILE"
    tail -n 20 "$LOG_FILE"
  fi
}

case "${1:-}" in
  start)
    start_session
    ;;
  stop)
    stop_session
    ;;
  restart)
    stop_session
    start_session
    ;;
  status)
    status_session
    ;;
  logs)
    mkdir -p "$RUN_DIR"
    touch "$LOG_FILE"
    tail -n "${2:-80}" -f "$LOG_FILE"
    ;;
  attach)
    ensure_screen
    exec screen -r "$SESSION_NAME"
    ;;
  run-loop)
    run_loop
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
