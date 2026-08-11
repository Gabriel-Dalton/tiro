#!/bin/zsh
# Build Tiro.app from the Swift package. Run: ./make-app.sh
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release

# stop any running instance before replacing the bundle on disk — a stale process
# next to a new bundle makes LaunchServices spawn a second (crashing) instance
pkill -f "Tiro.app/Contents/MacOS/Tiro" 2>/dev/null || true

APP=Tiro.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/tiro "$APP/Contents/MacOS/Tiro"
cp assets/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>Tiro</string>
    <key>CFBundleIdentifier</key><string>io.mypip.tiro</string>
    <key>CFBundleName</key><string>Tiro</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1.0</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>Tiro records your voice while you hold Fn, to transcribe it with Deepgram.</string>
</dict>
</plist>
PLIST

# stable identity so TCC permissions (Accessibility/Mic) survive rebuilds; ad-hoc fallback
SIGN_ID=$(security find-identity -v -p codesigning | awk -F'"' '/Apple Development/{print $2; exit}')
codesign --force -s "${SIGN_ID:--}" "$APP"
echo "Signed as: ${SIGN_ID:-ad-hoc}"
echo "Built $APP — open it with: open $APP"
