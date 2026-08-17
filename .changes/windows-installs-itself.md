---
bump: minor
platforms: windows
kind: added
---
**Tiro offers to install itself the first time you run it.** Say yes and it copies itself into
`%LOCALAPPDATA%\Programs\Tiro` and adds a Start menu entry, which is the thing Windows requires
before it will let you pin an app to the taskbar. It also registers in **Apps and Features**, so
it removes like anything else, and removing it keeps your history, settings and API key unless
you tick the box. No administrator rights, no wizard, and nothing written outside your own user
account. Say no and it stays portable, runnable from wherever you keep it; the tray menu can
install it later if you change your mind.
