# Impact notes

One file per change that a user could notice. The release is built from these:
nobody edits `VERSION`, nobody writes a changelog section, and nobody pushes a tag.
Merging to `main` with notes pending cuts a release.

That is the whole point, and it is also the risk. **There is no release checkpoint**,
so the note you write in a pull request is the last thing anyone reads before every
user on every platform is either interrupted or not. The review of your pull request
*is* the release review. Write the note first, before the code if you can.

## The file

Name it after the change, `.changes/tell-people-about-updates.md`:

```markdown
---
bump: minor
platforms: web, windows
---
Tiro tells you when there is a new version, rather than leaving you to notice.
```

The body is what a user reads on the download page. Write it for someone deciding
whether to update: what is new, what was **broken**, and which app it affects. Not
"refactored the update checker" — they do not have one of those.

## Which bump

The number decides who gets interrupted. Both apps compare versions and interrupt for
a minor or major, stay quiet for a patch. So this is not paperwork:

| `bump` | When | Who is told |
|---|---|---|
| `major` | Something people rely on is gone or works differently. History or the key needs migrating. | Everyone, loudly |
| `minor` | Anything a user would notice on purpose: a feature, a new control, a visible interface change, a new platform, **or a fix to something visibly broken for everyone** | Everyone, once |
| `patch` | They would never notice unless they had hit the bug: a crash on one device, a wrong number in a tooltip, a fix in a path most people never reach | Nobody, until two pile up |
| `none` | Nothing a user could notice. Test-only changes, comments, internal renames. | Nobody, ever |

Two rules that settle most of the hard cases:

- **A fix everyone must see is a `minor`**, not a `patch`, and the body says why in its
  first line. There is no severity flag, deliberately: one more lever is one more thing
  to get wrong. The honest way to say "this must reach everyone today" is to release it
  as something they are told about.
- **When you cannot decide, write the body first.** If it reads like something worth
  reading, it is a `minor`. If it reads like housekeeping, it is a `patch`. That is the
  same question the user is being asked when the banner appears, so answering it here
  keeps the two consistent.

Getting it wrong is not symmetrical. A feature shipped as a `patch` means nobody learns
the thing they wanted exists. A typo fix shipped as a `minor` interrupts every user on
every platform; do that twice and they stop reading update prompts, which costs you the
next release that mattered.

## Platforms

Comma separated, from `web`, `windows`, `macos`, `site`. It becomes the *(Web, Windows.)*
tag on the changelog entry, so a reader can tell whether a line is about the app in front
of them. Use `none` only with `bump: none`.

`macos` is upstream's app and this fork does not modify it, so a note claiming it is
almost always a mistake.

## Several notes in one release

They accumulate on `main` until a release is cut, and **the highest bump wins**: one
`minor` among nine `patch` notes makes the release a minor, because a user would notice
that one thing. All of the bodies appear in the release notes, grouped by what they are.

## Checking your work

```bash
node scripts/check-changes.mjs     # validates every note, and that you wrote one
node scripts/next-version.mjs      # prints the version your notes would produce
```

CI runs the first on every push and fails without a note when product code changed.
