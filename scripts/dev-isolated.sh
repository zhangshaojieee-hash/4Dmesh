#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR/backend"
if [[ ! -d .venv ]]; then
  echo "backend/.venv not found. Create it first with python3 -m venv backend/.venv or run scripts/deploy-server.sh to build it." >&2
  exit 1
fi

if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
  echo "frontend/node_modules not found. Run npm ci in frontend first." >&2
  exit 1
fi

(
  cd "$ROOT_DIR/backend"
  ./.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000 &
  BACKEND_PID=$!
  trap 'kill $BACKEND_PID 2>/dev/null || true' EXIT

  cd "$ROOT_DIR/frontend"
  npm run dev -- --host 0.0.0.0
)
