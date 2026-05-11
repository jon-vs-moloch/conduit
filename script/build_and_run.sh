#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$ROOT/macos/ConduitMenuBar"
PRODUCT="ConduitMenuBar"
APP_NAME="Conduit"
BUNDLE_ID="app.conduit.local"
DIST_DIR="$ROOT/dist/macos"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
SWIFT_BUILD_DIR="${CONDUIT_SWIFT_BUILD_DIR:-${TMPDIR:-/tmp}/conduit-menubar-build}"
EXECUTABLE="$SWIFT_BUILD_DIR/debug/$PRODUCT"
CONDUIT_VERSION="$(node -e "console.log(require('$ROOT/package.json').version)")"
CONDUIT_BUILD_NUMBER="${CONDUIT_BUILD_NUMBER:-1}"
CONDUIT_OK_PUBLISHER_ID="${CONDUIT_OK_PUBLISHER_ID:-owl-kestrel}"
CONDUIT_OK_PUBLISHER_DOMAIN="${CONDUIT_OK_PUBLISHER_DOMAIN:-owlandkestrel.com}"
CONDUIT_OK_PUBLISHER_KEY_ID="${CONDUIT_OK_PUBLISHER_KEY_ID:-ok-release-p256-v1}"
CONDUIT_OK_PUBLISHER_PUBLIC_KEY_PEM="${CONDUIT_OK_PUBLISHER_PUBLIC_KEY_PEM:-}"

MODE="${1:-}"

stop_existing() {
  /usr/bin/pkill -x "$APP_NAME" >/dev/null 2>&1 || true
  /usr/bin/pkill -x "$PRODUCT" >/dev/null 2>&1 || true
  /usr/bin/pkill -TERM -f "$ROOT.*src/cli/index.ts app start --port 47831" >/dev/null 2>&1 || true
  /usr/bin/pkill -TERM -f "$ROOT.*src/cli/index.ts daemon start" >/dev/null 2>&1 || true
  /usr/bin/pkill -TERM -f "$ROOT.*src/cli/index.ts listen --project" >/dev/null 2>&1 || true
  /usr/bin/pkill -TERM -f "$ROOT.*dist/cli/index.js app start --port 47831" >/dev/null 2>&1 || true
  /usr/bin/pkill -TERM -f "$ROOT.*dist/cli/index.js daemon start" >/dev/null 2>&1 || true
  /usr/bin/pkill -TERM -f "$ROOT.*dist/cli/index.js listen --project" >/dev/null 2>&1 || true
}

stage_bundle() {
  rm -rf "$APP_BUNDLE"
  mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"
  cp "$EXECUTABLE" "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
  cp "$PACKAGE_DIR/Assets/ConduitIcon.svg" "$APP_BUNDLE/Contents/Resources/ConduitIcon.svg"
  PUBLIC_KEY_PLIST="$(CONDUIT_OK_PUBLISHER_PUBLIC_KEY_PEM="$CONDUIT_OK_PUBLISHER_PUBLIC_KEY_PEM" node <<'NODE'
const raw = process.env.CONDUIT_OK_PUBLISHER_PUBLIC_KEY_PEM || '';
process.stdout.write(raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
NODE
)"
  cat > "$APP_BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>$BUNDLE_ID.url</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>conduit</string>
      </array>
    </dict>
  </array>
  <key>CFBundleShortVersionString</key>
  <string>$CONDUIT_VERSION</string>
  <key>CFBundleVersion</key>
  <string>$CONDUIT_BUILD_NUMBER</string>
  <key>ConduitOKPublisherID</key>
  <string>$CONDUIT_OK_PUBLISHER_ID</string>
  <key>ConduitOKPublisherDomain</key>
  <string>$CONDUIT_OK_PUBLISHER_DOMAIN</string>
  <key>ConduitOKPublisherKeyID</key>
  <string>$CONDUIT_OK_PUBLISHER_KEY_ID</string>
  <key>ConduitOKPublisherPublicKeyPEM</key>
  <string>$PUBLIC_KEY_PLIST</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST
}

launch_bundle() {
  CONDUIT_REPO_ROOT="$ROOT" /usr/bin/open -n "$APP_BUNDLE"
}

verify_launch() {
  sleep 1
  if /usr/bin/pgrep -x "$APP_NAME" >/dev/null 2>&1 || /usr/bin/pgrep -x "$PRODUCT" >/dev/null 2>&1; then
    echo "$APP_NAME launched."
  else
    echo "$APP_NAME did not appear to launch." >&2
    exit 1
  fi
}

stop_existing
swift build --package-path "$PACKAGE_DIR" --scratch-path "$SWIFT_BUILD_DIR"
stage_bundle

case "$MODE" in
  --build-only)
    echo "Built $APP_BUNDLE"
    ;;
  --verify)
    launch_bundle
    verify_launch
    ;;
  --logs)
    launch_bundle
    /usr/bin/log stream --info --predicate 'process == "Conduit" || process == "ConduitMenuBar"'
    ;;
  --debug)
    CONDUIT_REPO_ROOT="$ROOT" /usr/bin/lldb "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
    ;;
  "")
    launch_bundle
    echo "Launched $APP_BUNDLE"
    ;;
  *)
    echo "Unknown option: $MODE" >&2
    echo "Usage: $0 [--build-only|--verify|--logs|--debug]" >&2
    exit 2
    ;;
esac
