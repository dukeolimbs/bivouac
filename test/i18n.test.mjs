/** Every BIVOUAC.* key referenced in src must exist in en.json, and every
 *  CastBar/CustomStats key in en.json should still be referenced somewhere. */
import fs from "node:fs";
import path from "node:path";

const j = JSON.parse(fs.readFileSync("public/lang/en.json", "utf8"));

const flat = new Set();
(function walk(o, prefix) {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") walk(v, key);
    else flat.add(key);
  }
})(j, "");

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const src = files("src").map((f) => [f, fs.readFileSync(f, "utf8")]);
const all = src.map(([, s]) => s).join("\n");

// Literal "BIVOUAC.…" strings.
const referenced = new Set([...all.matchAll(/"(BIVOUAC\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]));

// Keys built by template: `BIVOUAC.CastBar.Image${…}` and `BIVOUAC.Settings.${key}.Name`.
const dynamicPrefixes = [...all.matchAll(/`(BIVOUAC\.[A-Za-z0-9_.]*)\$\{/g)].map((m) => m[1]);

let bad = 0;
console.log("— referenced in src but MISSING from en.json —");
for (const r of [...referenced].sort()) {
  if (!flat.has(r)) {
    console.log(`  MISSING  ${r}`);
    bad++;
  }
}
if (!bad) console.log("  (none)");

// Reverse check, limited to the two namespaces this round churned.
const covered = (k) =>
  referenced.has(k) || dynamicPrefixes.some((p) => k.startsWith(p));
let orphans = 0;
console.log("\n— in en.json but UNREFERENCED (CastBar / CustomStats / Keybindings) —");
for (const k of [...flat].sort()) {
  if (!/^BIVOUAC\.(CastBar|CustomStats|Keybindings)\./.test(k)) continue;
  // Keybinding names are built as `BIVOUAC.Keybindings.${Pascal(id)}`.
  if (/^BIVOUAC\.Keybindings\./.test(k)) continue;
  if (!covered(k)) {
    console.log(`  ORPHAN   ${k}`);
    orphans++;
  }
}
if (!orphans) console.log("  (none)");

// Keybinding ids registered via castKey / register → derived names must exist.
console.log("\n— keybinding names derived from registered ids —");
const ids = [
  ...all.matchAll(/castKey\("([A-Za-z0-9_]+)"/g),
  ...all.matchAll(/game\.keybindings\.register\(MODULE_ID, "([A-Za-z0-9_]+)"/g),
].map((m) => m[1]);
for (const id of ids) {
  const key = `BIVOUAC.Keybindings.${id[0].toUpperCase()}${id.slice(1)}`;
  const ok = flat.has(key);
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "MISS"}  ${id} → ${key}`);
}

console.log(`\n${bad} missing, ${orphans} orphaned`);
if (bad || orphans) process.exitCode = 1;
