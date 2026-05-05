#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT/dist/macos"
APP_NAME="Conduit"
DMG_FILENAME="Conduit.dmg"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
DMG_ROOT="$DIST_DIR/dmg-root"
DMG_PATH="$DIST_DIR/$DMG_FILENAME"
CHECKSUM_PATH="$DMG_PATH.sha256"
VOLUME_NAME="${CONDUIT_DMG_VOLUME_NAME:-Conduit}"
MODE="${1:-}"

if ! command -v hdiutil >/dev/null 2>&1; then
  echo "hdiutil is required to create a macOS DMG." >&2
  exit 1
fi

case "$MODE" in
  "")
    "$ROOT/script/build_and_run.sh" --build-only
    ;;
  --skip-build)
    if [[ ! -d "$APP_BUNDLE" ]]; then
      echo "$APP_BUNDLE does not exist. Run npm run macos:build first." >&2
      exit 1
    fi
    ;;
  *)
    echo "Unknown option: $MODE" >&2
    echo "Usage: $0 [--skip-build]" >&2
    exit 2
    ;;
esac

rm -rf "$DMG_ROOT" "$DMG_PATH" "$CHECKSUM_PATH"
mkdir -p "$DMG_ROOT"

/usr/bin/ditto "$APP_BUNDLE" "$DMG_ROOT/$APP_NAME.app"
ln -s /Applications "$DMG_ROOT/Applications"
cat > "$DMG_ROOT/README.txt" <<README
Conduit local preview

Install:
1. Drag Conduit.app to Applications.
2. Launch Conduit from Applications.

This preview build is not signed or notarized yet. On first launch, macOS may
show a downloaded-app warning or block the app. If blocked, right-click
Conduit.app, choose Open, and confirm.

Conduit starts supervised local services when it launches. When you quit and
confirm "Quit and Stop Services", it stops those services too.
README

hdiutil create \
  -volname "$VOLUME_NAME" \
  -srcfolder "$DMG_ROOT" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

shasum -a 256 "$DMG_PATH" > "$CHECKSUM_PATH"

echo "Created $DMG_PATH"
echo "Wrote $CHECKSUM_PATH"
