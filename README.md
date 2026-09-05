# Bivouac

A persistent **campaign landing page** for [Foundry VTT](https://foundryvtt.com/).

Pick any scene and Bivouac turns it into your table's home screen: a board of
**tiles** laid over the map — your wiki, session notes, character portraits,
journal pages, rollable tables, macro buttons, a hand of cards. It pans and
zooms with the scene, so it feels like a real table you've laid things out on
rather than another window.

It also gives the GM two things to run the game with: a **DM screen** drawer
that slides out from any edge with your own tools in it, and a **Cast Bar** — a
strip of character portraits that shows who's in the scene and who's talking.

## Features

- **A landing board on any scene.** Designate as many scenes as you like as
  landing pages. Tiles sit on the scene's grid and travel with the map as you
  pan and zoom, staying sharp at any zoom level.
- **Eight kinds of tile.** Web views, images, notes, actors, journals, rollable
  tables, macros, and card collections — most of them created by simply dragging
  a document out of the sidebar and onto the board.
- **Everything is styled per tile.** Each tile has its own frame and background
  — none, solid, frosted glass, gradient, or an image — with your own colour and
  opacity. A board can be as plain or as decorated as you want.
- **A DM screen that stays out of the way.** A GM-only drawer that docks beside
  the sidebar (so chat and dice stay visible), or over it, or to the left, top,
  or bottom. Drag to resize; arrange its tiles into rows.
- **A Cast Bar for narrative scenes.** A floating strip of character plates for
  roleplay-heavy moments: right-click a portrait to mark who's speaking, dim
  characters who've stepped out of the conversation, hide names players shouldn't
  know yet, apply conditions without hunting for a token, and let a plate show
  when its character is badly hurt.
- **Players can join in.** Card collections and tiles can be handed to players
  or trusted players to arrange, and every tile respects Foundry's normal
  ownership rules — a player never sees a document they don't have access to. On
  the Cast Bar, a player can leave and rejoin the conversation from their own
  plate and right-click it to mark themselves as talking.
- **Undo and redo.** `Ctrl+Z` / `Ctrl+Y` on the board, so a mistaken drag or
  delete is never a problem.
- **Look past it when you need to.** `Shift+L` takes the tiles off the table's
  screens and puts them back, leaving the map underneath fully usable for
  everyone. The scene stays a Landing Page with its layout intact — this is the
  light switch, not the demolition — and it is remembered per scene.

## Requirements

- **Foundry VTT v13 or newer** (verified on v14).
- No other modules required. Bivouac works with any game system; a few extras
  are system-specific and say so below.

## Installation

### Option A — Manifest URL (recommended)

1. In Foundry, go to the **Setup** screen → **Add-on Modules** → **Install
   Module**.
2. Paste this into the **Manifest URL** field at the bottom:

   ```
   https://github.com/dukeolimbs/bivouac/releases/latest/download/module.json
   ```

3. Click **Install**. This URL always points at the newest release, so Foundry's
   normal update check will keep you current.

### Option B — Foundry module browser

Search for **Bivouac** in **Install Module** and click Install. *(Available once
the package is listed in Foundry's registry.)*

### Then enable it

1. Load your world.
2. Open **Game Settings → Manage Modules**, tick **Bivouac**, and save.

## Quick start

1. Open the scene you want as your landing page — a decorative map, a table
   surface, even a plain colour.
2. In the scene controls on the left, open the **Landing Page** group and click
   **Set this scene as a Landing Page**.
3. Click **Arrange tiles (edit mode)**. The board is now editable.
4. Click **Add a tile**, or just **drag an actor, journal, table, or macro from
   the sidebar onto the map** — it becomes a tile where you dropped it.
5. Drag tiles to move them, drag their corner to resize, and click the gear to
   configure one. Leave edit mode when you're happy.

**Fit all tiles to view** re-frames the scene around your board, which is the
quickest way back when you've zoomed off somewhere.

## The tiles

| Tile | What it's for |
| --- | --- |
| **Web view** | Embeds a web page — a campaign wiki, LegendKeeper, a shared doc, a music player. Has its own **Content zoom** so you can fit a page nicely into a small tile. |
| **Image** | A picture that can do something when clicked: open an actor or item sheet, open a journal, or run a macro. Good for hand-drawn menus and hotspots. |
| **Note** | Rich text with full Foundry enrichment — `@UUID` links and inline `[[/r 1d20]]` rolls work. Select and `Ctrl+B`/`I`/`U` to format; paste a URL over selected text to link it. Choose any Foundry font or name a Google Font. |
| **Meter** | One number, drawn as a **gauge** (bar or dial), a **circle** — a ring of segments filling clockwise from the bottom, with an icon of your choice in the middle — a **sliding scale** with a draggable handle, or a **token pool** of pips. Drag or click it during play to change it and everyone sees the new value. Good for doom clocks, Fear/Hope pools, supplies, or a countdown. |
| **Actor** | A portrait that opens the sheet. Drag an actor onto the board. |
| **Journal** | A journal page shown inline on the board, or as a link that opens it. |
| **Rollable table** | The table's entries listed out; press **Roll** and it draws, then highlights and scrolls to the winning row. |
| **Macro** | A button that runs a macro, with the icon and title shown or hidden and sized to taste. |
| **Card collection** | A hand of cards laid out as a **fan**, a row, or a grid. Drop actors or items in to add cards; drag a card onto the scene to place its token. Handy as an NPC roster, a loot pile, or a Daggerheart domain hand. |

All tiles have a **Visibility** setting — *Everyone* or *GM only* — on top of
Foundry's own permissions.

> **A note on web views:** some sites (GitHub, Google, X, most login pages)
> refuse to be embedded anywhere and will stay blank. That's their policy, not a
> bug — use the ⇗ button on the tile to open them in a window instead. Wikis,
> docs, dashboards, and LegendKeeper embed fine.

## The DM screen

A drawer only the GM sees, opened from its own tab at the screen edge. It holds
the same kinds of tiles as the board — your notes, a rules table, the initiative
macro — and is completely separate from any scene, so it follows you everywhere.

- **Position** — set **DM screen position** in the settings, or the gear in the
  drawer's header: beside the sidebar (the default, which keeps chat and dice
  usable), over the sidebar, or from the left, top, or bottom.
- **Resize** — drag the drawer's inner edge. The size is remembered.
- **Arrange** — in the drawer's edit mode, drag a tile beside another to share
  its row, or above/below it to start a new one.

## The Cast Bar

A floating strip of character **plates** — a portrait and a name — for running
narrative encounters. It answers "who's in this conversation, and who's
speaking?" without putting tokens on a map.

- **Adding characters** — drag an actor onto the bar. You'll be asked which
  image the plate should use: the actor's **profile** picture, its **token** art,
  or a **custom** image. (Getting from *no* plates to the first one still needs
  Bivouac's edit mode, since an empty bar has nothing to drop onto.)
- **Speaking and sheets** — one action per mouse button, one click each:
  **left-click** a plate to open the sheet, **right-click** to mark that
  character as the current speaker (they highlight green). Right-click again to
  clear it.
- **The hover controls** (GM) — along the top of a plate:
  - a **grip** to drag plates into a different order,
  - **exit / rejoin** the conversation — the plate dims: still in the scene, just
    not part of this exchange,
  - **add to / remove from the encounter** — when the conversation turns into a
    fight, put that character in the initiative order without leaving the bar.
    Lit while they're in it. It needs a token in the scene to make a combatant
    out of, and says so if there isn't one.
  - **conditions** — opens a palette of the world's status effects to apply and
    clear, the same job the token HUD's effects button does. A condition that
    has levels rather than being simply on or off — exhaustion — counts up on
    click and back down on right-click, and shows the level it is on,
  - **⋯** — everything you set up once rather than mid-conversation (below).
- **The plate menu** (the **⋯** control, or `Shift+M`):
  - *Visibility* — in the conversation, **hidden from players** (gone from their
    view entirely), **name shown to players** (otherwise they see **?**). New
    plates start name-hidden, and Bivouac remembers your choice per actor.
  - *Overlays* — the **stat overlay**, how much of the **conditions** display to
    reveal (off, you only, or everyone), and — on a system that has it — an
    **inspiration** die, a glowing gold d20 after the character's name while they
    hold one — shown to everyone.
  - *Appearance* — **plate art**, including the wounded variants below.
  - **Remove from the bar.**
- **Conditions and running effects on a plate** — show a character's conditions
  as icons on their portrait, revealed per plate: off, GM-only, or to everyone.
  Alongside the conditions you get **temporary effects** — Bless, Bardic
  Inspiration, a Hunter's Mark — marked with a faint ring so you can tell a state
  the character is *in* from something running *on* them. And where an effect
  named a condition, the plate says so: concentration reads **Concentrating:
  Hunter's Mark**, not a bare "Concentrating". Permanent effects stay out, so a
  PC's racial and feat effects can't bury the portrait. A levelled condition
  carries its number on the icon, so exhaustion 1 and exhaustion 6 don't look
  alike. A plate that uses **token** art starts with all of this shown to
  everyone, the way a token's status icons are.
- **Wounded states** *(optional, off by default)* — as a character's health
  falls, their plate can switch to **injured** and **critical** art, or, if you
  haven't drawn any, tint the normal portrait instead. A fast read of who needs
  help. The thresholds are yours to set, and it works on any system Bivouac can
  read health from — see **Other game systems** below.
- **Plates as scene tokens** *(on by default)* — gives each plated character a
  hidden, sightless token in the scene, so the combat tracker and token-aware
  modules can find them, and so the plate's own **add to the encounter** control
  has something to work with. Actors that already have a token are left alone,
  tokens you placed yourself are never touched, and switching the setting off
  removes every token Bivouac placed, in every scene — so if you'd rather your
  scenes held nothing but what you put there, one click gives you that back.
- **Two bars** — turn on a **Second Cast Bar** on another edge, e.g. the party
  along the top and NPCs along the bottom. Each keeps its own roster and speaker.
- **Size and position** — dock it to any edge; it keeps clear of Foundry's scene
  controls and sidebar. The hover cluster under the bar is **−**, **move to the
  next edge**, **+**; the move control's icon shows which edge you're on.
  Plates scale 25–150% and shrink to fit, so a big cast never overflows — and as
  they get smaller the plate chrome thins out in steps rather than crowding: the
  conditions palette leaves the bar first, then everything but the grip and the
  menu. Nothing becomes unreachable, because every control has a keybinding.
- **Stat overlay** — optionally show an actor's key numbers on their plate.
  **GM-only**: a player never sees this, not even on their own character, so
  checking someone's passive Perception doesn't announce itself to the table.
- **Raise My Hand tie-in** — if the [Raise My
  Hand](https://foundryvtt.com/packages/raise-my-hand) module is active, a player
  raising their hand shows a large hand on their character's plate. "Their
  character" means the actor assigned to them in Foundry's Players configuration,
  so a user with none assigned raises no badge — deliberately, because ownership
  is not who is playing a character, and matching on it put one raise on every
  PC's plate.
- **During combat** — optionally hide the Cast Bar automatically while a combat
  encounter is running.
- **Keyboard** — with the pointer over a plate: `Shift+S` speaker, `Shift+E`
  exit, `Shift+F` fight (add / remove from the encounter), `Shift+H` hide,
  `Shift+N` name, `Shift+T` stats, `Shift+I` inspiration, `Shift+C` conditions,
  `Shift+A` plate art, `Shift+M` menu. Remove ships unbound on purpose. All of
  those are inert unless you're hovering a plate, so they fall through to Foundry
  otherwise. For the bars themselves: `Shift+B` shows or hides the bar **under
  the pointer**, and `Shift+V` shows or hides **both bars** from wherever the
  pointer is.

- **What a player can do** — on the plate of the character they are playing (the
  one assigned to them in Foundry's Players configuration), and nowhere else:
  hover it for a **leave / rejoin the conversation** button, and **right-click**
  it to mark themselves as the one talking. Everything else on a plate stays with
  whoever the *Who can control Bivouac* setting allows. Cast Bar state lives on
  the scene, which players cannot write, so a player's press is relayed to the
  GM's client — it needs a GM connected, and tells the player if there isn't one.

Bar visibility is per-scene and the GM broadcasts it to everyone.

## Other game systems

The stat overlay, the Mini Sheet tile and the wounded plate states all read an
actor's numbers through a small per-system adapter, so nothing here is hard-wired
to D&D 5e.

- **D&D 5e** — HP, AC, Passive Perception, Passive Investigation. Temporary HP
  counts toward the wounded states, so a buffered character isn't shown as dying.
- **Daggerheart** — Hit Points, Stress, Hope, Evasion, Armor. Its pools count
  damage *upward*, and Bivouac accounts for that rather than reading them
  backwards.
- **Anything else** — define your own rows in **Custom stat rows**: a name, an
  icon, and the data path to read. Tick **Health** on one of them and the wounded
  states work too. On a system Bivouac has no adapter for, this is all it needs.

## Settings

Under **Game Settings → Configure Settings → Bivouac**. The ones worth knowing:

| Setting | What it does |
| --- | --- |
| **Maximum tile size** | The largest a tile can be resized to, in grid squares. |
| **Who can control tiles & cards** | Minimum role that can add, remove and reorder cards or drop documents to make tiles. (They also need Foundry permission to save — usually ownership of the scene.) |
| **Live web views before LOD** | How many web views may stay live before distant ones become a quiet placeholder when zoomed out. Raise it to keep everything live, lower it if the board feels heavy. |
| **DM screen position** | Which edge the drawer emerges from. |
| **Cast Bar position** / **Second Cast Bar** | Which edge each bar centres on. |
| **Cast Bar font / font size / Actor size** | Per-client look of the bar. |
| **Plate shape** | Portrait, tarot, square or wide. |
| **Hide the Cast Bar during combat** | Auto-hide while an encounter runs. |
| **Give plates a token in the scene** | On by default. Places a hidden, sightless token for each plated character so token-aware modules, the combat tracker and the plate's own combat control can find them. Skips actors that already have one, never touches tokens you placed, and removes everything it placed when switched off. |
| **Show wounded states on plates** | Off by default. Swap to a plate's injured / critical art as health falls — or tint the normal portrait if it has none. |
| **Injured / Critical at or below (% health)** | The two thresholds, yours to set rather than fixed at 50 / 10. |
| **Which system supplies the stats** / **Custom stat rows** | Auto-detects your system. Custom rows let you read anything the system exposes on any system at all — see **Other game systems**. |

Most Cast Bar appearance settings are **per client**, so each player sizes it to
their own screen; rosters, visibility and the stat toggles are shared.

## Troubleshooting

**A web view tile is blank.** The site refuses embedding (see the note above).
Use the ⇗ pop-out button on the tile.

**The board feels sluggish with lots of web views.** Each live web view is a real
browser frame. Lower **Live web views before LOD** so distant ones drop to a
placeholder while you're zoomed out.

**A player can't see a tile.** Check the tile's **Visibility** setting, then the
underlying document's ownership — Bivouac never shows a player a document
Foundry wouldn't.

**Tiles moved unexpectedly.** `Ctrl+Z` on the board undoes layout changes.

## Reporting problems / requests

Found a bug or want a tile type that isn't here? Open an issue:
<https://github.com/dukeolimbs/bivouac/issues>

## Credits

- **Created by Owen Tidy** ([@dukeolimbs](https://github.com/dukeolimbs)).
- Developed with help from **Claude Opus 4.8** (Anthropic).
- **No third-party assets are bundled** — Bivouac ships only its own code, CSS,
  and language files, with no fonts, images, or icons, and doesn't redistribute
  any Foundry core assets. If you name a Google Font for a note or the Cast Bar,
  that font is fetched from Google on demand under its own license; a web view
  tile shows whatever site you point it at.
- Thanks to the **Foundry VTT team** for the v13/v14 application and theming
  APIs this builds on.

## License

[MIT](LICENSE) © 2026 Owen Tidy.

---

## Under the hood (for the technically curious)

You don't need any of this to use the module.

Bivouac is **TypeScript + Vite**, bundled to a single ES module. Foundry globals
(`game`, `canvas`, `foundry`, …) are typed as `any` via `src/foundry-shim.d.ts`.
It targets Foundry v13+ and uses the ApplicationV2 / DialogV2 APIs.

**How the board works.** The board is *not* drawn on the canvas — it's a DOM
layer positioned over it, re-synced to the scene on every `canvasPan`. Tile
chrome (borders, text) is laid out in screen space so it stays crisp at any
zoom, while tile content scales with the map. That split is what makes a tile
readable when zoomed out and sharp when zoomed in.

**Where things are stored.** The landing board lives in **scene flags** (so it
travels with the scene and any GM sees the same board); the DM screen lives in
**user flags** (so it's yours alone). Undo/redo is a snapshot stack over the
scene-flag writes.

**Live updates.** Document-backed tiles register the UUIDs they reference, and
`updateX` / `deleteX` hooks refresh only the tiles pointing at the changed
document — so renaming an actor doesn't reload every web view on the board.

### Building it yourself

```bash
npm install
npm run build      # bundle src/module.ts → dist/module.js, copy public/ → dist/
npm run link       # junction dist/ into Foundry's modules folder (dev)
```

`npm run link` / `package` use helper scripts kept in the workspace root outside
this repo; without them, symlink the built `dist/` into `Data/modules/bivouac/`
yourself.

| Command | What it does |
| --- | --- |
| `npm run watch` | Rebuild on every save. |
| `npm run typecheck` | Type-check (`tsc --noEmit`). |
| `npm run lint` | Lint `src/`. |
| `npm test` | Run the harnesses in `test/` (see `test/README.md`). |
| `npm run check` | Typecheck, lint and test in one go. |
| `npm run build` | One-off production bundle. |

JavaScript changes need a Foundry page reload; enable Foundry's Hot Reload for
CSS and language files.

`npm test` is worth understanding before trusting it: the harnesses reason about
logic and cross-check names, and they deliberately do **not** try to prove
anything about how a browser lays out or paints. A green run is not a substitute
for loading the module — `test/README.md` says exactly where the line is.

### Project structure

```
src/
  module.ts         Init/hooks, settings, scene-control toolbar, doc-tile refresh
  world-layer.ts    The board: DOM-over-canvas surface, screen-space layout, drag/resize
  dm-screen.ts      The GM DM-screen drawer (dock edges, resize, row grid, drop targets)
  cast-bar.ts       The Cast Bar(s): docked plate strip, states, stats, scale/fit, raise-hand
  plate-tokens.ts   Optional hidden Tokens backing each plate (reconcile, not callbacks)
  plate-art.ts      Which image a plate shows: the drop prompt, file picker, art editor
  popover.ts        The floating panels a plate opens (condition palette, plate menu)
  plate-requests.ts A player's own-plate actions, relayed to the GM's client to write
  systems.ts        Per-system adapters: stat rows, health, statblocks, item info
  custom-stats.ts   GM-defined stat rows + their editor
  settings-ui.ts    Regroups Foundry's flat settings list into labelled sections
  widgets/          Tiles. `index.ts` is the only file the rest of the module imports from:
    index.ts          Public surface (re-exports) + the tile-type import order
    registry.ts       Tile type registry + createWidget factory
    types/*.ts        One file per tile type, each self-registering on import
    meter/            model.ts (pure numbers) · input.ts (gestures) · shapes.ts (the five shapes)
    style.ts          Frame / background / text colour / text outline
    dom.ts, svg.ts    Element shorthands
    doc-tile.ts       Shared scaffold for document-backed tiles
    card-model.ts     Pure card-list ops, shared with both host surfaces
    fonts.ts          Font dropdown + on-demand Google Fonts
    foundry-api.ts    The version-fragile Foundry API probes, in one place
  widget-config.ts  Per-tile configuration dialog + live preview
  drop.ts           Parse Foundry document drags → tiles
  layout.ts         Persistence (scene flags = board, user flags = DM screen) + undo/redo
  constants.ts      Data model, settings keys, permission helper
public/
  module.json       Foundry manifest    lang/en.json   UI copy    styles/module.css   Styles
test/
  run.mjs           `npm test` — bundles what needs bundling, runs every harness
  *.test.mjs        See test/README.md for what these do and do not prove
```

All user-facing copy lives in `public/lang/en.json`. In the code, tiles are
still called *widgets*; the user-facing term is **tile**.

### Releasing

`.github/workflows/release.yml` cuts a GitHub Release when you push a version
tag — it builds, stamps `module.json` with the tag version and release URLs, and
attaches `module.json` + `module.zip`:

```bash
git tag v1.0.0 && git push origin v1.0.0
```
