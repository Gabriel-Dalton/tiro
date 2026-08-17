---
bump: minor
platforms: windows
---
On a German, French, Spanish, Portuguese, Polish, Czech, Turkish or Nordic keyboard, Tiro made
`@`, `€`, `{`, `[` and `~` impossible to type in **every** application on the machine for as
long as it was running. Right Alt is AltGr on those layouts, and Tiro took the key for its
hotkey and swallowed it, so nothing else ever saw it. Almost nobody would connect "I cannot
type an at sign in my email" back to a dictation app sitting in the tray. Tiro now checks
every keyboard layout you have installed, and where Right Alt is AltGr it leaves the key
alone and dictates on **Scroll Lock** instead, telling you once that it has and where to
change it. If your layout does not use AltGr, nothing changes and Right Alt still works.
