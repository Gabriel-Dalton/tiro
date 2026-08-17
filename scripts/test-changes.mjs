#!/usr/bin/env node
// The release logic, asserted in isolation:
//
//   node scripts/test-changes.mjs
//
// There is no test project here for the same reason there is not one for the Windows
// shell: most of this is a script writing files, and a test that asserts a file was
// written tells you nothing. What is worth covering is the arithmetic that can be
// quietly, permanently wrong — where nothing crashes, nothing goes red, and the
// system reads as working while every user silently stops hearing about updates.
//
// The 1.9.0 case is the one. Compared as strings, "1.9.0" > "1.10.0", so a release
// past x.9 would be classified as older than what is running and no one would ever
// be told about an update again.

import { parseNote, highestBump, nextVersion, platformTag } from "./changes.mjs";

let failures = 0;
const check = (what, ok, detail) => {
  if (ok) console.log(`  ok  ${what}`);
  else {
    failures++;
    console.log(`  FAIL ${what}${detail === undefined ? "" : ` — got ${JSON.stringify(detail)}`}`);
  }
};
const throws = (what, fn, expected) => {
  try {
    fn();
    failures++;
    console.log(`  FAIL ${what} — it was accepted`);
  } catch (err) {
    const ok = expected === undefined || err.message.includes(expected);
    if (ok) console.log(`  ok  ${what}`);
    else {
      failures++;
      console.log(`  FAIL ${what} — rejected, but for the wrong reason: ${err.message.split("\n")[0]}`);
    }
  }
};

const note = (header, body = "Something a person would actually notice happening.") =>
  parseNote("test.md", `---\n${header}\n---\n${body}\n`);

console.log("\nversion arithmetic");
check("a minor moves the middle number and zeroes the last", nextVersion("1.2.3", "minor") === "1.3.0");
check("a patch moves the last", nextVersion("1.2.3", "patch") === "1.2.4");
check("a major zeroes both", nextVersion("1.2.3", "major") === "2.0.0");
check("none stands still", nextVersion("1.2.3", "none") === "1.2.3");
check("1.9.0 goes to 1.10.0, not 1.91.0", nextVersion("1.9.0", "minor") === "1.10.0", nextVersion("1.9.0", "minor"));
check("and 1.10.0 keeps going", nextVersion("1.10.0", "minor") === "1.11.0", nextVersion("1.10.0", "minor"));
check("a patch past nine carries nothing", nextVersion("1.2.9", "patch") === "1.2.10", nextVersion("1.2.9", "patch"));
throws("a version that is not three numbers is refused", () => nextVersion("1.2", "patch"), "not three numbers");
throws("and neither is a tag", () => nextVersion("v1.2.0", "patch"), "not three numbers");

console.log("\nwhich bump wins");
const b = (...bumps) => highestBump(bumps.map((bump) => ({ bump })));
check("one minor among many patches makes it a minor", b("patch", "patch", "minor", "patch") === "minor");
check("a major beats a minor", b("minor", "major", "patch") === "major");
check("all patches stay a patch", b("patch", "patch") === "patch");
check("nothing pending is none", highestBump([]) === "none");
check("all none is none", b("none", "none") === "none");
// The asymmetry this whole policy exists for: a feature filed among fixes must still
// interrupt people, or nobody learns the thing they asked for exists.
check("one minor is never diluted by nine patches", b(...Array(9).fill("patch"), "minor") === "minor");

console.log("\nnotes that should be refused");
throws("no header at all", () => parseNote("test.md", "just some prose"), "no --- header");
throws("a bump nobody defined", () => note("bump: huge\nplatforms: web"), "not one of");
throws("a missing bump", () => note("platforms: web"), "not one of");
throws("a missing platform", () => note("bump: patch"), "platforms is missing");
throws("a platform nobody ships", () => note("bump: patch\nplatforms: linux"), "not a platform");
throws("a body too short to tell anyone anything", () => note("bump: minor\nplatforms: web", "fixes"), "too short");
throws("platforms none on a real release", () => note("bump: minor\nplatforms: none"), "only makes sense");
throws("a kind nobody defined", () => note("bump: patch\nplatforms: web\nkind: improved"), "not one of");

console.log("\nnotes that should be accepted");
check("the ordinary case", note("bump: minor\nplatforms: web, windows").bump === "minor");
check("platforms are split and trimmed", JSON.stringify(note("bump: patch\nplatforms: web ,  windows").platforms) === '["web","windows"]');
check("a minor is Added by default", note("bump: minor\nplatforms: web").kind === "added");
check("a patch is Fixed by default", note("bump: patch\nplatforms: web").kind === "fixed");
// A fix everyone must see is a minor, and must not read as a new feature.
check("but a minor can say it is a fix", note("bump: minor\nplatforms: web\nkind: fixed").kind === "fixed");
check("bump none needs no body", note("bump: none\nplatforms: none", "x").bump === "none");

console.log("\nplatform tags");
check("one platform", platformTag(["web"]) === " *(Web.)*", platformTag(["web"]));
check("several, in the order given", platformTag(["web", "windows"]) === " *(Web, Windows.)*", platformTag(["web", "windows"]));
check("macOS keeps its capitals", platformTag(["macos"]) === " *(macOS.)*", platformTag(["macos"]));
check("none produces no tag", platformTag(["none"]) === "");

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
