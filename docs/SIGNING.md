# Code signing, and the SmartScreen dialog

> **Windows protected your PC** — Microsoft Defender SmartScreen prevented an unrecognized
> app from starting. App: `Tiro.exe`. Publisher: **Unknown publisher**.

That dialog is what a Windows user sees the first time they run Tiro. This document explains
what actually triggers it, what a user can do about it today, and how the repository is wired
to stop triggering it.

## What the dialog is reacting to

Two separate things have to be true for SmartScreen to interrupt a launch, and it is worth
keeping them apart, because only one of them costs money to fix.

**1. The file carries the Mark of the Web.** Anything downloaded by a browser gets an
alternate data stream (`Zone.Identifier`) marking it as coming from the internet. Files
extracted from a downloaded ZIP inherit it. No mark, no SmartScreen check — this is why the
same EXE built locally starts without a murmur.

**2. Neither the file nor its publisher has a reputation.** SmartScreen looks the binary up
by hash, and its signing certificate by identity. A fresh unsigned EXE is unknown on both
counts, so the launch is blocked with `Unknown publisher` and the *Run anyway* escape hatch.

Signing does not switch SmartScreen off. What it does is give every release a stable publisher
identity to accumulate reputation against, instead of each new build starting from zero as an
anonymous hash.

## What a user can do right now

Unblocking removes the Mark of the Web, which skips the reputation check entirely. Do it to
the **ZIP, before extracting** — the extracted files inherit the mark otherwise:

1. Right-click `Tiro-Windows-x64.zip` → **Properties**
2. Tick **Unblock** at the bottom of the General tab → **OK**
3. Extract, and run `Tiro.exe`

Or in PowerShell:

```powershell
Unblock-File .\Tiro-Windows-x64.zip     # before extracting
Get-ChildItem -Recurse .\Tiro | Unblock-File   # if it is already extracted
```

Failing that, the dialog's own **More info → Run anyway** works and is remembered per file.

## How the repository signs releases

CI signs through [SignPath Foundation](https://signpath.org/), which issues free
OV certificates to open-source projects and signs on its own HSM, after verifying that the
binary came from this repository's workflow. Nothing has to be stored in the repository — the
key never exists outside SignPath.

`.github/workflows/build.yml` already carries the wiring. The `windows` job:

1. publishes the self-contained EXE to `publish/`,
2. decides whether to sign — release builds only (a `v*` tag, a `release/v*` branch, or a
   manual run with a version), and only when the settings below exist,
3. uploads `publish/` as an artifact and submits it to SignPath,
4. downloads the signed result to `signed/` and zips that instead of `publish/`.

If the settings are absent — a fork, a pull request, a plain branch push — steps 2–4 are
skipped and the job produces exactly the ZIP it produced before. Releasing without them logs a
workflow warning rather than failing the build.

### One-time setup

1. **Apply** at <https://signpath.org/apply>. The project needs a public repository, an OSI
   license (Tiro is MIT) and some verifiable history — the application asks for the repository
   URL and a maintainer to vouch for.
2. **Install the SignPath GitHub app** on `Gabriel-Dalton/tiro` when SignPath asks; that is how
   it fetches build artifacts and verifies their origin.
3. **Create the artifact configuration** in the SignPath project. The GitHub artifact arrives
   as a ZIP of `publish/`, with the EXE at its root:

   ```xml
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="Tiro.exe">
         <authenticode-sign />
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

   The rest of the ZIP is the web core and WebView2's loader; only `Tiro.exe` needs signing.
4. **Add the repository settings** (Settings → Secrets and variables → Actions):

   | Kind | Name | Value |
   |---|---|---|
   | Secret | `SIGNPATH_API_TOKEN` | the SignPath CI user's API token |
   | Variable | `SIGNPATH_ORGANIZATION_ID` | the organization GUID |
   | Variable | `SIGNPATH_PROJECT_SLUG` | project slug — defaults to `tiro` |
   | Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | defaults to `release-signing` |
   | Variable | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | defaults to `windows-zip` |

   The three slug variables only need setting where the SignPath project disagrees with those
   defaults. `SIGNPATH_API_TOKEN` and `SIGNPATH_ORGANIZATION_ID` are what the workflow tests
   for, so signing stays off until both are present.
5. **Cut a release** and check the run: the `Sign with SignPath` step should appear, and
   `Tiro.exe` inside the published ZIP should show a Digital Signatures tab in Properties.

### What changes for users, and what doesn't

The publisher line stops reading `Unknown publisher`, Smart App Control and enterprise policies
that reject unsigned binaries stop rejecting Tiro, and reputation starts accruing to the
certificate across releases rather than dying with each new hash.

SmartScreen can still interrupt an early release. Neither OV nor EV certificates buy instant
reputation any more — Microsoft
[removed the EV fast path in 2024](https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore) —
so it builds from real downloads over time. Keep the unblock instructions on the download page
until the warnings stop being reported.

### If SignPath declines

The alternatives, roughly in order of cost:

- **[Azure Artifact Signing](https://azure.microsoft.com/en-us/products/artifact-signing)**
  (formerly Trusted Signing) — about $10/month, no hardware token, open to verified
  self-employed individuals in the US, Canada, EU and UK. Signs from CI via
  `azure/trusted-signing-action` with OIDC. Same OV-class reputation behaviour as above.
- **A commercial OV or EV certificate** from Sectigo, DigiCert or SSL.com — a few hundred
  dollars a year, and since 2023 the key must live on a hardware token or cloud HSM, so CI
  signing means a cloud-HSM tier.
- **The Microsoft Store**, which signs submissions itself and removes the warning outright, at
  the cost of packaging Tiro as MSIX and passing certification.
