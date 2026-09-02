# Bivouac's checks

`npm test`. Six harnesses. **They are not a substitute for loading the module.**

Bivouac is a Foundry module: nearly everything it does needs a running Foundry, a
canvas and a live world, none of which exist here. So rather than pretend to test
the whole thing, each harness picks something that genuinely *can* be settled
without a browser, and settles it.

## What they do

| Harness | What it pins down |
| --- | --- |
| `plate-tokens` | The reconcile pass that backs plates with hidden Tokens: parks one where a plate has no token, adds nothing where a real one exists, withdraws its own when one appears, deletes only its own, one token per actor across both bars, idempotent, sweeps every scene when switched off, and writes nothing from a non-active GM. |
| `combat` | Adding a plate's character to the encounter: batched into one call for a mob, removing only the tokens actually in it, `no-token` reported rather than swallowed when the character is not in the scene, and every degradation path (a throwing `getActiveTokens`, a token class with no combatant statics, a rejected write). |
| `conditions` | What belongs on a plate's condition strip: statuses in the world's configured order, temporary effects that grant no status, a status's label enriched from the effect that granted it (so "Concentrating: Hunter's Mark"), permanents excluded, and the fallbacks for actors without `appliedEffects` or `isTemporary`. |
| `health` | `healthFraction()` on D&D 5e and Daggerheart: full / half / zero, negative HP and over-max clamped, missing or zero maxima returning "unknown" rather than a number, and Daggerheart's pools read as damage *marked* rather than health remaining. |
| `health-systems` | The system-agnostic half: 5e temporary HP and `tempmax`; a GM-declared health row on a system with no adapter; a declared row overriding the built-in one; and that the display toggle does not gate the reading. |
| `layout` | Whether a plate's chrome fits its plate, across every size tier × all four plate shapes × 19 sizes, horizontally and vertically — plus the condition palette's column count and panel size across plausible effect counts. |
| `i18n` | Every `BIVOUAC.*` key the source references exists in `en.json`; no orphans left behind in the churned namespaces; every registered keybinding id has a name string. |
| `css` | Every `bivouac-*` class the source applies has a rule in `module.css`; every keyframe and CSS variable the stylesheet references is defined. |

Two techniques, and the distinction matters when reading a green run:

- **Bundle-and-stub** (`plate-tokens`, `health`, `health-systems`, `conditions`,
  `combat`) — esbuild the
  real module, then run it against a faked `game` / `canvas` / `CONFIG`. This
  exercises the shipped code rather than a paraphrase of it, but it proves the
  *logic*, not that the Foundry APIs it calls exist or behave as assumed.
- **Cross-reference** (`layout`, `i18n`, `css`) — read the source and the assets
  and check they agree. Cheap, and it catches a class of failure neither the
  compiler nor the linter can see, because nothing else connects a name in a
  `.ts` file to a name in a `.css` or `.json` file.

## What they have caught

Things that had already passed review:

- A six-condition overlay running into the name banner at the default plate size.
- A size tier that mishandled short, wide plates.
- A banner-height estimate that was wrong precisely where it mattered — small
  plates, where the font-size hits its floor.
- Eight i18n strings orphaned by a UI change.
- A stylesheet edit that silently deleted `.bivouac-plate--speaker`,
  `.bivouac-plate__hand` and its keyframes. The JS went on adding those classes
  perfectly happily; the speaker highlight just stopped appearing.

## What they cannot catch

Anything about how a browser actually lays out or paints.

`layout` **models** the CSS geometry, it does not execute it. The clearest
demonstration: a condition palette whose grid collapsed into a single column
running the height of the screen passed every check here. The arithmetic was
right — 30px tiles do fit nine across a 340px panel — and the failure was in CSS
sizing semantics, which only a browser resolves.

Treat a green run as "the logic is sound and the names line up", and nothing more.

## Adding one

Drop a `*.test.mjs` in this directory; `run.mjs` finds it. Exit non-zero to fail.
If it needs a module bundled, add the entry point to `BUNDLES` in `run.mjs` and
import from `./.build/<name>.mjs`.
