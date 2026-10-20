#!/bin/bash
# TongPing (double-click on macOS / run ./start.command in a Linux terminal)
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "[Error] Node.js was not found. Install Node.js 20 LTS first: https://nodejs.org/en"
  read -r -p "Press Enter to close" _; exit 1
fi
major=$(node -p "process.versions.node.split('.')[0]")
if [ "$major" -lt 20 ]; then
  echo "[Error] Node.js is too old (current: $(node -v)); version 20 or newer is required."
  read -r -p "Press Enter to close" _; exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing dependencies (only needed once)..."
  npm ci --no-audit --no-fund || { echo "[Error] Dependency installation failed"; read -r -p "Press Enter to close" _; exit 1; }
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

echo
echo "Starting TongPing... Keep this window open; closing it stops TongPing."
echo
npm run up
