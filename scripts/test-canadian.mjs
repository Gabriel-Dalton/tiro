// The Canadian English pass. No dependencies, like scripts/test-changes.mjs:
// this is pure text in, text out, so it needs no browser and belongs in a test
// that runs everywhere rather than in the Playwright suite.
//
//   node scripts/test-canadian.mjs

import { toCanadian, formatPostalCodes, rules, RULE_COUNT } from "../web/src/canadian.js";

let failures = 0;

function check(name, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n       got:  ${JSON.stringify(got)}\n       want: ${JSON.stringify(want)}`}`);
}

// ------------------------------------------------------------------ spelling

check("-our", toCanadian("the color of the harbor"), "the colour of the harbour");
check("-re", toCanadian("the center of the theater"), "the centre of the theatre");
check("-ce nouns", toCanadian("defense and offense"), "defence and offence");
check("doubled consonant", toCanadian("we traveled and canceled"), "we travelled and cancelled");
check("metric compounds", toCanadian("five kilometers and two liters"),
  "five kilometres and two litres");
check("grey", toCanadian("a gray day"), "a grey day");

// Canadian keeps American -ize. Converting it would be the bug, so pin it.
check("-ize is left alone", toCanadian("organize and recognize"), "organize and recognize");
check("tire and aluminum are already Canadian",
  toCanadian("an aluminum tire iron"), "an aluminum tire iron");
check("program is not programme", toCanadian("the program"), "the program");

// The ambiguous ones, which must not be touched. Each of these was a real
// temptation and each would turn ordinary English into nonsense.
check("check is not cheque", toCanadian("check the box"), "check the box");
check("a reality check survives", toCanadian("a reality check"), "a reality check");
check("license is left alone", toCanadian("a license to drive"), "a license to drive");
check("practice is left alone", toCanadian("practice makes perfect"), "practice makes perfect");
check("a parking meter is not a metre", toCanadian("the parking meter"), "the parking meter");

// The u is dropped before -ous, in Canadian and British English alike. The rule
// that looks right here is wrong, and was written once before being caught.
check("humorous keeps no u", toCanadian("a humorous rigorous laborious day"),
  "a humorous rigorous laborious day");
check("but humour takes one", toCanadian("a sense of humor"), "a sense of humour");
// Split usage in Canada. Left alone rather than picking a side.
check("analog is left alone", toCanadian("an analog signal"), "an analog signal");
check("aging is left alone", toCanadian("an aging fleet"), "an aging fleet");

// ------------------------------------------------------------------ case

check("capitalised", toCanadian("Color me surprised"), "Colour me surprised");
check("upper case", toCanadian("COLOR"), "COLOUR");
check("mid-sentence capital is left capital",
  toCanadian("The Neighborhood Watch"), "The Neighbourhood Watch");

// ------------------------------------------------------------------ words only

check("not inside a longer word", toCanadian("colorimetry"), "colorimetry");
check("hyphenated words still match", toCanadian("off-center"), "off-centre");
check("punctuation is kept", toCanadian("color, honor; labor."), "colour, honour; labour.");

// ------------------------------------------------------------------ postal codes

check("no space", formatPostalCodes("K1A0B1"), "K1A 0B1");
check("already spaced", formatPostalCodes("K1A 0B1"), "K1A 0B1");
check("lower case", formatPostalCodes("k1a0b1"), "K1A 0B1");
check("hyphenated", formatPostalCodes("K1A-0B1"), "K1A 0B1");
check("inside a sentence",
  formatPostalCodes("mail it to k1a0b1 please"), "mail it to K1A 0B1 please");
check("in a full take", toCanadian("the color office at k1a0b1"),
  "the colour office at K1A 0B1");

// The letters postal codes never use. D, F, I, O, Q and U appear nowhere; W and Z
// never lead. Strictness is what keeps this off model numbers and part codes.
check("D is not a postal letter", formatPostalCodes("D1A0B1"), "D1A0B1");
check("W never leads", formatPostalCodes("W1A0B1"), "W1A0B1");
check("a part number is not a postal code", formatPostalCodes("AB1234"), "AB1234");

// ------------------------------------------------------------------ the obvious

check("empty stays empty", toCanadian(""), "");
check("undefined survives", toCanadian(undefined), undefined);

// The ruleset is shown to the user in Settings, so it has to be enumerable and
// non-empty, and no rule may be a no-op.
check("the ruleset is enumerable", rules().length, RULE_COUNT);
check("no rule is a no-op", rules().filter((r) => r.from === r.to).length, 0);
check("every rule is lower case",
  rules().filter((r) => r.from !== r.from.toLowerCase()).length, 0);

console.log(failures === 0
  ? `\nall ${RULE_COUNT} rules loaded, checks passed`
  : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
