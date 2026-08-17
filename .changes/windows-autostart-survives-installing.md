---
bump: patch
platforms: windows
kind: fixed
---
**"Start with Windows" survives installing.** The setting stores the path to the EXE, so it went
on pointing at the copy in Downloads and quietly stopped working once that folder was cleared
out. Installing re-points it at the copy that is going to stay.
