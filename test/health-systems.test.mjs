/** healthFraction() — the dnd5e specifics and the system-agnostic path. */
import { healthFraction } from "./.build/systems.mjs";

globalThis.CONFIG = { DND5E: {} };
globalThis.foundry = { utils: { deepClone: (o) => structuredClone(o) } };

function world(systemId, custom = [], statsOn = true) {
  globalThis.game = {
    system: { id: systemId },
    i18n: { localize: (k) => k },
    settings: {
      get: (_m, k) => {
        if (k === "castSystem") return "auto";
        if (k === "customStats") return custom;
        return statsOn;
      },
    },
  };
}

const results = [];
const check = (name, got, want) => {
  const ok =
    got === want ||
    (typeof got === "number" && typeof want === "number" && Math.abs(got - want) < 1e-9);
  results.push(ok);
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}  → ${got}${ok ? "" : ` (wanted ${want})`}`);
};

const dnd = (hp) => healthFraction({ system: { attributes: { hp } } });

console.log("\ndnd5e — temporary HP counts as health (it is spent first)");
world("dnd5e");
check("10/40 bare = a quarter", dnd({ value: 10, max: 40 }), 0.25);
check("10/40 + 10 temp = half", dnd({ value: 10, max: 40, temp: 10 }), 0.5);
check("10/40 + 30 temp clamps to full", dnd({ value: 10, max: 40, temp: 30 }), 1);
check("10/40 + 50 temp still clamps to 1", dnd({ value: 10, max: 40, temp: 50 }), 1);
check("temp null is ignored", dnd({ value: 20, max: 40, temp: null }), 0.5);
check("temp 0 is ignored", dnd({ value: 20, max: 40, temp: 0 }), 0.5);

console.log("\ndnd5e — tempmax raises the denominator");
check("20/40 +40 tempmax = a quarter", dnd({ value: 20, max: 40, tempmax: 40 }), 0.25);
check("tempmax with temp", dnd({ value: 20, max: 40, temp: 20, tempmax: 40 }), 0.5);
check("negative tempmax lowers it", dnd({ value: 10, max: 40, tempmax: -20 }), 0.5);
check("tempmax cancelling max out → unknown", dnd({ value: 0, max: 40, tempmax: -40 }), null);

console.log("\ndnd5e — a dying / dead PC still reads as 0, not unknown");
check("0 HP", dnd({ value: 0, max: 40 }), 0);
check("0 HP with 0 temp", dnd({ value: 0, max: 40, temp: 0 }), 0);
check("negative HP", dnd({ value: -8, max: 40 }), 0);

console.log("\nunsupported system + a GM-declared health row (the agnostic path)");
const row = {
  id: "hp1",
  name: "Vitality",
  icon: "fa-heart",
  path: "vitality.current",
  maxPath: "vitality.cap",
  reverse: false,
  health: true,
};
world("someIndieSystem", [row]);
const indie = (current, cap) =>
  healthFraction({ system: { vitality: { current, cap } } });
check("half", indie(5, 10), 0.5);
check("full", indie(10, 10), 1);
check("empty", indie(0, 10), 0);
check("works with the row's display toggle OFF", (world("someIndieSystem", [row], false), indie(5, 10)), 0.5);

console.log("\na custom row declared health but with NO max path is refused");
world("someIndieSystem", [{ ...row, maxPath: "" }]);
check("no denominator → unknown", indie(5, 10), null);

console.log("\na custom row not declared health does not become one");
world("someIndieSystem", [{ ...row, health: false }]);
check("unmarked row → unknown", indie(5, 10), null);

console.log("\na GM's declared row OVERRIDES the adapter's built-in");
// dnd5e's own hp says 100%; the GM points health at a different pool saying 25%.
world("dnd5e", [
  { ...row, id: "hp2", path: "resources.grit.value", maxPath: "resources.grit.max" },
]);
check(
  "custom wins over dnd5e hp",
  healthFraction({
    system: {
      attributes: { hp: { value: 40, max: 40 } },
      resources: { grit: { value: 1, max: 4 } },
    },
  }),
  0.25,
);

console.log("\nreverse still works on a custom row (marked-damage pools)");
world("someIndieSystem", [{ ...row, reverse: true }]);
check("3 of 6 marked = half health", indie(3, 6), 0.5);
check("6 of 6 marked = down", indie(6, 6), 0);
// A reversed pool has no buffer concept — temp must not be added to marked damage.
check("full marked, reversed", indie(0, 6), 1);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed) process.exitCode = 1;
