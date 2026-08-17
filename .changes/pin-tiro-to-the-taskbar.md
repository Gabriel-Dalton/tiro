---
bump: minor
platforms: windows
---
Pin Tiro to the taskbar, and keep it pinned. Tiro now writes a Start Menu shortcut on first
run, so **Start → type Tiro → Pin to taskbar** works even though nothing installed the app;
**Pin to the taskbar…** in the tray menu repeats the steps and writes the shortcut again if
you removed it. Removing it sticks rather than being undone on the next launch. The pin also
survives updates now: Tiro declares a fixed identity instead of letting Windows derive one
from wherever the EXE happens to sit, which is what used to leave a dead pinned button after
the next download, and what used to split the pin and the running window into two separate
taskbar icons. On the Mac, Tiro is already in the Dock while it runs: right-click → Options →
**Keep in Dock**.
