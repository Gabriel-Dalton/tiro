---
bump: minor
platforms: windows
kind: changed
---
**The Windows download is a single `Tiro-Windows-x64.exe`, not a ZIP.** The archive existed
because the EXE shipped with the web core in loose files beside it, and Windows Explorer will
run an EXE from inside a ZIP by extracting it to a temporary folder. So the app most people
ended up running lived somewhere Windows deletes: it could not be pinned to the taskbar in a
way that survived a reboot, and every launch meant finding the ZIP and opening it again. The
web core is inside the binary now, so there is one file to download and nothing to unpack.
