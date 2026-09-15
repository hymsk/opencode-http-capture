#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/plugins/opencode-http-capture.ts"
if [ -L "$TARGET" ] && [ "$(readlink "$TARGET")" = "$ROOT/src/entry.ts" ]; then
  rm -f "$TARGET"
  printf '%s\n' "Uninstalled: $TARGET"
elif [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  printf '%s\n' "Refusing to remove unrelated file: $TARGET" >&2
  exit 1
else
  printf '%s\n' "Not installed: $TARGET"
fi
