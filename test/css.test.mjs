/**
 * Every `bivouac-*` class the source applies must have a rule in module.css, and
 * every keyframe and CSS variable the stylesheet references must be defined.
 *
 * Exists because a range-replacement in module.css silently swallowed three
 * unrelated rules — `.bivouac-plate--speaker`, `.bivouac-plate__hand` and
 * `@keyframes bivouac-hand-wave`. The JS went on adding those classes perfectly
 * happily; the speaker highlight simply stopped appearing. Nothing in the
 * typecheck, the lint, the build or the layout harness can see that, because
 * nothing there connects a class name in a .ts file to a selector in a .css file.
 */
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync("public/styles/module.css", "utf8");

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const src = files("src")
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

/** Classes the source APPLIES or LOOKS FOR. */
const used = new Set();
const add = (re, group = 1) => {
  for (const m of src.matchAll(re)) {
    for (const c of String(m[group]).split(/\s+/)) {
      // Skip template holes like `bivouac-plate--${wound}` (expanded below).
      if (c.startsWith("bivouac-") && !c.includes("$")) used.add(c);
    }
  }
};
add(/classList\.(?:add|remove|toggle)\(\s*[`"']([^`"']+)[`"']/g);
add(/className\s*=\s*[`"']([^`"']+)[`"']/g);
add(/className\s*=\s*`([^`$]+)`/g);
add(/querySelector(?:All)?\(\s*[`"']\.([a-z0-9_-]+)/g);
add(/closest\(\s*[`"']\.([a-z0-9_-]+)/g);
add(/class="([^"$]+)"/g);

/** Interpolated class families. Expanded rather than skipped, since a missing
 *  rule for one variant of a family is exactly the kind of thing that hides. */
for (const c of [
  ...["injured", "critical"].map((s) => `bivouac-plate--${s}`),
  ...["bottom", "top", "left", "right"].map((s) => `bivouac-castdock-${s}`),
  ...["bottom", "top", "left", "right"].map((s) => `bivouac-casttab-${s}`),
])
  used.add(c);

/** Classes the CSS has a rule for. */
const styled = new Set([...css.matchAll(/\.(bivouac-[a-z0-9_-]+)/g)].map((m) => m[1]));

/** Applied deliberately with no styling of their own — structural wrappers, or
 *  markers a `renderDialogV2` listener uses to recognise its own dialog. */
const HOOKS = new Set([
  "bivouac-plate__stat", // styled through its --<key> variants
  "bivouac-pop__body", // structural wrapper inside a panel
  "bivouac-art", // dialog-scoping hook for the plate-art render listener
  "bivouac-cstats", // ditto, the custom-stats editor
  "bivouac-cstats__rows", // structural
  "bivouac-dm-scope", // scoping hook
]);

/** Dangling, PRE-EXISTING, and a real gap rather than a hook — reported as a
 *  note rather than a failure, so it stays visible without blocking. Each is a
 *  class the source applies on the strength of a comment promising CSS that was
 *  never written. */
const KNOWN_GAPS = new Set([
  // "a higher number is worse". cast-bar.ts says this exists "so the CSS can
  // colour them without re-deriving that per system" — no such rule was ever
  // added, so a Daggerheart marked-damage pool looks identical to a dnd5e
  // health pool, which is the one distinction the flag was for.
  "bivouac-plate__stat--reverse",
  "bivouac-mini__stat--reverse",
  "bivouac-cstats-launch",
  "bivouac-overridden",
  "bivouac-drawer--editing",
]);

let bad = 0;

console.log("— applied by src but NO rule in module.css —");
const dangling = [...used].filter((c) => !styled.has(c) && !HOOKS.has(c)).sort();
const missing = dangling.filter((c) => !KNOWN_GAPS.has(c));
for (const c of missing) console.log(`  MISSING  .${c}`);
if (!missing.length) console.log("  (none)");
bad += missing.length;

const gaps = dangling.filter((c) => KNOWN_GAPS.has(c));
if (gaps.length) {
  console.log("\n— known pre-existing gaps (applied, never styled; not a failure) —");
  for (const c of gaps) console.log(`  note     .${c}`);
}

console.log("\n— keyframes referenced by module.css but not defined —");
const anims = new Set(
  [...css.matchAll(/animation:\s*([a-z0-9_-]+)/g)]
    .map((m) => m[1])
    .filter((a) => !["none", "inherit", "initial", "unset"].includes(a)),
);
const defined = new Set([...css.matchAll(/@keyframes\s+([a-z0-9_-]+)/g)].map((m) => m[1]));
const lostAnims = [...anims].filter((a) => !defined.has(a)).sort();
for (const a of lostAnims) console.log(`  MISSING  @keyframes ${a}`);
if (!lostAnims.length) console.log("  (none)");
bad += lostAnims.length;

console.log("\n— CSS variables used but never defined —");
const varsUsed = new Set(
  [...css.matchAll(/var\(\s*(--bivouac-[a-z0-9_-]+)/g)].map((m) => m[1]),
);
const varsSet = new Set([...css.matchAll(/(--bivouac-[a-z0-9_-]+)\s*:/g)].map((m) => m[1]));
// Vars set from JS rather than declared in CSS.
for (const m of src.matchAll(/setProperty\(\s*[`"'](--[a-z0-9_-]+)/g)) varsSet.add(m[1]);
const lostVars = [...varsUsed].filter((v) => !varsSet.has(v)).sort();
for (const v of lostVars) console.log(`  MISSING  ${v}`);
if (!lostVars.length) console.log("  (none)");
bad += lostVars.length;

console.log(
  `\n${bad === 0 ? "PASS - no dangling class, keyframe or variable" : `FAIL - ${bad} dangling reference(s)`}`,
);
if (bad) process.exitCode = 1;
