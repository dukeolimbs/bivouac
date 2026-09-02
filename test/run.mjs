/**
 * Bivouac's checks. `npm test`.
 *
 * These are not unit tests in the usual sense and it matters that nobody expects
 * them to be. Bivouac is a Foundry module: almost everything it does needs a
 * running Foundry, a canvas and a live world, none of which exist here. So each
 * harness picks a piece of logic that CAN be reasoned about in isolation and
 * pins it down, using one of two techniques:
 *
 *  • **Bundle-and-stub** — esbuild the real module, then run it against a faked
 *    `game` / `canvas` / `CONFIG`. Exercises the shipped code rather than a
 *    paraphrase of it, but proves only the logic, not the Foundry API calls.
 *  • **Cross-reference** — read the source and the assets and check they agree
 *    about names. Cheap, and it catches a whole class of failure that neither
 *    the compiler nor the linter can see.
 *
 * What they have caught, so far, that review had not: a six-condition overlay
 * running into the name banner at the default plate size; a tier that mishandled
 * short wide plates; a banner-height estimate that was wrong at small sizes;
 * eight orphaned i18n strings; and a stylesheet edit that silently deleted
 * `.bivouac-plate--speaker`, `.bivouac-plate__hand` and its keyframes.
 *
 * What they cannot catch, and have already been shown not to: anything about how
 * a browser actually lays out or paints. `layout` models the CSS geometry, it
 * does not execute it — a palette whose grid collapsed to a single column passed
 * every check here, because the arithmetic was fine and the failure was in CSS
 * sizing semantics. A live pass in Foundry is not optional.
 */
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const OUT = "test/.build";

/** Modules the bundle-and-stub harnesses import. */
const BUNDLES = [
  "src/plate-tokens.ts",
  "src/systems.ts",
  "src/widgets/foundry-api.ts",
];

async function bundle() {
  mkdirSync(OUT, { recursive: true });
  await Promise.all(
    BUNDLES.map((entry) =>
      build({
        entryPoints: [entry],
        outfile: path.join(OUT, path.basename(entry).replace(/\.ts$/, ".mjs")),
        bundle: true,
        format: "esm",
        platform: "node",
        logLevel: "error",
      }),
    ),
  );
}

function run(file) {
  return new Promise((resolve) => {
    console.log(`\n${"═".repeat(72)}\n  ${file}\n${"═".repeat(72)}`);
    const p = spawn(process.execPath, [file], { stdio: "inherit" });
    p.on("close", (code) => resolve({ file, ok: code === 0 }));
  });
}

await bundle();

const harnesses = readdirSync("test")
  .filter((f) => f.endsWith(".test.mjs"))
  .sort()
  .map((f) => path.join("test", f));

const results = [];
for (const h of harnesses) results.push(await run(h));

const failed = results.filter((r) => !r.ok);
console.log(`\n${"═".repeat(72)}`);
for (const r of results) console.log(`  ${r.ok ? "pass" : "FAIL"}  ${r.file}`);
console.log(
  `${"═".repeat(72)}\n${results.length - failed.length}/${results.length} harnesses passed\n`,
);
if (failed.length) process.exitCode = 1;
