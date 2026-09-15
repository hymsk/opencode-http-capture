#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/plugins"
TARGET="$TARGET_DIR/opencode-http-capture.ts"
mkdir -p "$TARGET_DIR"
if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  if [ "$(readlink "$TARGET" || true)" != "$ROOT/src/entry.ts" ]; then
    printf '%s\n' "Refusing to overwrite: $TARGET" >&2
    exit 1
  fi
else
  ln -s "$ROOT/src/entry.ts" "$TARGET"
fi
printf '%s\n' "Installed: $TARGET"
