# Changelog

All notable changes to Bivouac are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [1.2.0] — 2026-08-11

### Added

- **Text stroke over artwork.** Bivouac's text nearly always sits on top of
  art — plate portraits, tile images, the map itself — so a thin dark outline
  now keeps it readable against anything, instead of each label relying on its
  own gradient band or drop shadow. On by default at **5px**, with a thickness
  slider (0.5–10px) that previews live as you drag it. The outline has rounded
  corners at every thickness, so ornate display fonts don't sprout spikes off
  their serifs. It's applied to short labels over art
  (tile and card titles, Actor and card names, meter labels and numbers, Cast
  Bar plate names and stats) and deliberately **not** to body text — note prose,
  journal pages, table results — or to text on solid panels, where an outline
  muddies reading. Any individual tile can override this from its gear: follow
  the module setting, force it **on** (including that tile's body text), or turn
  it **off**.

- **The choice dialogs fit their labels.** "Add a tile" put its nine buttons in
  one squeezed row, breaking labels across two lines ("Web / view", "Rollable /
  table") and stretching the window. Choices now lay out as a wrapping grid —
  three across, one line each — and the same applies to the plate-image picker.
  Buttons in Bivouac's other dialogs also size to their text instead of being
  squashed to an equal share of the row.

- **Keyboard shortcuts for the Cast Bar.** Running a scene meant hunting small
  hover buttons on each plate mid-conversation. The same actions now have keys
  that act on **whichever plate the pointer is over**: set the speaker, show or
  hide stats, hide a character from players, have them leave or rejoin the
  scene, and show or hide their name — plus one to show/hide the bar itself.
  Defaults are Shift+B/S/T/H/E/N, all reassignable in Configure Controls, and
  each does nothing (leaving the key to Foundry) unless you're actually hovering
  a plate. **Remove character** ships unbound on purpose — it's destructive and
  has no confirmation.

- **Dropping a character on the board asks what to make.** A character can be an
  art tile or the new mini sheet, so dragging one in now offers the choice
  instead of always producing art. If you'd rather not be asked while laying out
  a scene, a setting pins your preferred default — and holding **Shift** as you
  drop brings the prompt back whenever you want it. Items are unchanged.

- **Mini sheet tile.** A new tile showing a character's portrait, name and core
  stats, with an area where you can **drag abilities, spells or items straight
  off their sheet to pin them** — then click a pin during play to roll it,
  without opening the sheet at all. The stats follow your game system, so a
  Daggerheart character shows Hit Points, Stress and Hope rather than AC. It's a
  readout, not an editor: clicking the portrait opens the real sheet. Rolling
  follows Foundry's own permissions, so a player only ever uses what they could
  use from the sheet itself, and the pin list scrolls when it outgrows the tile.

- **Daggerheart support for the Cast Bar stats.** Stats used to be hard-coded
  D&D 5e, so on any other system the overlay was meaningless. Bivouac now
  detects your game system and reads the right numbers: on **Daggerheart** that's
  **Hit Points** and **Stress** (shown as marked/total, since Daggerheart marks
  damage upward rather than counting down), **Hope**, **Evasion** — or an
  adversary's **Difficulty** — and **Armor slots**. The stat toggles in Settings
  now list whatever your system actually has, and a "Game system" setting lets
  you override the detection or turn stats off entirely with "Generic".
  D&D 5e is unchanged, except HP now reads `current/max`. Stats a character
  doesn't have are simply left out rather than shown as zero.

- **Cast Bar plate shape.** Plates were always 3:4 portraits, which suits some
  character art badly. A **plate shape** setting now offers **Portrait (3:4)**,
  **Tarot (2:3)** for tall full-body illustrations, **Square (1:1)** for token
  art, and **Wide (4:3)**. The strip still shrinks automatically to stay clear
  of the sidebar and toolbar at every shape.

### Fixed

- **A large cast no longer runs slightly under the sidebar.** The Cast Bar's
  auto-shrink didn't count each plate's border, so it thought the strip was
  about 4px per character narrower than it really was — with seven characters
  that's nearly 30px of overlap with Foundry's side UI. Plates now shrink a
  touch sooner and stop clear of it.
- **Double-clicking a plate to open a sheet no longer changes who's speaking.**
  If the double-click was slower than the double-click window, the first click
  had already committed — quietly clearing the current speaker for everyone at
  the table. A double-click now always leaves the speaker exactly as it was,
  undoing the change if it already went through.
- **Mini sheet: pinned abilities fill the tile** instead of hugging the top with
  empty space beneath, and **passive features respond to a click.** Abilities
  with nothing to roll (most passive features in Daggerheart) used to do
  nothing at all; they now open the item so you can read it.
- **Clicking a Cast Bar plate again to turn Speaking Mode off no longer opens
  the actor sheet.** The browser decided what counted as a double-click (about
  half a second, and not something a module can change), so a deliberate second
  click was often swallowed as one — which opened a sheet you didn't ask for
  *and* cancelled the speaker change you did. Bivouac now judges double-clicks
  itself, on a window you can set: **Cast Bar — double-click speed**, defaulting
  to a snappier 250ms so a considered re-click reads as two separate clicks.
  Double-clicking to open a sheet works as before, including for players. Also,
  clicking one plate and quickly clicking another now makes the second the
  speaker, instead of ignoring the second click.
- **Slider settings now preview continuously while you drag them**, instead of
  only updating when you let go. This affects the DM-screen and Cast Bar tab
  position/padding sliders as well as the new text-stroke thickness.

### Changed

- **The Settings window is organised into sections.** Bivouac's settings used to
  be one flat list of ~20 rows, most of them Cast Bar. They are now grouped under
  **Appearance**, **Landing Page**, **DM Screen**, **Cast Bar**, **Cast Bar —
  Text** and **Cast Bar — Stats**, in that order, and world settings carry a small
  **GM · everyone** badge so it's clear at a glance which ones change the table
  for every player and which only change your own display. Searching still works
  — sections whose settings are all filtered out hide themselves.

## [1.1.0] — 2026-08-10

### Added

- **Meter tile** — a single number with five display styles: a **gauge** as a
  fill bar or a dial with a needle, a **circle** drawn as a ring of segments
  that fills clockwise from the bottom (a countdown clock) with an optional
  Font Awesome **icon in the middle**, a **sliding scale** with a draggable
  handle showing the number, and a **token pool** of pips packed to fill the
  tile. Configure the label, range, step, fill/track colours, whether the number
  shows, a **font for the label**, and **separate colours and sizes for the
  label and the numbers**. Adjust it during normal play — drag the bar, scale or needle, or
  click a segment or pip (clicking the last filled one empties it) — and the new
  value is saved to the board, so every player sees it. A per-tile **"Who can
  adjust this meter"** role gate decides who may change it; values are static
  for now (actor / world / combat bindings are still to come).

## [1.0.0] — 2026-08-09

First public release. Bivouac is feature-complete for its core purpose: a
persistent campaign landing page, a GM DM screen, and a Cast Bar for narrative
scenes.

### The landing board

- Designate any number of scenes as **Landing Pages** from the scene controls.
- Tiles sit on the scene grid and track its pan/zoom. Tile chrome is laid out in
  screen space so borders and text stay crisp at any zoom, while tile content
  scales with the map.
- **Edit mode** for arranging: drag to move, drag the corner to resize (snapped
  to the grid), marquee- and shift-click to multi-select, and move a whole
  selection as a group. `Delete` removes the selection.
- **Undo / redo** (`Ctrl+Z` / `Ctrl+Y`) over every layout change.
- **Fit all tiles to view** re-frames the scene around the board.
- **Duplicate** a tile from its hover controls.
- Boards are stored in scene flags, so they travel with the scene.

### Tiles

- **Web view** — embeds a page, with a per-tile **Content zoom**, a graceful
  placeholder and pop-out for sites that refuse embedding, and level-of-detail
  that parks distant web views when the board is busy and zoomed out.
- **Image** — click actions (open a sheet, open a journal, run a macro) plus fit
  and framing options.
- **Note** — rich HTML with Foundry enrichment (`@UUID` links, inline rolls),
  `Ctrl+B`/`I`/`U` formatting, paste-to-link, per-note font (including Google
  Fonts by name) and text size, wrapping and scaling to the tile.
- **Actor**, **Journal**, **Rollable table**, **Macro** — created by dragging the
  document onto the board or DM screen. Permission-gated, and refreshed live
  when the underlying document changes. Rollable tables render as a scrollable
  entry list that highlights and scrolls to the result after a roll; macro tiles
  have show/size options for their icon and title.
- **Card collection** — a hand of cards in a fan, row, or grid. Drop actors or
  items in (duplicates allowed), drag a card onto the scene to place its token,
  reorder by dragging, and set per-collection visibility and permissions.
- Every tile has independent **Frame** (none / subtle / framed, with colour and
  opacity) and **Background** (none / solid / frosted glass / gradient / image,
  with colour and opacity) styling, plus a **Visibility** setting on top of
  Foundry's own ownership rules.

### DM screen

- A GM-only drawer opened from its own screen-edge tab, holding the same tile
  types as the board and stored per user, independent of any scene.
- Docks **beside the sidebar** (default — keeps chat and dice usable), **over
  the sidebar**, or from the **left**, **top**, or **bottom**.
- Drag-to-resize with a remembered size; four-zone drag-and-drop arranges tiles
  into rows; its own edit mode hides the tile chrome during play.
- Configurable tab position along the edge and edge padding, so the tab clears
  other right-docked module UI.

### Cast Bar

- A floating strip of character **plates** (portrait + name) for narrative
  encounters, docked to any edge via a pull tab and kept clear of Foundry's
  scene controls and sidebar.
- Add characters by dragging an actor onto the bar in edit mode, choosing the
  **profile**, **token**, or a **custom** image for the plate.
- **Single-click** a plate to mark the current speaker; **double-click** to open
  the sheet.
- Per-plate GM states: **exited** (dimmed, still in the scene), **hidden** from
  players, and **name hidden** (players see `?`), remembered per actor.
- An optional **second bar** on another edge with its own roster and speaker.
- Player-side **resize** by dragging and **−/+** scaling from 25% to 150% in 10%
  steps, per client, plus automatic fit-to-width so a large cast never overflows.
- Optional **stat overlay** (D&D 5e): AC, Passive Perception, HP, and Passive
  Investigation, each enabled globally by the GM and revealed per plate.
- Tie-in with the [Raise My
  Hand](https://foundryvtt.com/packages/raise-my-hand) module: a raised hand
  shows on that player's character plate.
- Per-scene visibility broadcast by the GM, with optional **auto-hide during
  combat**, and per-client font (including Google Fonts), font size, and plate
  size.

### Permissions and multiplayer

- A **Who can control tiles & cards** setting sets the minimum role that can add,
  remove and reorder cards or create tiles by dropping documents.
- Document-backed tiles are permission-gated per viewer; a player never sees a
  document Foundry wouldn't show them.
- Card collections can override the global control role individually and can
  optionally show every card to all players regardless of ownership.

### Compatibility

- Foundry VTT **v13** minimum, **verified on v14**. System-agnostic, except the
  Cast Bar stat overlay, which reads D&D 5e data.

[1.2.0]: https://github.com/dukeolimbs/bivouac/releases/tag/v1.2.0
[1.1.0]: https://github.com/dukeolimbs/bivouac/releases/tag/v1.1.0
[1.0.0]: https://github.com/dukeolimbs/bivouac/releases/tag/v1.0.0
