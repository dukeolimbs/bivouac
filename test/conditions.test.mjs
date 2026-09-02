/**
 * Drive the REAL conditionBadges() from src/widgets/foundry-api.ts against a
 * stubbed Foundry, so the shipped decision about what belongs on a plate's
 * condition strip is pinned down rather than reasoned about.
 */
import { conditionBadges } from "./.build/foundry-api.mjs";

globalThis.game = { i18n: { localize: (k) => k, lang: "en" } };

/** The world's configured status effects, in order. */
function statusConfig(list) {
  globalThis.CONFIG = { statusEffects: list };
}
const CORE = [
  { id: "prone", name: "Prone", img: "icons/prone.svg" },
  { id: "poisoned", name: "Poisoned", img: "icons/poisoned.svg" },
  { id: "concentrating", name: "Concentrating", img: "icons/concentrating.svg" },
];

/** An ActiveEffect as `appliedEffects` yields it (already active-filtered). */
function eff(name, { statuses = [], temporary = true, img = "icons/e.svg", id } = {}) {
  return { id: id ?? name, name, img, statuses: new Set(statuses), isTemporary: temporary };
}
function actor({ statuses = [], applied = [] } = {}) {
  return { statuses: new Set(statuses), appliedEffects: applied };
}

const results = [];
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}`);
  if (!ok) {
    console.log(`        got  ${JSON.stringify(got)}`);
    console.log(`        want ${JSON.stringify(want)}`);
  }
}
const labels = (a) => conditionBadges(a).map((b) => b.label);
const kinds = (a) => conditionBadges(a).map((b) => (b.effect ? "effect" : "status"));

statusConfig(CORE);

console.log("\n1. Status conditions still work, in the world's configured order");
check(
  "config order, not actor order",
  labels(actor({ statuses: ["poisoned", "prone"] })),
  ["Prone", "Poisoned"],
);
check("nothing applied → nothing shown", labels(actor()), []);
check(
  "an unrecognised status is skipped, not drawn broken",
  labels(actor({ statuses: ["prone", "notAThing"] })),
  ["Prone"],
);

console.log("\n2. The point of the exercise: concentration names its spell");
{
  // dnd5e applies one effect carrying the `concentrating` status, named for the spell.
  const a = actor({
    statuses: ["concentrating"],
    applied: [eff("Concentrating: Hunter's Mark", { statuses: ["concentrating"] })],
  });
  check("status label enriched from the granting effect", labels(a), [
    "Concentrating: Hunter's Mark",
  ]);
  check("still reported as a status, not an effect", kinds(a), ["status"]);
}
{
  // An effect that merely restates the condition must NOT double up the label.
  const a = actor({ statuses: ["prone"], applied: [eff("Prone", { statuses: ["prone"] })] });
  check("a same-named effect leaves the label alone", labels(a), ["Prone"]);
}
{
  const a = actor({
    statuses: ["concentrating"],
    applied: [
      eff("Concentrating: Bless", { statuses: ["concentrating"], id: "c1" }),
      eff("Concentrating: Bane", { statuses: ["concentrating"], id: "c2" }),
    ],
  });
  check("two granting effects are both named", labels(a), [
    "Concentrating: Bless · Concentrating: Bane",
  ]);
}

console.log("\n3. Temporary effects with no status of their own are shown");
{
  const a = actor({ applied: [eff("Bless"), eff("Bardic Inspiration")] });
  check("shown, sorted by name for a stable strip", labels(a), ["Bardic Inspiration", "Bless"]);
  check("marked as effects, not statuses", kinds(a), ["effect", "effect"]);
}
{
  const a = actor({
    statuses: ["poisoned"],
    applied: [eff("Poisoned", { statuses: ["poisoned"] }), eff("Bless")],
  });
  check("statuses first, then effects", labels(a), ["Poisoned", "Bless"]);
  check("and typed accordingly", kinds(a), ["status", "effect"]);
}

console.log("\n4. PERMANENT effects stay out — the portrait-burying guard");
{
  const a = actor({
    applied: [
      eff("Darkvision", { temporary: false }),
      eff("Unarmoured Defence", { temporary: false }),
      eff("Bless"),
    ],
  });
  check("only the temporary one appears", labels(a), ["Bless"]);
}
{
  // A permanent effect that grants a status still shows via the status branch —
  // it is a state the character is in, which is the thing being asked about.
  const a = actor({
    statuses: ["prone"],
    applied: [eff("Prone", { statuses: ["prone"], temporary: false })],
  });
  check("a permanent STATUS is still shown", labels(a), ["Prone"]);
}

console.log("\n5. Falling back when `appliedEffects` is absent");
{
  // Older/other shapes: filter disabled and suppressed by hand.
  const a = {
    statuses: new Set(),
    effects: [
      { name: "Bless", img: "i", statuses: new Set(), isTemporary: true },
      { name: "Off", img: "i", statuses: new Set(), isTemporary: true, disabled: true },
      { name: "Gone", img: "i", statuses: new Set(), isTemporary: true, isSuppressed: true },
    ],
  };
  check("disabled and suppressed dropped", labels(a), ["Bless"]);
}
{
  // No `isTemporary` getter — derive from the duration shape instead.
  const a = {
    statuses: new Set(),
    appliedEffects: [
      { name: "Timed", img: "i", statuses: new Set(), duration: { rounds: 10 } },
      { name: "Expiring", img: "i", statuses: new Set(), duration: { expiry: 123 } },
      { name: "Forever", img: "i", statuses: new Set(), duration: {} },
    ],
  };
  check("duration shape stands in for isTemporary", labels(a), ["Expiring", "Timed"]);
}

console.log("\n6. Degrading rather than throwing");
check("null actor", conditionBadges(null), []);
check("empty object", conditionBadges({}), []);
check(
  "an actor whose statuses is not a Set",
  labels({ statuses: "poisoned", appliedEffects: [] }),
  [],
);
{
  const a = { statuses: new Set(), get appliedEffects() { throw new Error("boom"); } };
  check("a throwing getter is survived", conditionBadges(a), []);
}
{
  statusConfig(undefined);
  const a = actor({ statuses: ["prone"], applied: [eff("Bless")] });
  check("no statusEffects config → effects still shown", labels(a), ["Bless"]);
  statusConfig(CORE);
}
{
  const a = actor({ applied: [eff("", { statuses: [] })] });
  check("an unnamed effect is dropped rather than drawn blank", labels(a), []);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed) process.exitCode = 1;
