#!/bin/zsh
# Build Tiro.app from the Swift package. Run: ./make-app.sh
set -euo pipefail
cd "$(dirname "$0")"

# Universal binary: both slices in one app, so it runs on Apple Silicon and on
# Intel Macs. Building on one architecture without these flags produces a binary
# that simply will not launch on the other, and the failure only shows up on
# hardware you may not own.
ARCHS=(--arch arm64 --arch x86_64)
swift build -c release "${ARCHS[@]}"
BIN="$(swift build -c release "${ARCHS[@]}" --show-bin-path)/tiro"

# stop any running instance before replacing the bundle on disk. A stale process
# next to a new bundle makes LaunchServices spawn a second (crashing) instance
pkill -f "Tiro.app/Contents/MacOS/Tiro" 2>/dev/null || true

APP=Tiro.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Tiro"
cp assets/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

# same number the web app, the Windows EXE and the landing page report
VERSION=$(tr -d '[:space:]' < VERSION)

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>Tiro</string>
    <key>CFBundleIdentifier</key><string>io.mypip.tiro</string>
    <key>CFBundleName</key><string>Tiro</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>${VERSION}</string>
    <key>CFBundleVersion</key><string>${VERSION}</string>
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

# Refuse to ship a single-architecture build. Without this the app silently
# becomes Apple-Silicon-only whenever it is built on an Apple Silicon machine,
# which is what happened to v1.0.0.
SLICES=$(lipo -archs "$APP/Contents/MacOS/Tiro")
echo "Architectures: $SLICES"
for want in arm64 x86_64; do
    case " $SLICES " in
        *" $want "*) ;;
        *) echo "error: $want slice missing, so this build would not run on those Macs" >&2; exit 1 ;;
    esac
done

echo "Built $APP. Open it with: open $APP"
