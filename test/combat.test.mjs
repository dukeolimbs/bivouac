/**
 * Drive the REAL combat helpers from src/widgets/foundry-api.ts against a stubbed
 * Foundry. The point of interest is not the happy path but the refusals: a plate
 * holds an Actor uuid, not a token, so "there is nothing to put in the fight" is
 * a normal outcome and has to be reported rather than swallowed.
 */
import { inCombat, sceneTokensOf, toggleCombat } from "./.build/foundry-api.mjs";

globalThis.game = { i18n: { localize: (k) => k, lang: "en" } };
globalThis.foundry = { utils: { getDocumentClass: () => TokenClass } };

/** Records what Foundry was asked to do, standing in for TokenDocument's statics. */
const calls = { created: [], deleted: [] };
class TokenClass {
  static async createCombatants(tokens) {
    calls.created.push(tokens.map((t) => t.id));
    for (const t of tokens) t.inCombat = true;
  }
  static async deleteCombatants(tokens) {
    calls.deleted.push(tokens.map((t) => t.id));
    for (const t of tokens) t.inCombat = false;
  }
}
/** A TokenDocument: its `constructor` is what the helper reaches through. */
const tok = (id, fighting = false) =>
  Object.assign(Object.create(TokenClass.prototype), { id, inCombat: fighting });

/** An Actor whose getActiveTokens returns the given tokens. */
const actor = (tokens) => ({ getActiveTokens: (_linked, _doc) => tokens });

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
const reset = () => {
  calls.created.length = 0;
  calls.deleted.length = 0;
};

console.log("\n1. The plate has a token in the scene");
{
  reset();
  const t = tok("t1");
  const a = actor([t]);
  check("not in combat to begin with", inCombat(a), false);
  check("adding reports 'added'", await toggleCombat(a), "added");
  check("and asked Foundry to create it", calls.created, [["t1"]]);
  check("now reads as in combat", inCombat(a), true);
  reset();
  check("toggling again removes", await toggleCombat(a), "removed");
  check("and asked Foundry to delete it", calls.deleted, [["t1"]]);
  check("back out", inCombat(a), false);
}

console.log("\n2. Several tokens for one actor — all of them, in one call");
{
  reset();
  const a = actor([tok("g1"), tok("g2"), tok("g3")]);
  check("added together, not one call each", await toggleCombat(a), "added");
  check("one batched create", calls.created, [["g1", "g2", "g3"]]);
}
{
  // Partly in: toggling OUT must only delete the ones actually in it, or Foundry
  // is asked to remove combatants that do not exist.
  reset();
  const a = actor([tok("g1", true), tok("g2"), tok("g3", true)]);
  check("any in combat reads as in", inCombat(a), true);
  check("toggles out", await toggleCombat(a), "removed");
  check("deletes only the ones in it", calls.deleted, [["g1", "g3"]]);
}

console.log("\n3. No token in the scene — the case a plate makes normal");
{
  reset();
  const a = actor([]);
  check("reports no-token rather than pretending", await toggleCombat(a), "no-token");
  check("and asks Foundry for nothing", [calls.created, calls.deleted], [[], []]);
  check("and reads as not in combat", inCombat(a), false);
}

console.log("\n4. Degrading rather than throwing");
{
  check("null actor", await toggleCombat(null), "no-token");
  check("an actor with no getActiveTokens", await toggleCombat({}), "no-token");
  check("sceneTokensOf on null", sceneTokensOf(null), []);
}
{
  const a = { getActiveTokens: () => { throw new Error("canvas not ready"); } };
  check("a throwing getActiveTokens", await toggleCombat(a), "no-token");
  check("inCombat survives it too", inCombat(a), false);
}
{
  // A token whose class has no combatant statics at all: report failure rather
  // than claiming success.
  const orphan = { id: "x", inCombat: false, constructor: {} };
  check("no createCombatants available", await toggleCombat(actor([orphan])), "failed");
}
{
  const boom = Object.assign(Object.create(TokenClass.prototype), { id: "b" });
  const a = actor([boom]);
  const saved = TokenClass.createCombatants;
  TokenClass.createCombatants = async () => {
    throw new Error("no permission");
  };
  check("a rejected create reports failed", await toggleCombat(a), "failed");
  TokenClass.createCombatants = saved;
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed) process.exitCode = 1;
