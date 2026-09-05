/**
 * Which plate a raised hand belongs to — the real `raisedCharacters` /
 * `isPlayedBy` from src/widgets/foundry-api.ts against a stubbed world.
 *
 * This harness exists because of a defect found at a live table: one player
 * raising their hand put a hand on EVERY PC's plate. The rule was ownership, and
 * the world's actors had default ownership at Owner — so as far as Foundry's
 * permission test was concerned, every user owned every PC and every plate was a
 * match. The GM worked around it by dropping the party to Observer.
 *
 * So every world built below has ownership wide open (`default: OWNER`, and a
 * `testUserPermission` that says yes to everything). If any of these checks ever
 * starts passing for a plate that is not the raiser's own character, the rule has
 * drifted back to permissions.
 */
import { isPlayedBy, raisedCharacters } from "./.build/foundry-api.mjs";

const OWNER = 3;

/** users: [{id, name, isGM?, character?}] */
function world(users) {
  const map = new Map(users.map((u) => [u.id, u]));
  globalThis.game = { users: { get: (id) => map.get(id) ?? null } };
}
/** An actor every user owns — the shape that caused the bug. */
const actor = (id) => ({
  id,
  documentName: "Actor",
  ownership: { default: OWNER },
  testUserPermission: () => true,
});
/** An UNLINKED token's synthetic actor, made from sidebar actor `baseId`. */
const tokenActor = (id, baseId) => ({
  ...actor(id),
  isToken: true,
  token: { baseActor: { id: baseId } },
});

const results = [];
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}  → ${JSON.stringify(got)}`);
  if (!ok) console.log(`        wanted ${JSON.stringify(want)}`);
}
const ids = (r) => [...r.characters].sort();
const un = (r) => [...r.unassigned].sort();
/** Which of the party's plates light up for these raisers. */
function plates(raisers, party = ["a1", "a2", "a3"]) {
  const { characters } = raisedCharacters(raisers);
  return party.filter((id) => isPlayedBy(actor(id), characters));
}

const TABLE = [
  { id: "gm", name: "GM" }, // a GM with no character of their own
  { id: "u1", name: "Alice", character: { id: "a1" } },
  { id: "u2", name: "Bob", character: { id: "a2" } },
  { id: "u3", name: "Carol" }, // connected, playing nothing
];

console.log("\n1. The reported bug: one raise, one plate — not the whole party");
world(TABLE);
check("Alice raises → only Alice's character", plates(["u1"]), ["a1"]);
check("Bob raises → only Bob's", plates(["u2"]), ["a2"]);
check("both raise → both, and only both", plates(["u1", "u2"]), ["a1", "a2"]);
check("nobody raises → nothing", plates([]), []);
check("a3 is nobody's character, so it never lights", plates(["u1", "u2", "u3"]).includes("a3"), false);

console.log("\n2. A raiser with no character assigned");
check("Carol raises → no plate", plates(["u3"]), []);
check("…and she is reported, not dropped in silence", un(raisedCharacters(["u3"])), ["u3"]);
check("an assigned raiser is not reported", un(raisedCharacters(["u1"])), []);

console.log("\n3. A GM is no longer a special case");
world([{ id: "gm", name: "GM", isGM: true, character: { id: "a2" } }, ...TABLE.slice(1)]);
check("a GM playing a PC lights that PC", plates(["gm"]), ["a2"]);
check("…and still nothing else, though a GM owns everything", plates(["gm"]).length, 1);
world([{ id: "gm", name: "GM", isGM: true }, ...TABLE.slice(1)]);
check("a GM with no character lights nothing", plates(["gm"]), []);

console.log("\n4. Which document a character answers to");
world(TABLE);
const alice = raisedCharacters(["u1"]).characters;
check("the sidebar actor", isPlayedBy(actor("a1"), alice), true);
check("an unlinked token made from it", isPlayedBy(tokenActor("tok1", "a1"), alice), true);
check("an unlinked token of someone else", isPlayedBy(tokenActor("tok2", "a2"), alice), false);
check("ids are compared as strings", isPlayedBy({ id: "a1" }, new Set(["a1"])), true);

console.log("\n5. Degrading rather than throwing");
check("a stale user id is skipped", ids(raisedCharacters(["ghost"])), []);
check("…and does not count as unassigned either", un(raisedCharacters(["ghost"])), []);
check("no raisers → no work, whatever the doc", isPlayedBy(actor("a1"), new Set()), false);
check("a null doc", isPlayedBy(null, alice), false);
check("a doc with no id (an Item, a compendium stub)", isPlayedBy({}, alice), false);

const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} checks passed`);
if (bad) process.exitCode = 1;
