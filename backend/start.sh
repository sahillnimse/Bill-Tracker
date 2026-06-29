#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
if [ ! -f ".env" ]; then
  echo "ERROR: .env not found. Run: cp .env.example .env"
  exit 1
fi
mkdir -p data
echo "Starting SpendWatch API on http://localhost:8000"
echo "Docs: http://localhost:8000/docs"
exec uvicorn main:app --host 0.0.0.0 --port 8000 ${1:-}
