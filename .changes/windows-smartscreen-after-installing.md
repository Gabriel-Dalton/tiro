---
bump: patch
platforms: windows
kind: fixed
---
**SmartScreen stops interrupting an installed copy on every launch.** Windows marks anything
downloaded, and that mark is copied along with the file, so an installed Tiro inherited it and
kept being challenged. Installing now clears the mark on its own copy, which is exactly what
ticking **Unblock** in the file's Properties does, at the moment you asked for the app to be
installed. The very first launch, before you have installed anything, can still be challenged:
[docs/SIGNING.md](docs/SIGNING.md) explains why.
