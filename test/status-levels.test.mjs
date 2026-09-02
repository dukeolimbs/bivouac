/**
 * Levelled statuses — the real `levelledStatus` / `statusLevel` /
 * `setStatusLevel` from src/systems.ts against a stubbed world.
 *
 * The point of pinning these: the palette's additive click and the plate's level
 * badge both hang off them, and BOTH have to fall back to the plain on/off
 * toggle for every status but the one. A regression here would not throw — it
 * would quietly write a level nothing reads, or draw a badge on a condition that
 * has no levels.
 */
import { levelledStatus, setStatusLevel, statusLevel } from "./.build/systems.mjs";

/** A world running `systemId`, whose status config is `effects`. */
function world(systemId, effects) {
  globalThis.game = { system: { id: systemId }, i18n: { localize: (k) => k } };
  globalThis.CONFIG = { statusEffects: effects };
}
const DND = [
  { id: "prone", name: "Prone" },
  { id: "exhaustion", name: "Exhaustion", levels: 6 },
];

const results = [];
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}  → ${JSON.stringify(got)}`);
  if (!ok) console.log(`        wanted ${JSON.stringify(want)}`);
}
const actor = (exhaustion) => ({ system: { attributes: { exhaustion } } });

console.log("\n1. Which statuses are levelled");
world("dnd5e", DND);
check("dnd5e exhaustion", levelledStatus("exhaustion"), {
  path: "system.attributes.exhaustion",
  max: 6,
});
check("dnd5e prone is a plain toggle", levelledStatus("prone"), null);
check("an id the world does not have", levelledStatus("nonsense"), null);

console.log("\n2. The COUNT comes from the world, not from us");
world("dnd5e", [{ id: "exhaustion", levels: 10 }]);
check("a homebrewed 10 levels is respected", levelledStatus("exhaustion")?.max, 10);
world("dnd5e", [{ id: "exhaustion", levels: 1 }]);
check("one level is nothing to count → toggle", levelledStatus("exhaustion"), null);
world("dnd5e", [{ id: "exhaustion" }]);
check("no levels at all → toggle", levelledStatus("exhaustion"), null);

console.log("\n3. Another system's exhaustion is NOT assumed to work the same way");
world("daggerheart", DND);
check("daggerheart", levelledStatus("exhaustion"), null);
world("pf2e", DND);
check("pf2e", levelledStatus("exhaustion"), null);

console.log("\n4. Reading a level");
world("dnd5e", DND);
check("3", statusLevel(actor(3), "exhaustion"), 3);
check("0 = has the attribute, not the condition", statusLevel(actor(0), "exhaustion"), 0);
check("clamped to the configured max", statusLevel(actor(9), "exhaustion"), 6);
check("negative clamps to 0", statusLevel(actor(-2), "exhaustion"), 0);
check("truncated, never rounded up", statusLevel(actor(2.7), "exhaustion"), 2);
check("an actor type without the attribute → null", statusLevel({ system: {} }, "exhaustion"), null);
check("no actor → null", statusLevel(null, "exhaustion"), null);
check("a non-levelled status → null, not 0", statusLevel(actor(3), "prone"), null);

console.log("\n5. Writing a level");
async function write(from, to, id = "exhaustion") {
  const a = actor(from);
  const seen = [];
  a.update = async (d) => seen.push(d);
  const acted = await setStatusLevel(a, id, to);
  return { acted, seen };
}
check("2 → 3", await write(2, 3), {
  acted: true,
  seen: [{ "system.attributes.exhaustion": 3 }],
});
check("clamped at the top, and so unchanged → no write", await write(6, 7), {
  acted: false,
  seen: [],
});
check("stepping below 0 clears to 0", await write(1, 0), {
  acted: true,
  seen: [{ "system.attributes.exhaustion": 0 }],
});
check("already 0, stepping down → no write", await write(0, -1), { acted: false, seen: [] });
check("a non-levelled status is never written", await write(2, 3, "prone"), {
  acted: false,
  seen: [],
});
check(
  "a document with no update() → false, no throw",
  await setStatusLevel(actor(1), "exhaustion", 2),
  false,
);

const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} checks passed`);
if (bad) process.exitCode = 1;
