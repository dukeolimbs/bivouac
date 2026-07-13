# Bivouac

A persistent, modular **campaign landing page** for [Foundry VTT](https://foundryvtt.com/) — a
zoomable "table surface" of tiles (web views, images, notes, actors, journals, rollable tables,
macros, card collections…) laid over a scene, plus a GM-only **DM screen** drawer for the tools
you want at hand during play.

> Status: early and actively developed (**v0.1.0**). Expect rapid change.

Built with **TypeScript + Vite**, targeting Foundry **v13+** (verified on v14).

---

## What it is

- **Landing board** — designate any scene as a landing page and lay out a grid of tiles on it.
  The board tracks the scene's pan/zoom, so tile chrome stays crisp at any zoom while content
  scales with the map. Any number of scenes can be landing pages.
- **DM screen** — a per-GM drawer that docks to any edge (beside / over the sidebar, or left /
  top / bottom), is drag-resizable, and arranges its own tiles in a dynamic row grid.

## Tiles

- **Web view** — embed a site (e.g. LegendKeeper); browser-style Content Zoom; graceful
  placeholder / pop-out for sites that refuse embedding.
- **Image** — click actions (open sheet / journal / run macro), fit + framing options.
- **Note** — rich HTML with Foundry enrichment (`@UUID` links, inline rolls), keyboard
  formatting + paste-to-link, per-note font (incl. Google Fonts) and size; scales to the tile.
- **Actor / Journal / Rollable table / Macro** — drag a document onto the board (in edit mode)
  or the DM screen to create a live, permission-gated tile: an actor portrait that opens its
  sheet, an inline journal page (or link), a visual rollable table that rolls and highlights the
  result row, a configurable macro button.
- **Card collection** — a hand of cards (fan / row / grid). Drop actors/items in (duplicates
  allowed); drag a card onto the scene to place its token (or, in edit mode, a tile); reorder,
  remove, and name-display options.
- Every tile has independent **Frame** (border) and **Background** (none / solid / frosted /
  gradient / image) styling with colour + opacity.

## Requirements

- Foundry VTT **v13+** (verified on v14).

## Install (development)

The build output (`dist/`) is git-ignored and produced by Vite.

```bash
npm install
npm run build      # bundle src/module.ts → dist/module.js and copy public/ → dist/
npm run link       # junction dist/ into Foundry's modules folder (dev)
```

Then enable **Bivouac** in a world. (`npm run link` / `package` use helper scripts kept in the
workspace root outside this repo; if you don't have them, symlink the built `dist/` into
`Data/modules/bivouac/` yourself.)

## Development

| Command             | What it does                                                |
| ------------------- | ----------------------------------------------------------- |
| `npm run watch`     | Rebuild on every save.                                      |
| `npm run typecheck` | Type-check (`tsc --noEmit`).                                |
| `npm run lint`      | Lint `src/`.                                                |
| `npm run build`     | One-off production bundle.                                  |

- Foundry globals (`game`, `canvas`, `foundry`, …) are typed as `any` via `src/foundry-shim.d.ts`.
- Bundles to a single ESM (`dist/module.js`); styles in `public/styles/module.css`; **all**
  user-facing copy in `public/lang/en.json`.
- JavaScript changes need a Foundry page reload; enable Foundry's Hot Reload for CSS/lang.

## Releasing

`.github/workflows/release.yml` cuts a GitHub Release when you push a version tag — it builds,
rewrites `module.json` with the tag version + release URLs, and attaches `module.json` +
`module.zip`:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Users then install from the latest manifest URL:
`https://github.com/<owner>/bivouac/releases/latest/download/module.json`

## Project structure

```
src/
  module.ts         Init/hooks, settings, scene-control toolbar, doc-tile refresh
  world-layer.ts    The board: DOM-over-canvas surface, screen-space tile layout, drag/resize
  dm-screen.ts      The GM DM-screen drawer (dock edges, resize, row grid, drop targets)
  widgets.ts        Tile registry + renderers (webview/image/note/actor/journal/table/macro/cards)
  widget-config.ts  Per-tile configuration dialog + live preview
  drop.ts           Parse Foundry document drags → tiles
  layout.ts         Persistence (scene flags = board, user flags = DM screen) + undo/redo
  constants.ts      Data model, settings keys, permission helper
public/
  module.json       Foundry manifest    lang/en.json   UI copy    styles/module.css   Styles
```

## Settings

Client/world settings include the DM-screen position + tab placement, drawer size, maximum tile
size, how many live web views before level-of-detail kicks in, and the minimum user role that can
control tiles/cards.
