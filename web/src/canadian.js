// Canadian English, applied to a finished transcript.
//
// ROADMAP.md 6.3 and docs/COMPETITIVE.md §4 have the reasoning; the short version
// is that this is a *default*, not a capability. Wispr Flow already ships English
// – Canadian on Mac and Windows. What it does not do is ever switch itself on:
// its onboarding auto-selects British for the UK, Australia, New Zealand, Ireland
// and South Africa, and Canada is not on that list, so Canadians dictate "colour"
// and get "color" back and have to already know a setting exists. A feature that
// never turns itself on is, for almost everyone, a feature that is not there.
//
// Three decisions worth keeping:
//
// **A local ruleset, not a language parameter.** Nothing here asks Deepgram for
// `en-CA`. Whether nova-3 accepts it, and what orthography it emits if it does, is
// unverified, and the roadmap says to spike that before depending on it. A
// deterministic local pass is free, offline-safe, identical on all three clients,
// and reviewable as a diff, which is the one thing a cloud model cannot promise:
// it cannot tell you in advance what it will do to your sentence.
//
// **Canadian is neither American nor British.** It takes British `-our` and `-re`
// (colour, centre, defence, kilometre) with American `-ize` (organize, recognize),
// and keeps `tire`, `aluminum` and `program`. Setting a dialect flag to `en-GB`
// gets about half of it wrong, in the direction a Canadian reader notices most.
// So there are no `-ise` rules here, deliberately: American and Canadian already
// agree, and "fixing" them would be the bug.
//
// **Under-correcting beats mangling.** Every rule here is one a Canadian reader
// would call wrong in the other direction. The ones left out are listed at the
// bottom with the reason, because the temptation to add them will come back.

/**
 * American spelling on the left, Canadian on the right. Lower case only: the
 * matcher restores the capitalisation of whatever it found.
 *
 * Order does not matter; each entry is matched on whole words.
 */
const WORDS = [
  // -our. The most visible group, and the one people mention first.
  ["color", "colour"], ["colors", "colours"], ["colored", "coloured"],
  ["coloring", "colouring"], ["colorful", "colourful"], ["colorless", "colourless"],
  ["favor", "favour"], ["favors", "favours"], ["favored", "favoured"],
  ["favorite", "favourite"], ["favorites", "favourites"], ["favorable", "favourable"],
  ["honor", "honour"], ["honors", "honours"], ["honored", "honoured"],
  ["honorable", "honourable"],
  ["labor", "labour"], ["labors", "labours"], ["labored", "laboured"],
  ["neighbor", "neighbour"], ["neighbors", "neighbours"],
  ["neighborhood", "neighbourhood"], ["neighborhoods", "neighbourhoods"],
  ["behavior", "behaviour"], ["behaviors", "behaviours"], ["behavioral", "behavioural"],
  ["flavor", "flavour"], ["flavors", "flavours"], ["flavored", "flavoured"],
  // `humour` takes the u; `humorous` does not, in Canadian or British English,
  // and neither does `rigorous` or `laborious`. The u is dropped before `-ous`.
  // Adding the obvious rule here would have shipped a misspelling.
  ["humor", "humour"],
  ["rumor", "rumour"], ["rumors", "rumours"],
  ["odor", "odour"], ["odors", "odours"],
  ["vapor", "vapour"], ["vapors", "vapours"],
  ["harbor", "harbour"], ["harbors", "harbours"],
  ["savor", "savour"], ["savory", "savoury"],
  ["endeavor", "endeavour"], ["endeavors", "endeavours"],
  ["valor", "valour"], ["splendor", "splendour"], ["rigor", "rigour"],
  ["armor", "armour"], ["armored", "armoured"],

  // -re. `meter` is deliberately absent; see the notes below.
  ["center", "centre"], ["centers", "centres"], ["centered", "centred"],
  ["centering", "centring"],
  ["theater", "theatre"], ["theaters", "theatres"],
  ["liter", "litre"], ["liters", "litres"],
  ["kilometer", "kilometre"], ["kilometers", "kilometres"],
  ["centimeter", "centimetre"], ["centimeters", "centimetres"],
  ["millimeter", "millimetre"], ["millimeters", "millimetres"],
  ["milliliter", "millilitre"], ["milliliters", "millilitres"],
  ["fiber", "fibre"], ["fibers", "fibres"],
  ["caliber", "calibre"], ["somber", "sombre"], ["specter", "spectre"],

  // -ce on nouns that have no verb to be confused with.
  ["defense", "defence"], ["defenses", "defences"],
  ["offense", "offence"], ["offenses", "offences"],
  ["pretense", "pretence"],

  // Doubled consonant before a suffix.
  ["traveled", "travelled"], ["traveling", "travelling"], ["traveler", "traveller"],
  ["travelers", "travellers"],
  ["canceled", "cancelled"], ["canceling", "cancelling"],
  ["modeled", "modelled"], ["modeling", "modelling"],
  ["labeled", "labelled"], ["labeling", "labelling"],
  ["fueled", "fuelled"], ["fueling", "fuelling"],
  ["counseled", "counselled"], ["counseling", "counselling"], ["counselor", "counsellor"],
  ["marvelous", "marvellous"], ["jewelry", "jewellery"],
  ["enrollment", "enrolment"], ["fulfillment", "fulfilment"],

  // Everything else that comes up in ordinary writing.
  ["gray", "grey"], ["grayer", "greyer"],
  ["catalog", "catalogue"], ["catalogs", "catalogues"],
  ["dialog", "dialogue"], ["dialogs", "dialogues"],
];

// Two that were written and then taken out, for the same reason as the list
// below: Canadian usage is genuinely split and this pass is not the place to
// pick a side. `analog` is standard in Canadian technical writing even where
// `catalogue` and `dialogue` keep the -ue, and `aging` is at least as common in
// Canada as `ageing`. Correcting either would be imposing a preference rather
// than fixing a mistake.

// `draft` is not on that list. In Canada a draft is a draft: a document, a hockey
// draft, a bank draft. `draught` is the rare one, for beer and a cold current of
// air, and guessing which was meant needs the sentence read.

/**
 * Words this pass deliberately leaves alone, and why. Kept in the file rather
 * than in a commit message because the next person to look at this will want to
 * add one of them.
 *
 *   check / cheque  — Canadian uses `cheque` for the bank instrument and `check`
 *                     for everything else. "Check the box", "a reality check",
 *                     "check in". Telling them apart needs to know what the
 *                     sentence is about, and getting it wrong turns ordinary
 *                     English into nonsense. The single highest-risk rule there
 *                     is; left out on purpose.
 *   license/licence — Canadian: `licence` the noun, `license` the verb. Same
 *   practice/practise  problem, same answer.
 *   meter / metre   — `metre` is the unit, `meter` is the device, and a parking
 *                     meter stays a meter. The compounds (kilometre, centimetre)
 *                     are unambiguous and are included.
 *   -ise            — American and Canadian agree on `-ize`. Converting would be
 *                     a bug, not a feature.
 *   tire, aluminum, program, curb — already Canadian. Nothing to do.
 */
export const LEFT_ALONE = [
  ["check", "cheque", "only the bank instrument is a cheque, and a sentence has to be read to tell"],
  ["license", "licence", "noun and verb differ; needs to know which one this is"],
  ["practice", "practise", "same"],
  ["meter", "metre", "the unit is a metre, the device is a meter; the compounds are covered"],
];

const MAP = new Map(WORDS);

// One pass over the text, whole words only. Built once: this runs on every take.
const PATTERN = new RegExp(`\\b(${WORDS.map(([a]) => a).join("|")})\\b`, "gi");

/** Match the shape of what was found: colour, Colour, COLOUR. */
function matchCase(found, replacement) {
  if (found === found.toUpperCase() && found !== found.toLowerCase()) {
    return replacement.toUpperCase();
  }
  if (found[0] === found[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * A Canadian postal code, formatted the way Canada Post writes it: `K1A 0B1`.
 * One space, upper case. Dictation gives back "k1a0b1" or "K1A0B1" or the right
 * thing already, and a postal code with no space in it is the sort of detail that
 * makes a form reject an address.
 *
 * The letter sets are the real ones rather than `[A-Z]`: D, F, I, O, Q and U are
 * never used in a postal code, and W and Z never start one. Being strict is what
 * keeps this off things that merely look similar, which is most model numbers.
 */
const POSTAL = /\b([ABCEGHJ-NPRSTVXY])(\d)([ABCEGHJ-NPRSTV-Z])[ -]?(\d)([ABCEGHJ-NPRSTV-Z])(\d)\b/gi;

export function formatPostalCodes(text) {
  return text.replace(POSTAL, (_, a, b, c, d, e, f) =>
    `${a}${b}${c}`.toUpperCase() + " " + `${d}${e}${f}`.toUpperCase());
}

/** The whole pass. Pure, synchronous, and safe to run on any string. */
export function toCanadian(text) {
  if (!text) return text;
  const spelled = text.replace(PATTERN, (found) => {
    const to = MAP.get(found.toLowerCase());
    return to ? matchCase(found, to) : found;
  });
  return formatPostalCodes(spelled);
}

/**
 * Does this device look Canadian? This is the whole feature, per the roadmap:
 * getting the default right is most of the value, because a Canadian who has to
 * go looking for the setting is exactly where Wispr Flow already leaves them.
 *
 * Language first, because someone who set `en-CA` has said so. Timezone second,
 * for the much more common case of a machine left on `en-US` in Toronto. Both are
 * only a default: the toggle wins once anybody touches it, since plenty of
 * Canadians write to American house styles for work.
 */
export function looksCanadian() {
  try {
    const langs = [navigator.language, ...(navigator.languages || [])].filter(Boolean);
    if (langs.some((l) => /^en-CA$/i.test(l))) return true;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    return /^America\/(Toronto|Montreal|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Whitehorse|Yellowknife|Iqaluit|Moncton|Glace_Bay|Goose_Bay|Rankin_Inlet|Resolute|Creston|Dawson|Dawson_Creek|Fort_Nelson|Inuvik|Cambridge_Bay|Swift_Current|Thunder_Bay|Nipigon|Rainy_River|Atikokan|Blanc-Sablon|Pangnirtung)$/.test(zone);
  } catch {
    return false;
  }
}

/** For Settings, which shows the ruleset rather than asking for trust. */
export function rules() {
  return WORDS.map(([from, to]) => ({ from, to }));
}

export const RULE_COUNT = WORDS.length;
