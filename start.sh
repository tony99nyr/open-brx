#!/bin/sh
# Open BRX: set up and start Mission Control on macOS or Linux. Windows: start.cmd.
# This file only makes sure Node.js 20.11 or later exists; scripts/start.mjs does the rest.
# Usage: ./start.sh [--demo] [--help]
cd "$(dirname "$0")" || exit 1

node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(/[.]/).map(Number);process.exit(a>20||(a===20&&b>=11)?0:1)'
}

if ! node_ok; then
  echo "Open BRX needs Node.js 20.11 or later, and this computer does not have it."
  if [ "$(uname)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    printf "Install Node.js with Homebrew now? [Y/n] "
    read -r answer
    case "$answer" in
      [Nn]*) ;;
      *) brew install node ;;
    esac
  fi
  if ! node_ok; then
    echo
    echo "Install the LTS version of Node.js from https://nodejs.org/"
    echo "Then open a new terminal and run ./start.sh again."
    exit 1
  fi
fi

exec node scripts/start.mjs "$@"
