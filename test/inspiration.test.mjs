/**
 * Inspiration — the real `inspirationOf` / `systemHasInspiration` from
 * src/systems.ts against a stubbed world.
 *
 * Two decisions worth pinning, both about the difference between "no" and "not
 * applicable":
 *
 *  • A character who has SPENT their inspiration reads `false`; an NPC, which has
 *    no such attribute, reads `null`. Both draw nothing, so the distinction is
 *    for callers — but flattening it to `Boolean(v)` would quietly make every
 *    actor answer the question, and `?? false` would make every NPC answer "no"
 *    to a question it was never asked.
 *  • Only a system with a reader offers the per-plate toggle, so a Daggerheart
 *    table is not given a switch that can never do anything.
 */
import { inspirationOf, systemHasInspiration } from "./.build/systems.mjs";

globalThis.CONFIG = { DND5E: {} };
globalThis.foundry = { utils: { deepClone: (o) => structuredClone(o) } };

/** A world running `systemId`, with the Cast Bar's system setting on "auto". */
function world(systemId, choice = "auto") {
  globalThis.game = {
    system: { id: systemId },
    i18n: { localize: (k) => k },
    settings: {
      get: (_m, k) => {
        if (k === "castSystem") return choice;
        if (k === "customStats") return [];
        return true;
      },
    },
  };
}
const pc = (inspiration) => ({ system: { attributes: { inspiration } } });

const results = [];
function check(name, got, want) {
  const ok = Object.is(got, want);
  results.push(ok);
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}  → ${JSON.stringify(got)}`);
  if (!ok) console.log(`        wanted ${JSON.stringify(want)}`);
}

console.log("\n1. dnd5e — the boolean on the actor");
world("dnd5e");
check("holds inspiration", inspirationOf(pc(true)), true);
check("spent it — false, a real answer", inspirationOf(pc(false)), false);

console.log("\n2. Actors that were never asked the question");
check("an NPC has no such attribute → null", inspirationOf({ system: { attributes: {} } }), null);
check("…not false", inspirationOf({ system: { attributes: {} } }) === false, false);
check("no system data at all", inspirationOf({}), null);
check("no actor", inspirationOf(null), null);
check("a number where a boolean should be", inspirationOf(pc(1)), null);

console.log("\n3. Which systems offer the toggle");
check("dnd5e does", systemHasInspiration(), true);
world("daggerheart");
check("daggerheart does not", systemHasInspiration(), false);
check("…and reads null for a dnd5e-shaped actor", inspirationOf(pc(true)), null);
world("pf2e");
check("an unsupported system falls to generic", systemHasInspiration(), false);

console.log("\n4. The GM's system override is honoured, not just game.system.id");
world("pf2e", "dnd5e"); // castSystem pinned to dnd5e on a pf2e world
check("pinned to dnd5e → offered", systemHasInspiration(), true);
check("…and read", inspirationOf(pc(true)), true);
world("dnd5e", "generic"); // pinned away from the real system
check("pinned to generic → not offered", systemHasInspiration(), false);

const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} checks passed`);
if (bad) process.exitCode = 1;
