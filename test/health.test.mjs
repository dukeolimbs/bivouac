/** Drive the REAL healthFraction() from src/systems.ts against stubbed worlds. */
import { healthFraction } from "./.build/systems.mjs";

globalThis.CONFIG = { DND5E: {} };
globalThis.foundry = { utils: { deepClone: (o) => structuredClone(o) } };

/** settings: castSystem picks the adapter; customStats must exist and be an array. */
function world(systemId, custom = []) {
  globalThis.game = {
    system: { id: systemId },
    i18n: { localize: (k) => k },
    settings: {
      get: (_m, k) => {
        if (k === "castSystem") return "auto";
        if (k === "customStats") return custom;
        return true; // every stat display toggle on — must not matter
      },
    },
  };
}

const results = [];
const check = (name, got, want) => {
  const ok = got === want || (typeof got === "number" && typeof want === "number" && Math.abs(got - want) < 1e-9);
  results.push(ok);
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}  → ${got}${ok ? "" : ` (wanted ${want})`}`);
};

console.log("\ndnd5e — health counts DOWN from max");
world("dnd5e");
check("full", healthFraction({ system: { attributes: { hp: { value: 40, max: 40 } } } }), 1);
check("half", healthFraction({ system: { attributes: { hp: { value: 20, max: 40 } } } }), 0.5);
check("down", healthFraction({ system: { attributes: { hp: { value: 0, max: 40 } } } }), 0);
check("negative HP clamps to 0", healthFraction({ system: { attributes: { hp: { value: -12, max: 40 } } } }), 0);
check("over max clamps to 1", healthFraction({ system: { attributes: { hp: { value: 55, max: 40 } } } }), 1);
check("max 0 → unknown", healthFraction({ system: { attributes: { hp: { value: 0, max: 0 } } } }), null);
check("no max → unknown", healthFraction({ system: { attributes: { hp: { value: 5 } } } }), null);
check("no hp block → unknown", healthFraction({ system: { attributes: {} } }), null);
check("not an actor shape → unknown", healthFraction({}), null);

console.log("\ndaggerheart — Hit Points count damage UP toward max (reverse)");
world("daggerheart");
const dh = (v, max) => healthFraction({ system: { resources: { hitPoints: { value: v, max } } } });
check("no damage marked = healthy", dh(0, 6), 1);
check("half marked = half health", dh(3, 6), 0.5);
check("all marked = down", dh(6, 6), 0);
check("over-marked clamps to 0", dh(9, 6), 0);
check("no max → unknown", dh(3, null), null);

console.log("\ngeneric — nothing to read");
world("someIndieSystem");
check("unsupported system → unknown", healthFraction({ system: { attributes: { hp: { value: 1, max: 10 } } } }), null);

console.log("\nregression: the display toggle must NOT gate the fraction");
world("dnd5e");
globalThis.game.settings.get = (_m, k) => {
  if (k === "castSystem") return "auto";
  if (k === "customStats") return [];
  return false; // every stat row switched OFF for display
};
check("health still readable with the HP row hidden",
  healthFraction({ system: { attributes: { hp: { value: 10, max: 40 } } } }), 0.25);

console.log("\nregression: a throwing adapter read must not propagate");
world("dnd5e");
check("bad doc shape → unknown, no throw", healthFraction({ system: null }), null);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed) process.exitCode = 1;
