# Bivouac backlog

Tracked inbox of reported bugs and requests, with the decisions and findings that
came out of triaging them.

This file is **committed on purpose**. The previous inbox (`docs/bivouac-tasks.md`)
was referenced by commit messages but never added to git, so it was lost when the
history was rebuilt. Anything worth acting on later belongs here instead.

Round 8 inbox, raised 2026-09-01.

## At a glance

| # | Item | Status |
|---|------|--------|
| 1 | Everyone-raising-hand bug | Fixed — uncommitted, no live pass |
| 2 | Sheet-opening vs. speaker selection | Done — uncommitted, no live pass |
| 3 | GM-only stats overlay | Open — approach decided |
| 4 | Treat Plates as Tokens in the Scene | Open — approach decided |
| 5 | Apply status effects from a Plate | Open — depends on #4 |
| 6 | Show active effects on Plates | Already built (Round 7) — needs verification |
| 7 | Drag & drop into the Cast Bar | Done — uncommitted, no live pass |
| 8 | Quick background switching | Open |
| 9 | HP-based Plate images | Open |

## Landed, awaiting a live pass

### 1. Everyone-raising-hand bug

One player raising their hand put a hand badge on every plate.

`raisedHandUserIds()` takes the socket feed (reliable, per-user) plus two fallback
heuristics for state we can't otherwise see. Both fallbacks were unbounded and
could mark the whole table from a single raise:

- The players-list scan treated *presence* of `.raise-my-hand-indicator` /
  `.raised-hand` as a raised hand. Raise-hand modules commonly render that marker
  on **every** row and reveal only the raiser's via CSS, so one raise flagged
  everyone. Now gated on the element actually being shown (`isShown()`: client
  rects, `visibility`, `display`, `opacity`).
- The user-flag scan accepted **any truthy** flag key matching `/hand/i` from an
  active module — so a string preference such as `handColour` or `raisedHandIcon`
  flagged every user that had ever configured the module. Now requires the value
  to be literally `true`, since a raise is a boolean state.

Confirmed by simulation only (old logic returns all 4 of 4 users, new returns 1);
the real module is not installed on the dev machine.

**Live test.** Needs the raise-hand module and 2+ players owning different actors,
both on plates. Player A raises → only A's plate shows the badge. A lowers → it
clears. A client connecting *after* a raise reads the existing state correctly.
Confirm the wave animation doesn't restart on unrelated refreshes.

### 2. Sheet-opening vs. speaker selection

Originally requested as double-right-click to open the sheet; settled instead on
one action per button, one click each:

- **Left-click** → open the sheet (anyone who may view it)
- **Right-click** → toggle the speaker (controllers only)

Both actions used to share the left button (single = speaker, double = sheet), so
every click was held back to see whether a second was coming. A deliberate
re-click meant to turn Speaking Mode off was swallowed as a double-click: it
opened an unwanted sheet *and* cancelled the speaker change, which then had to be
undone after the fact — and that undo was broadcast to every player.

Separating the buttons deleted the whole apparatus: click counting, the pending
write timer, the optimistic-change undo (`#setSpeakerTo`, `#clickTimer`,
`#lastClick`), and the `castDoubleClickMs` helper. That made the **double-click
speed setting meaningless**, so it was removed everywhere (registration, the
`CAST_DBLCLICK` constant, the `SETTINGS` key, its slot in the Cast Bar settings
group, and its two `en.json` strings). The speaker write is now immediate rather
than debounced.

Known trade-off, accepted: a stray left-click on a plate opens a sheet with no
timing guard. If that grates, moving the sheet to a double left-click is small
from here — nothing competes on that button now, so it can use the browser's
native `dblclick` rather than reintroducing a setting.

**Live test.** Left-click a plate → sheet opens. Right-click → speaker highlight
toggles and reaches players. Right-click the same plate → clears. Controller
left-clicks the name → name visibility toggles, sheet does *not* open. Player
right-clicks → normal browser menu (deliberately not swallowed, as they have no
speaker control). Player left-clicks an actor they cannot view → nothing.

### 7. Drag & drop into the Cast Bar

Dropping an Actor/Item on the bar required Bivouac Edit Mode, so every addition
had to be routed through the Landing Page controls first. The edit-mode
requirement is gone from both the `dragover` gate and `#onDrop`; still gated on
`canControl()`.

**Known limitation.** An empty bar outside edit mode never opens (`refresh()`
requires `plates.length > 0`), so there is no target for the *first* drop —
getting from zero plates to one still needs edit mode or the controls. Fixing it
means changing when the bar shows itself, which wasn't in scope.

**Live test.** Bar open with ≥1 plate, edit mode **off**, drag an actor from the
sidebar onto the bar → image-source prompt → plate added. **Regression risk:**
the `dragover` gate was edited, so re-check that internal drag-to-reorder of
plates still works (guarded by `#dragId`).

## Already built — needs verification, not work

### 6. Show active effects on Plates

Implemented in Round 7 (`#renderConditions`), which had never been loaded in
Foundry and only reached this checkout with the history reset — hence the request.
It provides: a per-plate toggle, condition icons with localised names on hover, a
6-icon cap with a `+n` overflow carrying the rest in its tooltip, and a
three-state reveal per plate (off → GM only → everyone).

The "ideally hide passive/permanent effects by default" caveat is satisfied
structurally rather than as an option: it renders only `CONFIG.statusEffects`
entries present in `actor.statuses`, i.e. toggleable conditions. Passive
ActiveEffects never appear, so a PC's long list of permanents can't bury the
portrait.

**Verify before building anything for #5.** This may already be the whole ask.

## Open

### 3. GM-only stats overlay

Hide the stats/passives overlay from players — currently they can tell when the GM
is checking them.

**Decided:** gate the render so non-GMs never draw the overlay.

**Residual risk, accepted:** `plate.stats` is still written to the Scene flag and
broadcast, so the inference channel isn't fully closed — a player watching for
scene updates could still infer it. The stronger fix is to hold the toggle
client-side per GM so nothing broadcasts at all, at the cost of it no longer
following the GM between browsers. Revisit if it matters in play.

### 4. Treat Plates as Tokens in the Scene

**Decided:** opt-in setting, default off.

A Plate is an entry in a Scene flag holding an Actor UUID (`Plate` in
`constants.ts`) — not a `TokenDocument`. This cannot be faked: modules test
`actor.getActiveTokens()`, `scene.tokens`, `canvas.tokens.placeables`, so the only
thing that satisfies them is a real token in the scene.

Implementation sketch: auto-manage a hidden `TokenDocument` per plate — create on
plate add, delete on remove, reconcile orphans on scene load. Touches token
vision, the combat tracker and what scenes actually contain, which is why it is
behind a switch.

Related: Round 7 already made plates read the actor **as it exists in the scene**
(an unlinked token keeps its own synthetic actor), so the plate → scene-token
lookup is partly in place.

### 5. Apply status effects from a Plate

Apply conditions through a plate the way you can on a token, for condition
tracking during RP. The *viewing* half already exists (#6); applying does not.

**Sequencing:** do #4 first. With a real token in the scene, this largely comes
free through Foundry's own token HUD instead of needing its own UI.

### 8. Quick background switching

Switch the background between a selection of uploaded images.

**Finding:** there is no Bivouac background setting. Landing pages are Foundry
**Scenes**, so "the background" is the Scene's own background image
(`scene.background.src`). Needs a GM-curated list of image paths in a setting,
plus a quick control that rewrites the active landing scene's background.

**Open decision:** where the control lives (Bivouac tool button, Cast Bar-style
tab, or the Landing Page controls).

### 9. HP-based Plate images

Optional per-state art: normal above 50%, injured at ≤50%, critical at ≤10%.
Mainly a fast visual read of who needs help.

Notes: `Plate` already carries `art` ("profile" | "token") and an `img` override
to extend. HP is available per-system through the `systems.ts` adapter rather than
hard-coded dnd5e. Round 7's change to read the **scene** actor is what makes this
correct — a plate sees live token HP, not prototype HP. Thresholds should be
configurable rather than fixed at 50/10.

## Verification debt

**Nothing in this round has run in a live Foundry world**, and neither has Round 7,
which arrived with the history reset. `npm run typecheck`, `npm run lint` and
`npm run build` pass clean; that is the whole extent of the checking.

Round 7's own runtime pass is still outstanding and is the larger of the two: the
Add-tile picker order, one tile of each of the 10 types, and a meter in each of
the 5 shapes.
