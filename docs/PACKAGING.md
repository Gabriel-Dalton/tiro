# Packaging: getting Tiro into winget

Phase 5. The Windows app ships as a single EXE from GitHub Releases, Authenticode-signed
([SIGNING.md](SIGNING.md)). This is the other half: making `winget install` work.

## Why a portable EXE and not an installer

winget takes a portable EXE directly — `InstallerType: portable` — and puts a shim for it on
`PATH`. Nothing an MSI would do applies here. Tiro registers no services and no file
associations, and autostart is a tray-menu toggle writing the per-user `Run` key at the moment
you ask for it (`SettingsStore.SetAutostart`), not a decision made at install time.

Building an MSI to gain nothing would also mean a second artifact to sign, and SignPath
Foundation's free tier is metered per signing request.

### It was a ZIP until 1.3.0, and that was the wrong call

The reasoning above was sound and the packaging still managed to be the worst part of using
Tiro on Windows, because it answered "what does winget need" and never asked "where does this
app live". `PublishSingleFile` does not bundle `Content` files, so the EXE shipped with
`Assets/` and the whole web core beside it: twenty-seven files, which need an archive.

Then Explorer will happily run an EXE from inside a ZIP by extracting it to `%TEMP%`. So the
app people believed they had installed was living in a folder Windows deletes. It could not be
pinned to the taskbar in any way that survived a reboot, and every launch meant finding the ZIP
and opening it again. That is not a packaging preference, it is the product being broken for
anyone who did not know to extract first.

Two changes fixed it, and both are worth keeping straight because they solve different halves:

- `web/` and `Assets/` are `EmbeddedResource` now, unpacked at runtime by
  [`Resources.cs`](../windows/Tiro.Windows/Resources.cs), so the download really is one file.
  The `windows` job in [`build.yml`](../.github/workflows/build.yml) fails if anything else
  turns up beside the EXE, because a stray file would now be one the user never receives.
- [`Setup.cs`](../windows/Tiro.Windows/Setup.cs) offers, on first run, to install into
  `%LOCALAPPDATA%\Programs\Tiro` with a Start menu shortcut and an Apps and Features entry.
  Still no MSI and still no wizard: it is a file copy, a `.lnk` and one registry key, none of
  which need administrator rights.

A copy that winget owns is left alone: `Setup.IsManagedLocation` suppresses the offer under
winget's `Packages` folder, Program Files, Chocolatey and Scoop. Moving out from under a
package manager would leave it upgrading a file that was no longer there.

## What is checked in

| Path | What it is |
|---|---|
| `packaging/winget/GabrielDalton.Tiro.yaml` | version manifest, template |
| `packaging/winget/GabrielDalton.Tiro.installer.yaml` | installer manifest, template |
| `packaging/winget/GabrielDalton.Tiro.locale.en-US.yaml` | defaultLocale manifest, template |
| `scripts/gen-winget.mjs` | fills the templates in and hashes the real EXEs |

The templates carry `__VERSION__`, `__TAG__`, `__RELEASE_DATE__`, `__SHA256_X64__` and
`__SHA256_ARM64__`. Do not fill any of them in by hand. A wrong `InstallerSha256` passes review
and then fails at install time on someone else's machine, which is the worst place to find out.

`gen-winget.mjs` computes the hashes from the EXEs themselves, refuses to write a file that
still has an unfilled placeholder, and adds a UTF-8 BOM to any manifest that leaves ASCII —
winget-pkgs requires that, and the failure it produces otherwise reads as an unrelated
encoding error.

## Cutting a release

Nothing to do beyond the normal release steps in the README: bump
[`VERSION`](../VERSION), run `node scripts/gen-version.mjs`, commit, tag. The `release` job
already refuses to publish a tag that disagrees with `VERSION`, so the `PackageVersion` in
these manifests is the same number the apps report about themselves.

The job in [`build.yml`](../.github/workflows/build.yml) then runs the generator against the
EXEs it is about to publish and attaches `Tiro-winget-manifests.zip` to the release. The download URLs inside the manifests point at
that same release — they do not exist yet when the manifests are built, but they are
deterministic, so this is safe.

To produce them locally instead:

```bash
node scripts/gen-winget.mjs --tag v1.3.0 \
  --x64 dist/Tiro-Windows-x64.exe \
  --arm64 dist/Tiro-Windows-arm64.exe \
  --out dist/winget
```

## Submitting

The generator writes the `manifests/g/GabrielDalton/Tiro/<version>/` layout that winget-pkgs
expects, because that path *is* the package identity there.

1. Download `Tiro-winget-manifests.zip` from the release and unzip it into a fork of
   [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs).
2. Validate before opening anything:
   ```powershell
   winget validate --manifest manifests\g\GabrielDalton\Tiro\<version>
   winget install --manifest manifests\g\GabrielDalton\Tiro\<version>
   ```
   The second one is the check that matters: it downloads from the real release URL and
   verifies the hash, which is the step that catches a manifest built against the wrong build.
3. Open a PR against `winget-pkgs`. Their bot runs the same validation plus a sandbox install.

Review is theirs, not ours, and the first submission of a new package identifier is slower
than subsequent version bumps. Until it lands, `winget install GabrielDalton.Tiro` will not
resolve — keep the README pointing at the EXE.

## Notes for the next version

- **arm64 ships unsigned.** Deliberate, per [SIGNING.md](SIGNING.md). winget accepts it;
  SmartScreen on an ARM machine may still prompt on first run.
- **The WebView2 dependency is declared** (`Microsoft.EdgeWebView2Runtime`). Windows 11
  already has it and winget skips a dependency it finds installed, so this only fires on the
  Windows 10 machines that would otherwise hit Tiro's "runtime missing" dialog.
- **`PackageIdentifier` is frozen.** `GabrielDalton.Tiro` is the package's identity in the
  winget catalogue; changing it later orphans everyone who installed the old one rather than
  upgrading them.
