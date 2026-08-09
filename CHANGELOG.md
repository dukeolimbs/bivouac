# Changelog

All notable changes to Bivouac are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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

[1.0.0]: https://github.com/dukeolimbs/bivouac/releases/tag/v1.0.0
