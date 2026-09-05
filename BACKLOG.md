# Bivouac backlog

Tracked inbox of reported bugs and requests, with the decisions and findings that
came out of triaging them.

This file is **committed on purpose**. The previous inbox (`docs/bivouac-tasks.md`)
was referenced by commit messages but never added to git, so it was lost when the
history was rebuilt. Anything worth acting on later belongs here instead.

Round 8 inbox raised 2026-09-01; rounds 9 and 10 raised 2026-09-02.

## At a glance

| # | Item | Status |
|---|------|--------|
| 1 | Everyone-raising-hand bug | Reopened by the live pass 2026-09-02, refixed — see below |
| 2 | Sheet-opening vs. speaker selection | Landed (`83558ab`) — no live pass |
| 3 | GM-only stats overlay | Shipped in 1.3.0 — no live pass |
| 4 | Treat Plates as Tokens in the Scene | Shipped in 1.3.0, simulated — **no live pass** |
| 5 | Apply status effects from a Plate | Shipped in 1.3.0 — live-checked in part |
| 6 | Show active effects on Plates | Extended for temporary effects in 1.3.1 — no live pass |
| 7 | Drag & drop into the Cast Bar | Landed (`83558ab`) — no live pass |
| 8 | Quick background switching | **Not this module** — withdrawn |
| 9 | HP-based Plate images | Shipped in 1.3.0, partly simulated — no live pass |
| R9 | Plate declutter + layout guarantees | Shipped in 1.3.0, simulated — live-checked in part |
| R9 | Wounded states made system-agnostic | Shipped in 1.3.0, simulated — no live pass |
| R9 | Combat control on each plate | Shipped in 1.3.2, simulated — no live pass |
| R10 | Two hotkeys, one rename, additive exhaustion | Shipped in 1.4.0 — **no live pass** |
| R11 | Inspiration badge on a plate | In the working tree — no live pass |
| R11 | Player leave/rejoin + speak on own plate | In the working tree — first live pass found a missing socket flag |
| FR1 | Notes on a condition icon | **Not started** — see Feature requests |
| FR2 | Party-inventory tile | **Not started** — see Feature requests |

Rounds 1–9 and round 10 are released (1.4.0); the raised-hand refix and round 11
are in the working tree, and the two FR items are not started. `npm run check`
(typecheck, lint and twelve harnesses) passes clean; see **What was checked**
under round 9 for what that does and does not mean.

**Released as 1.3.2, then 1.4.0, on 2026-09-02 with the live pass still
outstanding.** That was a deliberate call each time, not an oversight. For 1.3.2
the mitigation was that the two features touching world data were both opt-in and
default off. That is no longer the whole story: 1.3.3 turned `castPlateTokens` ON
by default (so a world that never touched the setting now gets parked tokens), and
1.4.0 writes a `boardHidden` scene flag and can hide the board for the whole table
from one keypress. Both are reversible — switching the setting off sweeps every
token Bivouac placed, and the same key brings the board back — but neither is
opt-in any more. The live tests below are owed, and 1.4.0's are the ones to run
first.

**1.3.3 was never released.** It was committed (`4d6da6f`) and tagged nowhere,
then overtaken by round 10, so its changes reached users inside 1.4.0. Worth
knowing when reading the changelog: there is no v1.3.3 tag and no release for it.

## Landed (`83558ab`)

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

#### Reopened 2026-09-02: it was still raising every PC's hand — and the fallbacks were never the cause

The live pass this item had been waiting for found the symptom unchanged, and the
GM's own guess was right: it was permissions. Both of the fixes above were real,
but they were fixes to the *fallback heuristics* for reading WHO has a hand up.
The bug was in the other half — deciding WHICH PLATE a raise belongs to — and
that half was matching on OWNERSHIP:

```
raised.some(uid => doc.testUserPermission(game.users.get(uid), "OWNER"))
```

Three reasons that can never be right, any one of which is enough:

- a player may own several actors (a second character, a familiar, a shared NPC);
- `testUserPermission` honours an actor's **default** ownership, so a party whose
  sheets the whole table can open tests as owned by the whole table — which is
  exactly the world this was reported in;
- ownership answers "may this user act on this actor", which is a different
  question from "is this user playing it".

Confirmed at the table twice over: the symptom went away when the GM dropped the
other PCs from Owner to Observer, which is the workaround, not the fix.

**Now matched on `User#character`** — the actor assigned to a user in Foundry's
Players configuration, the one field that says which actor a user is playing.
`raisedCharacters()` and `isPlayedBy()` in `widgets/foundry-api.ts`, composed by
`#handUp` in `cast-bar.ts`. Ownership is not consulted at all any more, so no
world needs its permissions arranged a particular way and the Observer workaround
can be undone.

Two deliberate consequences:

- **A raiser with no character assigned gets no badge.** That is the one case this
  rule cannot serve, and silence there would look exactly like the bug it
  replaced — so it is logged once per session, naming the user, rather than
  dropped quietly.
- **GMs are no longer excluded.** They were only excluded because a GM owns
  everything and so matched every plate; with an exact character match, a GM who
  is also running a PC gets the badge on that PC and nowhere else.

Pinned by `test/raised-hands.test.mjs` (20 checks), in which every actor has
`ownership.default: OWNER` and a `testUserPermission` that says yes to
everything — so if the rule ever drifts back to permissions, those checks fail.
What it cannot prove is the half that needs the module: that `raisedHandUserIds()`
reads the real raise feed correctly.

**Live test (still owed).** Player A raises → A's plate only, with the party still
at Owner. Assign a user no character, raise → no badge, and one console line
naming them. A GM with an assigned character raises → their PC only.

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
speed setting meaningless**, so it was removed everywhere.

Known trade-off, accepted: a stray left-click on a plate opens a sheet with no
timing guard.

**Live test.** Left-click a plate → sheet opens. Right-click → speaker highlight
toggles and reaches players. Right-click the same plate → clears. Controller
left-clicks the name → name visibility toggles, sheet does *not* open. Player
right-clicks → normal browser menu. Player left-clicks an actor they cannot view
→ nothing.

### 7. Drag & drop into the Cast Bar

Dropping an Actor/Item on the bar required Bivouac Edit Mode. That requirement is
gone from both the `dragover` gate and `#onDrop`; still gated on `canControl()`.

**Known limitation.** An empty bar outside edit mode never opens (`refresh()`
requires `plates.length > 0`), so there is no target for the *first* drop.

**Live test.** Bar open with ≥1 plate, edit mode **off**, drag an actor from the
sidebar onto the bar → image-source prompt → plate added. **Regression risk:** the
`dragover` gate was edited, so re-check that internal drag-to-reorder still works.

## Built this round — in the working tree, no live pass

### 3. GM-only stats overlay

`#renderStats` now takes the `controller` flag `#renderPlate` already had, and
draws nothing without it. Deliberately **no** reveal state and no `canView`
escape hatch, unlike the conditions overlay: the actor a GM most often checks is a
PC, so the one player who would pass `canView` is exactly the one who must not
see it. Gated on `canControl()` rather than `isGM` so the audience that sees the
overlay matches the audience that can toggle it.

`StatsShow` restated as "Show stats (you only)" — matching `CondsShow` — and it no
longer enumerates the dnd5e four, which was wrong under any other adapter anyway.

**Residual risk, unchanged and accepted:** `plate.stats` is still written to the
Scene flag and broadcast, so the toggle stays inferable by a player watching scene
updates. The stronger fix is to hold it client-side per GM, at the cost of it no
longer following the GM between browsers.

**Live test.** GM toggles stats on a plate → GM sees the overlay, a logged-in
player sees nothing appear, including on their **own** character's plate.

### 4. Treat Plates as Tokens in the Scene

New `src/plate-tokens.ts`, behind the world setting `castPlateTokens`, default
**off**. When on, each plated actor gets one hidden, sightless TokenDocument
parked in the scene's padding.

Three rules keep it from fighting the GM:

1. **A real token always wins.** An actor that already has a token gets nothing
   added; place one for an actor we were covering and ours is withdrawn.
2. **We only ever delete our own**, keyed on the `plateToken` marker flag.
3. **One per actor, not one per plate** — the same actor on both bars shares it.

The pass is a reconcile, not a set of create/delete callbacks: it reads the scene,
diffs, applies. That makes it idempotent, so it can hang off `canvasReady`,
`updateScene` (cast-bar flags) and `createToken`/`deleteToken` — including the
hooks its own writes fire. Gated on `isActiveGM` so four logged-in GMs don't each
create a token. Switching the setting off sweeps every parked token in **every**
scene, not just the active one.

`sight.enabled: false` is not cosmetic: a player-owned token is a vision source
even while hidden, so a sighted one parked in the margin would hand its owner a
view of the map's corner.

**Knock-on, intended but worth knowing:** `sceneActor()` resolves a plate to the
actor of the scene's single token for it. With this on, an unlinked plated NPC now
has one — so the plate reads the parked token's delta rather than the sidebar
prototype. That is the direction #5 needs, but it means a plate's numbers and
conditions have a different source with the setting on than with it off.

**Verified by simulation** (`esbuild`-bundled module against a stubbed Foundry,
24 checks): parks for an uncovered plate; adds nothing when a real token exists;
withdraws when one appears; deletes only its own when a plate goes; one token for
an actor plated three times across both bars; skips Items, compendium and
token-actor uuids; prunes its own duplicates; idempotent across three passes;
setting-off withdrawal; sweep across scenes; no writes from a non-active GM;
unlinked tokens counted as real.

**Live test.** Switch on with plates present → hidden tokens appear in the padding
corner, one per plated actor. `actor.getActiveTokens()` finds them. Drag a real
token in for one of those actors → the parked one disappears on the next pass.
Delete that real token → a parked one returns. Remove a plate → its token goes;
a token you placed by hand does not. Switch the setting off → every parked token
in every scene is removed. **Check specifically:** the combat tracker, and that
players gain no vision from a parked token of a character they own.

### 5. Apply status effects from a Plate

A condition palette — the world's `CONFIG.statusEffects` in its configured order,
active ones lit — opened over a plate and applying via
`actor.toggleStatusEffect()`. Writes to the **scene** actor, the same document the
plate reads back from, so the showing and applying halves can never disagree about
which actor they meant.

Reached two ways, neither of which adds a control to a bar that was already at six:

- **Right-click the conditions button.** Left-click still cycles the reveal state.
  The two are the same subject from either side — what the table can see, and what
  is actually on the character — so they share a button, and the tooltip carries
  the second half rather than leaving it to be found.
- **Shift+C** over a hovered plate (`castConditions`).

Details worth not re-deriving: the palette is parented to `#interface`, not the
plate, because a plate is small, clipped by the strip's overflow, and rebuilt on
almost every state change — including the rebuild that applying a condition
itself triggers. It is repainted from `refresh()`, so conditions arriving from the
Token HUD, a macro or another GM restate it while it sits open. The dismiss
handler exempts the trigger control, without which `pointerdown` (which fires
before `contextmenu`) would close and immediately reopen it, and the toggle would
never appear to work.

**Not verified by simulation** — it is DOM- and dialog-heavy, so nothing short of
a browser exercises it honestly. This is the least-tested item in the round, and
the one place a live look has already found a defect (below).

**Live test.** Right-click a plate's conditions button → palette over the plate,
current conditions lit. Click one → it applies, the plate's own icons update.
Right-click the same button → closes. Right-click a different plate's → swaps
over in one action. Escape and an outside click both dismiss. Shift+C over a plate
does the same. Apply from the Token HUD while the palette is open → the palette
restates. On an **unlinked** NPC, confirm the condition lands on the token and not
the sidebar prototype.

### 9. HP-based Plate images

Three parts.

**A system-neutral health read.** `StatDef` gained `health?: boolean`, marked on
dnd5e's `hp` and Daggerheart's `dhHp`, and `healthFraction(doc)` returns 0–1 from
whichever row carries it. That inherits `reverse` for free — Daggerheart counts
damage *up* toward the max, so 3/6 there means half gone where dnd5e's means half
left. Reads regardless of whether the GM has that stat row switched on for
display; wanting the wounded states without the numbers on show is the normal
case. Returns null (→ no state) for an unsupported system, an actor with no
health, or a pool with no maximum — a plate that cannot be assessed must look
exactly like one that is unhurt.

**Thresholds.** World settings `castWoundStates` (off by default),
`castWoundInjured` (50%) and `castWoundCritical` (10%), both 0–100 sliders.
Critical is tested first, so setting them equal collapses to one state.

**What a wounded plate looks like.** `Plate` gained `imgInjured` / `imgCritical`.
When a state has art, it is shown; when it doesn't, the normal portrait is tinted
instead (desaturate + a red inset vignette, critical also pulsing slowly, and
honouring `prefers-reduced-motion`). So the feature reads with **no per-character
setup**, and the art is the upgrade rather than the entry fee. A plate with its
own wounded art is not also tinted — that art is the signal. A critical character
with only *injured* art keeps showing it rather than falling back to healthy.

The tint is a real child element, not `::before`/`::after`: both pseudos on a
plate are already taken (the reorder drop indicator uses both, the "exited" dim
uses `::after`).

**New `src/plate-art.ts`**, holding everything about which image a plate shows:
the drop-time Profile/Token/Custom prompt and the file picker (both moved out of
`cast-bar.ts`, where they were private methods), plus `openPlateArt()` — a
three-slot editor for base / injured / critical art. Reached from a new `fa-image`
plate control, or Shift+A over a hovered plate.

That editor also closes a gap that had nothing to do with this request: **a
plate's normal art could not be changed after it was added.** The
Profile/Token/Custom choice was made once, on drop, and picking wrong meant
removing the character and re-adding them.

Two knock-ons:

- The control bar is now seven controls, so `.bivouac-plate__controls` gained
  `flex-wrap: wrap`. It could already overflow at small plate sizes, which hid the
  rightmost control (remove) with no way to reach it; a second row is worse-looking
  but usable.
- `refreshDocTiles()` now handles a token's synthetic actor centrally. Its uuid is
  `Scene.x.Token.y.Actor.z`, which never matched the plain `Actor.<id>` a plate
  stores, so **damage to an unlinked NPC never refreshed its plate** — a latent bug
  the stats overlay already had, which wounded states would have made obvious. The
  ActiveEffect hook had its own copy of this workaround; that duplicate is gone.

**Verified by simulation** (17 checks against the bundled `systems.ts`): dnd5e
full/half/zero, negative HP clamped to 0, over-max clamped to 1, zero and absent
maxima → null; Daggerheart's reversed pool at 0/half/full and over-marked;
unsupported system → null; and specifically that the display toggle does *not*
gate the fraction. The rendering, the editor dialog and the tint are **not**
simulated.

**Live test.** Switch wounded states on. Damage a PC past each threshold → the
plate tints, then tints harder and pulses. Heal back → it clears. Assign injured
art via the plate's image control → the art swaps in and the tint does *not* also
apply. Give only injured art and drop to critical → the injured art stays. Check
an actor with no HP (a vehicle, a shop) shows nothing. On Daggerheart, confirm the
states fire as damage is *marked*, not the other way round. Change the base art of
an existing plate through the editor and confirm it sticks; clear a custom image
and confirm it falls back rather than going blank. Check the seven controls on a
small plate.

## Already built — needs verification, not work

### 6. Show active effects on Plates

Implemented in Round 7 (`#renderConditions`), which had never been loaded in
Foundry and only reached this checkout with the history reset — hence the request.
It provides: a per-plate toggle, condition icons with localised names on hover, a
6-icon cap with a `+n` overflow carrying the rest in its tooltip, and a
three-state reveal per plate (off → GM only → everyone).

The "ideally hide passive/permanent effects by default" caveat was satisfied
structurally rather than as an option: it rendered only `CONFIG.statusEffects`
entries present in `actor.statuses`, i.e. toggleable conditions.

**Reopened and extended, 2026-09-02.** That structural answer was too broad. It
excluded ALL non-status ActiveEffects to keep permanents out, which took the
*temporary* ones with them — and those are the interesting half. A plate could
tell you a character was concentrating but not on what.

The decision of what belongs on the strip now lives in `conditionBadges()`, in
`widgets/foundry-api.ts` with the rest of the version-fragile probes, and covers:

- status conditions, still in the world's configured order,
- **temporary** ActiveEffects that grant no status of their own — Bless, Bardic
  Inspiration, a Hunter's Mark — marked with a faint accent ring, because a state
  the character is IN and something running ON them answer different questions,
- a status's label **enriched from the effect that granted it**, so dnd5e's
  concentration reads "Concentrating: Hunter's Mark". Where the granting effect
  merely restates the condition (a "Prone" effect granting `prone`) the
  condition's own name is kept, so nothing doubles up.

The portrait-burying guard is now `isTemporary` rather than "statuses only":
`appliedEffects` is already filtered to active, not disabled, not suppressed and
not expired, and the duration test drops the permanents. Filtering on duration is
what the original caveat actually asked for; excluding every non-status effect was
a proxy for it.

Covered by the `conditions` harness (21 checks), including the two fallbacks that
matter if a Foundry release moves things: an actor without `appliedEffects`, and
an effect without an `isTemporary` getter.

#5 sits directly on top of this — the same button is both halves.

## Withdrawn

### 8. Quick background switching

**Not this module.** Raised against Bivouac, but on 2026-09-01 confirmed as a
request for a different module. Nothing was built.

Keeping the triage finding, since it is the reason the item looked like Bivouac's
in the first place: there is no Bivouac background setting. Landing pages are
Foundry **Scenes**, so "the background" is the Scene's own `scene.background.src`.
Also worth recording that the three placement options originally listed collapse
to two — "a Bivouac tool button" and "the Landing Page controls" are the same
scene-control group, and activating that group turns Bivouac edit mode on as a
side effect.

## Round 9 — plate declutter and layout guarantees

Raised 2026-09-02: "reorganise the options on actor plates, it's very noisy" —
plus a requirement that no plate visual ever overlap, exceed its borders, or clip.
Answered with an audit, a control regrouping and a size ladder. Also in this round:
wounded states made properly system-agnostic.

### R9.1 What the audit found

Fourteen layers were landing on a plate: portrait, wound tint, name banner, stats
box, conditions column, exited dim, name hint, raised-hand badge, control bar,
reorder indicator, and the speaker / hidden / dragging / missing states. Six real
problems, with the numbers:

1. **The control bar did not fit its own plate at the DEFAULT size.** A portrait
   plate at 200px is 150px wide → 144px of usable bar; grip + six 22px buttons +
   gaps needed 161px. It fitted only on the square and wide shapes. Round 8's art
   button is what tipped it over (five buttons came to 137px and just fitted), and
   the `flex-wrap` added with it turned an overflow into a second row of buttons
   across the top of the portrait — which is what read as "noisy".
2. **The bar sat exactly on top of both overlays.** Bar at `top: 0` z4, stats and
   conditions at `top: 4px` z2, so hovering a plate to act on it hid the numbers
   being read.
3. **Six condition icons came to ~66% of the plate's height** at every size — the
   icons scale with the plate, so the proportion never improved on its own.
4. **The reorder drop indicator was 100% invisible.** `.bivouac-plate` has
   `overflow: hidden`; the indicator sat at `left: calc(-0.5 * 8px - 2px)` = −6px
   with `width: 4px`, entirely outside the padding box. Drag-to-reorder had no
   visual feedback at all — and this is the interaction the round-8 notes flagged
   as a regression risk.
5. **`__namehint` was a flat 20px** with 16px side padding, on a plate whose
   height `#fit()` can take to 24px.
6. **`--missing` was applied in JS and styled nowhere**, so a broken actor
   reference looked like a healthy plate with an odd name.

### R9.2 Controls: four items, and a menu

Regrouped on frequency — buttons for what happens mid-conversation, a menu for
what is set up once:

| | |
|---|---|
| **Bar** | grip · exit/rejoin · conditions palette · `⋯` |
| **Menu** | *Visibility*: in the conversation, hidden from players, name shown · *Overlays*: stats, conditions reveal (off / you / everyone) · *Appearance*: plate art · *Remove* |

Four items come to ~89px against 144px. Speaker stays where it was — a right-click
on the plate face — which is right for the most-used action of the lot: it gets the
largest target rather than a 22px one.

Two readings improved by moving rather than merely fitting:

- The conditions **reveal** was a three-state cycle on one button, i.e. a thing
  you clicked repeatedly to discover. As three radio rows the states are visible.
  `setConditionReveal()` writes both booleans together, so the fourth meaningless
  combination (`conditionsPublic` with `conditions` off) is now unreachable.
- **Name visibility had no button at all** — a bare click on the name banner,
  hinted only by a `title` and a hover "?". It keeps the shortcut and gains a
  findable home.

The conditions palette is now a plain left-click. It was briefly a right-click on
the reveal button, which only ever existed to dodge a seventh control; with the
reveal gone from the bar it does one thing on one click like everything else.

Its icon is Foundry's own, not a Font Awesome stand-in: `CONFIG.controlIcons.effects`,
which is `icons/svg/aura.svg` out of the box — the same symbol as the effects
control on the token HUD, since it is the same job and a GM should not have to
learn a second one for it. Read from `CONFIG` rather than hard-coded, so a system
or module that re-points that icon moves this one with it.

That needed `btn()` to take either an FA class or an image path, told apart by the
slash no FA class contains.

It also needed **no** filter, which took two goes to get right. The core control
SVGs look like black art on a first read — `aura.svg` opens with a `fill="#000"`
rect — but that rect is pinned at `fill-opacity="0"` and the figure itself is
`fill="#ffffff"`. Foundry's `--control-icon-filter: invert(1)` is for its LIGHT
themes, turning that white art dark; its dark themes apply no filter at all, which
is the giveaway that was missed. Inverting on always-dark chrome painted the icon
black. Now unfiltered, at 0.85 → 1 opacity rather than the HUD's 0.7 → 1: the HUD
dims a 36px icon on its own backdrop, whereas this one sits 16–22px in a row of
`#fff` glyphs and at 0.7 read as the grey one out of four. The lift is kept
because an `<img>` cannot take the `color: accent` that the glyph controls use to
acknowledge a hover.

Also caught while there: the buttons' `font-size` was still a flat 11px after they
were made to scale, so a glyph was 50% of a 22px button but 69% of a 16px one — it
grew as the plate shrank. Now half the button width, like the grip.

Every control the menu absorbed **kept its keybinding**, which is what makes the
lower tiers safe. Added `Shift+M` (`castMenu`) for the menu itself.

**New `src/popover.ts`.** The palette's mechanics — mount on `#interface`, fixed
position against the plate's rect, toggle-on-retrigger, outside-press and Escape
dismissal, trigger exemption, repaint registry — were needed a second time for the
menu, so they were extracted rather than copied. Foundry's own `ContextMenu` was
considered and rejected: it would have been idiomatic, but a wrong namespace guess
fails silently and would have made five actions unreachable in a build that cannot
be tested here. The existing pattern already compiles.

### R9.2b The bar's own three controls

The cluster under the bar was `[−] [+] [move]`, with the move button off to one
side wearing `fa-arrows-up-down-left-right`. Now `[−] [grab] [+]`: the control
that moves something sits between the two that resize, so the trio reads as one
cluster of three matching circles rather than a pair plus a stray. It still hides
itself under a forced dock, and `display: none` closes the row up to `− +` with no
gap left behind.

The glyph is `fa-regular fa-window-maximize` — a rectangle OUTLINE with one solid
edge — **rotated to match the dock**, so the button reports where the bar currently sits as well as
offering to move it. No static glyph can do both, and it costs no JavaScript: the
rotation is four CSS rules hanging off the `bivouac-castdock-<edge>` class
`applyDock()` already sets, and the button is a descendant of the bar. The glyph's
proportions help too — it is wider than tall, so a left/right dock turns it
upright, the shape the bar actually takes there. The rotation is transitioned, so a
click reads as movement even when the bar being moved is off at the far side of the
screen.

Two glyphs were tried and rejected on the way, both instructive:

- `fa-arrows-up-down-left-right` (the original) is a thin symmetrical cross sitting
  between a real minus and a real plus, so it read as a third plus.
- `fa-hand` / `fa-hand-back-fist` said "grab", but the open hand is already the
  RAISED-HAND badge on a plate — one glyph for "a player wants to speak" and "move
  the bar" is two unrelated meanings in one UI — and a hand implies dragging where
  this button clicks.

The **regular** weight, not solid: the solid cut is a filled block with the edge
knocked out of it, which reads as a white tile rather than as a screen with a bar
down one side.

Worth recording for future icon choices: Foundry ships **Font Awesome Pro 7.2**
(`public/fonts/fontawesome`), not the free set, so ~5,400 classes are available,
including `fa-panel-ews`, `fa-sidebar` and the rest of the docking family — and,
more usefully, the OUTLINE weights. `fa-regular`, `fa-light` and `fa-thin` all
ship as webfonts (`fa-regular-400.woff2` and friends), where the free set has only
solid and brands. Reaching for an outline weight is often a better answer than
hunting for a different glyph. Check availability against that file rather than
assuming the free subset. Note also that
it declares aliases in GROUPED selectors — `fa-grip` is an alias of
`fa-grip-horizontal` and only appears in a comma-separated rule — so a naive
per-class grep reports false negatives. That nearly had the plate's reorder handle
reported as a broken icon.

The two button rules behind these were byte-identical apart from a font-size, kept
in step by hand under a comment saying the move button should look like "the same
pill as the scale controls" — an argument for sharing the rule rather than copying
it. Merged into one, with the move button's two genuine differences (a slightly
smaller glyph, since a hand is wider than `+`, and the cursor) as its only
override. Now that it sits between the other two, any drift between them would
read as a mistake.

### R9.2c The palette was one column high

Found on first live look: the palette rendered as a single column of icons running
the full height of the screen.

The grid was `repeat(auto-fill, 30px)`, which needs a **definite width** to work
out how many columns fit — and never had one. The panel is `position: fixed` with
no width, so it shrink-to-fits its content; its content is a grid asking how wide
the container is; with nothing to resolve against, `auto-fill` yields one column.
The comment above it claimed the opposite ("a world with 12 conditions and one
with 40 both want a sensible block"), which is what the rule was *for* rather than
what it did.

Foundry's own status palette sets `--effect-columns: 5` explicitly for exactly
this reason. So does this one now, with the count computed per world from the
effect total — `clamp(3, ceil(sqrt(n × 1.6)), 8)`, and never more columns than
there are icons. Slightly wider than square, because a row of icons scans faster
than a column. The 8-rows-then-scroll cap is taken from the HUD directly.

Resulting shapes: 15 effects → 5 × 3 (182 × 134px, where before it was 1 × 15);
core's ~28 → 7 × 4; a heavily-modded 80 → 8 columns, 8 rows visible, scrolling.
Added to the layout harness as a third sweep, so the palette can no longer become
a stripe or outgrow its panel unnoticed.

**The general lesson, which the layout harness could not have caught:** it models
the geometry, and the geometry was fine — 30px tiles in a 340px panel *do* fit
nine across. What failed was CSS sizing semantics, which only a browser resolves.
Worth remembering when reading the round's other "verified" claims.

### R9.2d Regression: the speaker highlight (and the raised hand) lost their CSS

Reported from play: right-clicking a plate no longer highlighted it as speaking.

The handler was fine and the flag was being written — the **CSS rule was gone**.
One of this round's stylesheet edits replaced a byte RANGE (from the old palette
comment to the wound-states comment) and that range had grown to contain three
unrelated rules sitting between those two markers:

- `.bivouac-plate--speaker` — the green border and glow. The reported symptom.
- `.bivouac-plate__hand` — the raised-hand badge's positioning and colour, so
  that badge was silently broken too and nobody had hit it yet.
- `@keyframes bivouac-hand-wave` — its animation.

All three restored verbatim from `HEAD`. A full audit of removed selectors
confirms nothing else was lost: the only other deletions are the
`castbar__scalebtn` / `dockbtn` rules that were deliberately merged.

**Root cause worth naming, because it will recur:** anchoring an edit on "from
this comment to that comment" is only safe while nothing moves in between — and
things had, because earlier edits in the same round inserted the palette and wound
blocks at separate anchors. Prefer replacing a rule by its own selector, or splice
by a marker that belongs to the block being replaced.

**New harness: `css`.** Cross-checks every `bivouac-*` class the source applies
against the selectors module.css defines, plus keyframes and CSS variables the
stylesheet references. Verified to catch this exact bug — deleting
`.bivouac-plate--speaker` makes it fail. This closes the last obvious hole in the
checking: `typecheck` sees TypeScript, `lint` sees style, `i18n` connects src to
en.json, `layout` models geometry, and nothing at all connected a class name in a
`.ts` file to a selector in a `.css` file.

It also surfaced five PRE-EXISTING dangling classes, reported as notes rather than
failures. One is a real unfulfilled promise: `.bivouac-plate__stat--reverse` and
`.bivouac-mini__stat--reverse` are applied on the strength of a comment saying
they exist "so the CSS can colour them without re-deriving that per system", and
no such rule was ever written — so a Daggerheart marked-damage pool renders
identically to a dnd5e health pool, which is the one distinction the flag was for.
Not fixed here (it is a visual change, and out of scope for a regression fix), but
now tracked rather than invisible. The others — `bivouac-cstats-launch`,
`bivouac-overridden`, `bivouac-drawer--editing` — want the same look.

### R9.2e Menu headers were unreadable

Reported from play. Three things were working against them at once, which is why
it looked worse than any one of them explains:

- 10px type,
- uppercase with letter-spacing (the least forgiving setting there is for low
  contrast — the eye has fewer word-shape cues to fall back on),
- `--bivouac-muted`, i.e. white at **55% alpha**, over a panel that is itself only
  86% opaque and blurred. So a bright scene came through the letters as well as
  through the panel.

Fixed by adding a second muted tier rather than by brightening the existing one:
`--bivouac-muted-strong` (0.85 white / 0.74 black), defined in all four theme
blocks. The distinction is worth keeping — `--bivouac-muted` is for text you are
meant to skim past, and it is used in a dozen places where dimness is correct;
this is for text you are meant to READ but which should not compete with the
content. Headers went to 11px at the new tier with slightly more tracking (which
helps uppercase at small sizes) and more space above, so a header reads as
belonging to the group below it rather than floating between two.

The panel's title took it too. That title is the character's NAME — the thing that
tells you which plate you are about to act on — and at 55% it was quieter than the
menu rows beneath it, which is the wrong way round.

The panel's own translucency was left alone: at 0.85 white the contrast is roughly
11:1 even over a bright scene, so the text fix is sufficient on its own. If it
still reads poorly over very light backdrops, the lever is a `panel-bg-solid` tier
for popovers rather than more brightness on the type.

### R9.3 The no-overlap guarantee

Three mechanisms, all needed, because `--bivouac-castbar-fit` ranges 24–520px.

**Exclusive zones.** Controls own `0 … ctrl-h`; the overlays own the band below
it; the banner owns the bottom. On hover the overlays translate down by exactly
`--bivouac-ctrl-h`, so the bar and the numbers are legible at once and neither is
ever covered.

**Everything scales.** `--bivouac-ctrl-sz: clamp(16px, fit × 0.11, 22px)` (16px is
the smallest that stays hittable), and the name hint now uses the same clamp shape
as the banner.

**A two-axis size ladder**, `data-tier` on the bar, set from `#fit()` because that
is the one place that knows the effective size:

| tier | needs | controls | stats | conditions | name |
|---|---|---|---|---|---|
| `full` | ≥110w, ≥130h | all four | 4 rows | 6, wrapping | 2 lines |
| `compact` | ≥62w, ≥84h | no palette | health row only | 3 | 2 lines |
| `min` | ≥40w, ≥46h | grip + menu | — | — | 1 line |
| `none` | below that | — | — | — | tooltip only |

Laddered on **both** axes with the stricter winning, because the constraints
differ: the bar runs across a plate, the banner and overlays stack down it. A
single threshold on the smaller side was tried first and was too blunt — it
dropped a tarot plate at the DEFAULT size to `compact`, losing three stat rows and
the palette button on a plate with room for both. The thresholds are each tier's
measured requirement plus headroom.

The tier is published two ways because the ladder is split. `data-tier` lets CSS
thin the chrome with no JavaScript in the loop; the parts that need arithmetic —
how many condition icons before the `+n`, which stat rows survive — need a
re-render, which `#applyTier` schedules on a frame (never synchronously: `#fit()`
is called ~20 times per settle and is itself the caller). It terminates because
the second pass measures the same size.

**Why it holds rather than happens to.** `--bivouac-overlay-max` is *defined* as
`100% - ctrl-h - name-h - 4px` — the leftover after the bar and the banner — so
the three bands sum to at most 100% by construction. `--bivouac-name-h` is derived
from `--bivouac-name-line`, which is also the banner's own `font-size`, and
`--bivouac-name-lines` drives both the line clamp and that arithmetic. There is
one number for each thing, so no two rules can disagree about it. An earlier
attempt used a guessed `34%` for the banner and was wrong exactly where it
mattered: the banner's font-size bottoms out at its 10px floor, so on a small
plate it is ~37% of the height, not the ~25% it is at the default size.

Conditions **wrap into columns** instead of growing down: the box is right-anchored
with auto width, so a second column grows leftward into the 46% it is allowed. All
six stay visible and bounded. Both overlays are capped at 46% width, so the two
top corners can never meet — a long pool like `125/125` at a small size used to
close that gap.

Stat rows are capped per tier (4 / 1 / 0 / 0) because the count is not ours: the GM
chooses which stats are enabled and can add custom rows, so "however many there
are" could be ten. At the tighter tiers the row kept is the **health** row rather
than the first, and any dropped rows are named in the box's tooltip — the same
courtesy the conditions overflow gets from its `+n`.

**Fixes that came with it:** the drop indicator moved inside the plate (`left: 0`,
5px, keeping its glow) so `overflow: hidden` can no longer eat it; the name hint
scales; `--missing` got a style (desaturated portrait, dashed border).

### R9.4 Wounded states, system-agnostically

Raised mid-round: "ensure HP-based plate images work with D&D 5e, not just
Daggerheart — as system-agnostic as possible."

dnd5e was never excluded: `health: true` was on its `hp` row from the start and 9
of the original 17 health checks were dnd5e. Two real gaps, though, and neither is
a dnd5e special case:

**Buffer pools.** `StatValue` gained optional `temp` (spent before `value`) and
`tempMax` (a temporary addition to the maximum). Generic in shape, filled in by
dnd5e from `hp.temp` / `hp.tempmax`. Without it a PC on 10 of 40 with 15 temporary
HP read as critical when they were fine — and a wounded state that says that is
worse than none. Deliberately **not** folded into `formatStat`: the plate shows the
same `10/40` the character sheet shows; the buffer only changes "how hurt".

**A GM can now declare the health row.** `CustomStatRow` gained `health`, with a
checkbox in the row editor, mapping onto `StatDef.health`. The `generic` adapter
has no stats at all, so before this a world on an unsupported system could tell
Bivouac exactly where its health lived and still get no wounded states — even
though the read contract was already satisfied. A declared row **wins** over the
adapter's own (searching the stat list from the end, since custom rows are
appended): on a supported system the built-in is usually right, but a GM who ticked
that box has said something deliberate, and that beats a guess made in `systems.ts`.
Requires a max path, since a fraction needs a denominator.

This is also what makes the `compact` tier correct everywhere: the one stat row it
keeps is "whatever this world calls health", not a hard-coded `hp`.

### R9.5 What was checked

`typecheck`, `lint` and `build` clean. Five harnesses, 64 assertions plus two
sweeps, all passing:

| harness | what it proves |
|---|---|
| `pt.test` (24) | the plate-token reconcile, unchanged |
| `hp.test` (17) | health fractions across dnd5e / Daggerheart / generic |
| `hp2.test` (23) | dnd5e temp HP and tempmax; a GM-declared health row on an unsupported system; declared beats built-in; reverse pools |
| `layout` | the control bar and both overlay columns against every tier × every plate shape × 19 sizes, horizontally and vertically |
| `i18n` | every `BIVOUAC.*` key referenced in src resolves; no orphans in CastBar / CustomStats; every registered keybinding id has a name |
| `css` | every `bivouac-*` class src applies has a rule in module.css; every keyframe and CSS variable the stylesheet uses is defined |

The layout harness earned its keep — it caught three things review had not: the
six-conditions vertical overflow at the default size, the short-wide plate the
width-only tier mishandled, and the wrong `34%` banner estimate.

`i18n` caught seven strings orphaned by the control regrouping (`StatsShow`,
`StatsHide`, `CondsShow`, `CondsPublic`, `CondsHide`, `Hide`, `Show`) plus
`Remove`, all now deleted.

**Still unverified by anything: every DOM path.** The layout harness models the
CSS geometry, it does not execute it — it proves the arithmetic, not that browsers
lay it out as modelled. The menu, the palette, the art dialog, the hover shift, the
wrap and the tier transitions all need a live world.

**Live test.** Hover a plate → four controls, one row, no wrap, and the overlays
slide down clear of them. `⋯` → the menu above the plate; tick several boxes
without it closing; the reveal radios show three states and match what players see;
art and remove close it. Escape and an outside click dismiss; re-clicking `⋯`
toggles it. Drag a plate → **an accent bar is now actually visible** on the edge it
will land. Then walk the size range with the quick-scale control and confirm the
tiers hand over cleanly at each step, on each of the four plate shapes, with
nothing clipped at any point. On dnd5e, give a wounded PC temporary HP and confirm
the plate stops reading as critical.
## Round 10 — two hotkeys, one rename, additive exhaustion

Raised 2026-09-02, released as 1.4.0 the same day, no live pass.

### R10.1 Hide the landing tiles for the whole table (`toggleTiles`, Shift+L)

`worldLayer.toggleTiles()` + a `boardHidden` SCENE flag, read and written through
`readBoardHidden` / `writeBoardHidden` in `layout.ts`. The whole overlay is
UNMOUNTED rather than hidden with CSS, so nothing of the board is left to catch a
click or a wheel event over the map — which is the point of hiding it.

**Built client-side first, then moved.** It shipped in this round's first pass as a
per-client view toggle (a `boardHidden` client setting), and was reworked to scene
state on request before release, so there is no migration owed — nobody ever had
the client setting. Storage now matches the Cast Bar's own `visible`: a scene flag,
GM-authored, broadcast to every client, with the `updateScene` hook mounting or
unmounting on each of them. `refresh()`, not `render()`, because a hidden board has
no overlay for `render()` to draw into.

**Per SCENE, not one switch for the world.** Each landing scene has its own layout,
so each gets its own answer about whether that layout is on show. Switch scenes and
you get that scene's answer.

Still deliberately NOT `toggleLanding`, which is a different thing: that removes
the landing DESIGNATION (and asks first, because the board goes with it). This
leaves the scene a landing page with its layout intact — the light switch, not the
demolition. Which is why it ships bound where `toggleLanding` ships unbound, and
why it is gated on `canControl()` rather than `restricted: true`: the same gate the
Cast Bar's visibility key uses, so a trusted player with control can use it and
anyone else falls through to Foundry.

Three consequences, all handled on purpose:

- **Hidden on every client, the GM's included.** A board only the GM could see
  would be a third state that nothing on screen distinguishes from the other two.
- **Entering edit mode un-hides**, which now reveals the board to the table.
  Activating the Bivouac control group is an explicit "I want to work on the
  board" gesture, and you edit a board with the lights on; without it the GM
  clicks the tool and gets an empty screen with no clue why. Hiding while already
  in edit mode is left alone — just as explicit, in the other direction.
- **Designating a scene clears the flag.** Hidden is scene state that outlives the
  designation, so a scene hidden before it was un-designated would otherwise come
  back invisible: the GM sets a landing page, no tiles appear, nothing says why.

**Live test.** On a landing scene with a player connected: Shift+L → tiles go on
BOTH screens, the GM gets the notification, and the map is fully interactive
underneath (drag a token where a tile was). Shift+L → they come back in place, for
both. Reload while hidden → still hidden, and a client connecting while hidden sees
no board. Switch to a second landing scene → its own state, unaffected. Click the
Bivouac scene control while hidden → tiles return for everyone and edit mode is on.
Un-designate a hidden scene, then designate it again → the board comes back
visible. On a NON-landing scene the key must do nothing and fall through (test with
a core binding on the same key). As a plain player, the key does nothing; with
`controlRole` lowered to trusted, it works if they own the scene and Foundry says
so itself if they do not.

### R10.2 The Cast Bar visibility keys, split in two

`castToggleBar` (Shift+B) used to mean "the hovered bar, or every bar if the
pointer is nowhere near one". That fallback is now its own binding:

- `castToggleBar` (Shift+B) — **the bar under the pointer**, and nothing when the
  pointer is elsewhere (the key falls through).
- `castToggleBars` (Shift+V) — **both bars, pointer anywhere**. Ships bound
  because it is what the old fallback did; splitting them should not cost the
  capability.

The all-bars key SETS both bars to one state rather than toggling each: while
either is hidden it opens both, and only with both up does it close them. Two
bars in different states must not simply swap. `CastBar#setVisible` was added for
that — `toggleVisible()` cannot express it.

Both are still world changes (visibility is Scene state, so it shows/hides for
every player); the rename is about WHICH bar, not about who sees it.

**Live test.** With the second bar enabled: hover bar 1, Shift+B → only bar 1
flips. Pointer over the map, Shift+B → nothing happens and the key reaches
Foundry. Shift+V with one bar open → both open. Shift+V again → both close.
With `castBar2Dock` off, Shift+V acts on the one enabled bar. Check the names in
Configure Controls read as the two different things they are.

### R10.3 Exhaustion is additive, and its level is shown

Exhaustion is a NUMBER, and the palette was toggling it like a flag — so a GM
could turn it on and off but never say which of the six levels the character was
on, and the plate showed an icon that meant "some exhaustion".

`systems.ts` gained `levelledStatus()` / `statusLevel()` / `setStatusLevel()`:

- **The level is written where the system reads it** —
  `system.attributes.exhaustion` for dnd5e, through `actor.update()`. That is
  literally the update dnd5e's own Token HUD makes
  (`ActiveEffect5e._manageExhaustion`), so everything the system hangs off that
  number still happens: it rebuilds the effect, swaps in the per-level icon, and
  adds `dead` at the top level. Nothing here touches the effect itself.
- **The gesture is the Token HUD's too** — left click adds a level, right-click
  removes one — so the palette and the HUD cannot teach the GM two different
  things. Bound only on a levelled status; a plain condition keeps its toggle and
  its context menu.
- **How many levels is the world's business, not ours.** The count comes from the
  `CONFIG.statusEffects` entry (dnd5e spreads `conditionTypes.exhaustion` into it,
  `levels: 6` and all), so a homebrewed count is respected, and a status with no
  `levels` falls back to the plain toggle. Only dnd5e exhaustion is mapped: a
  level written where the system will not read it is worse than no level.
- **Displayed in three places**: a badge on the palette button, a badge on the
  plate's condition icon (`ConditionBadge.status` was added so the plate can ask
  the adapter about a status without `foundry-api.ts` knowing any system exists),
  and the level appended to both tooltips, the `+n` overflow included.

**Live test.** dnd5e. Open the palette on a plate → exhaustion shows no badge at
0. Click → level 1, badge appears, the plate's strip shows a 1 and the sheet
agrees. Click to 6 → a seventh click does nothing (clamped, no write). Right-click
down through 0 → the icon leaves the plate and the strip. Set the level from the
Token HUD and the character sheet → the palette and plate follow. Confirm the
plate's number is legible at the default plate size and check what it does at the
`min` tier. On Daggerheart, confirm exhaustion (if the world defines one) is a
plain toggle with no badge and no right-click.

### R10.4 What was checked

`npm run check` — typecheck, lint, nine harnesses, all clean. New: 22 checks in
`test/status-levels.test.mjs` driving the real `levelledStatus` / `statusLevel` /
`setStatusLevel` against a stubbed world (which system maps what, the clamp, the
truncation, no-write-when-unchanged, and the fallbacks for another system, a
missing attribute and a document with no `update()`), plus one check in
`conditions.test.mjs` pinning the new `status` id on every badge.

Nothing NEW is pinned for R10.1: `readBoardHidden` / `writeBoardHidden` are
three-line flag probes, and everything that could actually go wrong about them is
Foundry-side — whether the `updateScene` hook fires with that flag path, whether a
broadcast write reaches a player's client, whether an unmounted overlay really
leaves the canvas alone. None of that can be stubbed usefully, which is exactly
why the live test above is written out in full.

Unverified by anything, as usual: every DOM and keybinding path. Nothing in this
round has been executed by Foundry — in particular the two new keybindings, the
broadcast hide (including on a second client), the palette's right-click and both
level badges.

## Round 11 — inspiration, and a player's own plate

Raised 2026-09-02, in the working tree, released nowhere yet. First live pass
2026-09-05 — see R11.3 for what it found.

### R11.1 An inspiration badge, per plate

A glowing gold d20 after the character's name while they hold inspiration (a gold
star in the plate's corner, in the first cut — see R11.3). `plate.inspiration` (a per-plate toggle beside `stats` in the menu's
Overlays group, and `Shift+I` over a hovered plate) says whether this table tracks
it; the badge appears only when the toggle is on AND the character actually holds
one.

**System knowledge stays in `systems.ts`.** A new optional adapter hook,
`inspiration(doc): boolean | null`, implemented for dnd5e as
`system.attributes.inspiration` — verified against the installed dnd5e 5.3.3,
where it is a `BooleanField` on the CHARACTER data model (`dnd5e.mjs:71974`) and
absent from NPCs. That absence is why the hook is three-valued: `false` is a
character who has spent it, `null` is an actor that was never asked. Both draw
nothing, and keeping them apart is what stops a future `Boolean(v)` from making
every vehicle and shop answer the question.

`systemHasInspiration()` gates the MENU ROW, so a Daggerheart table is not offered
a switch that can never do anything. Nothing here invents an equivalent for other
systems: if a system wants one, it implements the hook.

**Shown to everyone, with no reveal state** — unlike the stats overlay (controller
only) and the conditions strip (three-state). A character's inspiration is already
a button on their own player's sheet, so there is nothing to protect, and a table
that can see who still holds one is the entire point of putting it on the bar.

**Position was the only hard part.** Both top corners are taken (stats left,
conditions right) and the hover control bar shifts both down, so the badge sits in
the band above the name banner, offset by the `--bivouac-name-h` the plate already
publishes. Vertically it therefore stacks with the STATS column, which is why:

- it is sized on the stat-row scale (`clamp(9px, fit*0.072, 14px)`), not the
  larger condition-icon scale;
- it is drawn at the `full` tier only. Not a priority judgement, a measurement: at
  the compact tier's floor (fit 84) the left column has room for one stat row and
  the banner and nothing else. It is the newest and least load-bearing thing in
  that column, so it is the one the ladder drops first.

`test/layout.test.mjs` now models it (`INSP` per tier, added into the left
column's height) and its size list gained 83/84/85 and 129/130/131/140 — the two
tier floors, which is exactly where a new box in that column would first overflow.
At fit 130 the badge IS the binding constraint (left column 64px against the
conditions' 58px) and the plate still has 4px spare.

**Checked.** `npm run check` — typecheck, lint, eleven harnesses, clean. New:
`test/inspiration.test.mjs` (14 checks) on the adapter hook — the boolean read,
`false` vs `null`, an NPC, a non-boolean value, which systems offer the toggle, and
the GM's `castSystem` override being honoured rather than just `game.system.id`.

**Live test.** dnd5e, a PC with inspiration ticked on their sheet: turn the plate's
Overlays → Inspiration on → star appears bottom-left, tooltip names it. Spend the
inspiration on the sheet → the star goes without touching the plate. `Shift+I` over
a hovered plate does the same as the menu row. Shrink the bar until the tier drops
to compact → the star goes and the stat rows stay. An NPC plate: the menu row is
offered (the system has inspiration) but no badge ever appears. Unlinked token of a
PC: confirm the badge follows the TOKEN's copy, not the sidebar prototype. On
Daggerheart, confirm the menu row is absent entirely.

### R11.2 A player's own plate: leave / rejoin, and right-click to speak

Asked for as buttons; the reason they did not already exist was not policy but
**permissions**. Cast Bar state is a Scene flag, and updating a Scene needs
ownership of it, which players do not have — so `#mutate` and `#setSpeaker` were
gated on `canControl()` and a player's press would have thrown a Foundry
permission error rather than doing nothing. A button that errors is worse than no
button, which is why they were GM-only.

So the player asks and the GM writes. `src/plate-requests.ts` holds the whole
protocol: the player's client emits on `module.bivouac`, and the ACTIVE GM's
client — one writer, chosen the way `plate-tokens.ts` chooses one — validates and
makes the write, which broadcasts back through the flag as usual.

**Which plate is "theirs"** is `User#character`, the same rule the raised-hand
badge now uses (`isOwnCharacter` → `isPlayedBy`). Not ownership, and deliberately
so: this world's PCs are owned by the whole table, and gating on ownership would
have handed every player a leave button on every plate — the same defect as the
raised-hand bug, in a place where it would have written to the scene.

**What the GM re-derives** rather than trusting: the scene, the plate, that the
action is one of the two self-service ones, and that the claimed user is playing
that plate's character. **What it cannot check** is the identity claim itself —
Foundry does not stamp a sender onto module socket messages, so `userId` is the
sender's word for it. A hand-crafted message could make another player's plate
leave the conversation or start speaking. That is the ceiling, and it is written
into the module's own header: two cosmetic, reversible states, on a plate whose
player could set them anyway, and never anything an Actor, Token or Combatant can
see. Worth knowing before anyone extends the protocol — the flag allow-list
(`castBar` / `castBar2`) and the action allow-list are what keep it there.

Requests carry the DESIRED VALUE, not "toggle", so a double click, a stale client
or a dropped message cannot leave the flag inverted; the write is idempotent and
matches the optimistic highlight the player already saw. With no GM connected
nothing is sent, the player is told, and the optimistic highlight is not drawn.

Two smaller pieces that had to move with it:

- **`canWriteScene()`** (in the Foundry seam) decides direct-write vs relay, asked
  of the scene document rather than inferred from the role — so a GM writes
  directly, a player is relayed, and a trusted player who genuinely owns the scene
  writes directly too. `canControl()` could not answer this: it is a UI gate on a
  role, not a permission on a document.
- **The hover reveal** is `.bivouac-castbar--editable .bivouac-plate:hover`, which
  is the controller's. A player's own plate carries `--mine` instead, so the bar
  appears on that plate and no other; the overlay shift got the same treatment,
  or the bar's gradient (z 4) would sit over the condition icons (z 2) while the
  pointer rested there.

**Checked.** `test/plate-requests.test.mjs` (35 checks) drives the real handler:
both actions in both directions, idempotence, someone else's plate, a user playing
nothing, ten malformed or out-of-range messages, the non-active-GM drop, and the
emit path with and without a GM connected. Twelve harnesses, all clean.

**Live test.** A player with an assigned character, that character on the bar:
hover their own plate → one button, no grip; press it → the plate darkens for
everyone. Right-click it → they highlight as speaker for everyone; right-click
again → clears. Hover and right-click ANOTHER plate → nothing, and the browser's
own context menu still appears. Disconnect the GM and try both → a notification,
no highlight left behind. Two GMs connected → the action applies once. As GM,
confirm the full bar and every other control are unchanged.

### R11.3 What the first live pass found

Four notes, one of them a real defect that no harness here could have caught.

**The player's controls did nothing, because the manifest never declared a
socket.** Foundry drops socket traffic from a module without `"socket": true` in
`module.json` — silently, before it leaves the sending client — so the request was
emitted into nothing and the GM's refusal log stayed empty, which is what made it
look like a dead button rather than a blocked message. Bivouac had never used a
socket for anything of its own (the raise-hand integration only LISTENS to another
module's channel, which needs no declaration), so the flag had never been needed.
Added.

Worth remembering for anyone testing this next: a manifest change is not picked up
by a reload. Foundry reads `module.json` when the world launches, so it takes a
return to Setup and a relaunch.

The other three were style, all of them from seeing it in a real scene rather than
in a model:

- **The inspiration badge moved into the name banner** and lost its box. It was a
  pilled star in the bottom-left corner, sized against the plate and hidden below
  the `full` tier because it had to share the left column with the stat rows. (The
  star became a d20 once it was on the banner: at that size a die reads as "a roll
  is waiting here", where a star read as a rating.)
  Inside the banner it costs no height at all, so it needs no tier ladder, no
  column arithmetic and no entry in the vertical model — the sizes that entry
  added (83/84/85, 129/130/131/140, the two tier floors) are kept, because they
  are the right sizes to test whatever lands in that column next. It leads the
  name rather than trailing it: the banner clamps with an ellipsis, and a trailing
  star on a long name is the character that gets cut. It carries its own colour
  and its own glow so the controller's hide-the-name hover preview (which sets the
  name `transparent`) leaves it alone — players see the star on a hidden name, so
  the preview is more honest with it left in — and it swallows its own clicks,
  because the name it sits in is the controller's click-to-hide target.
- **The levelled-condition number is red**, on the plate and in the palette. The
  only levelled condition in play is exhaustion, where the number is a count of
  harm rather than a neutral tally.
- **The stat overlay is out of the text-outline feature.** Those rows sit on their
  own `rgba(0,0,0,0.55)` panel with a backdrop blur, which is already the whole of
  their legibility; the outline only thickened 9px digits, and the soft-glow mode
  did it worse. They keep the plain drop shadow they had before that feature
  existed. This is the rule the outline block already stated — prose and text on
  solid panels are excluded, text over artwork is not — applied to a case that had
  been left on the wrong side of it. The plate NAME still takes its nameplate
  shadow, since that does sit on the portrait.

**Tried and reverted, same day:** tinting the die and its glow with `User#color`,
so each player's inspiration wore their own colour. It read as noise — five
plates, five colours, competing with the portraits and with each other for a
badge that means the same thing on every plate. One gold for everyone is the
answer; the helper that found a character's player colour went with it, so
anything wanting it later starts from the raised-hand mapping in
`widgets/foundry-api.ts`.

**Still owed from this pass:** everything in R11.2's live test, which could not run
until the socket flag existed.

### R11.4 Second live pass: the button is still dead, and the bar got bigger

**The player's leave button was still dead with `"socket": true` in the manifest —
because Foundry reads manifests when the WORLD LAUNCHES.** The file on disk said
`true`; the running world had read the old one, so the server dropped every
`module.bivouac` message before any client saw it. Perfectly silent from both ends:
the sender emits without error, and no listener anywhere is called, so there is
nothing to log. `game.modules.get("bivouac").socket` — the manifest as the SERVER
read it — reported `false` and named it in one line. Returning to Setup and
relaunching the world fixed it with no code change.

Five readings of the code had failed to find it, because the code was right. What
found it was instrumenting each decision point and then asking the two clients
separately: the player's console proved the request was built and emitted, the GM's
proved nothing arrived, and the gap between those two facts is server-side by
elimination. Worth remembering as a method — a distributed path needs evidence from
BOTH ends before the middle is suspected.

**Now self-reporting.** `wirePlateRequests()` compares the running world's manifest
against what the feature needs, and warns the GM to relaunch if it is stale, so this
particular silence cannot happen twice. It is a dev-install trap only: a module
installed from a release has its manifest read at install time.

The instrumentation is gone again, bar the refusal line and the not-sent line —
both failure paths, both quiet in normal play. So is `diagnosePlates()`, the
throwaway console dump that printed each plate's uuid, resolved actor,
`User#character` and scene write permission: it did its job (it ruled out the
mismatch theory in one line, showing `isOwnCharacter: true` on the right plate) and
a table does not need it. It is a twenty-minute rewrite if the next one needs it.

**Controls 15% larger** (`--bivouac-ctrl-sz` 16/0.11/22 → 18/0.127/25), and the
exit control is now `fa-person-through-window`. The tier widths had to move with
it, and further than 15%: `TIER_MIN_W` full 110 → 140, compact 78 → 82, min 40 →
42. The button scales with the plate's HEIGHT while the bar must fit its WIDTH, so
on a tall narrow shape the bar grows faster than the room for it — tarot at the old
`full` threshold wanted 129px of bar in 110px of plate. The horizontal model caught
all five failures the moment the size changed, which is precisely what it is for.
The cost is a mid-sized narrow plate showing the compact bar where it used to show
the full one.

## Feature requests — to do (raised 2026-09-02)

Neither of these is started. They are written up here rather than kept in a chat
log so the design questions they raise are answered once, in the open, before
anyone starts typing.

### FR1. A note on a condition icon

**Asked for.** Right-click a status/condition icon on a Plate to type a short
note, shown to the GM when they hover that condition. The example given is a
`DC:18` on **Stunned**, so the GM can refer back to the save DC later.

Design questions, with a recommendation each:

- **Where the note lives.** On the granting **ActiveEffect**, as a module flag
  (`effect.setFlag(MODULE_ID, "note", …)`). Recommended, because the note then
  has the same lifetime as the thing it annotates: clear the condition and the
  note goes with it, which is right — a DC belongs to *this* Stunned, not to the
  character forever. The alternative (a map on the Plate, in the Scene flag)
  outlives the condition and would need its own cleanup pass.
  - Caveat to check first: a status can be present with no effect of its own to
    hang a flag on. dnd5e exhaustion is the awkward case — its effect is derived
    from `system.attributes.exhaustion` and carries a static id, so a flag on it
    may not survive the system rebuilding it. A per-Plate fallback keyed by status
    id is probably needed for exactly that case.
- **Who sees it.** GMs only, per the request. Note honestly that this is a
  DISPLAY choice, not secrecy: a flag on an effect is readable by any client that
  can read the actor, so the note must never hold anything the table must not
  have. Say so in the entry UI.
- **The gesture.** Right-click already means something on a Plate (and
  `contextmenu` is now taken inside the condition palette for stepping a level
  DOWN — see round 10). Check what a right-click on the strip currently does
  before claiming it: the strip is `pointer-events: none` with the icons set to
  `auto`, so the icon can take the event, but the plate's own handlers are behind
  it.
- **Where it shows.** The icons' only label today is `data-tooltip`, which is
  plain text — a name plus a note wants two lines, so this likely needs
  `data-tooltip-html` (or a small popover on hover) and an HTML-escaping pass on
  whatever the GM typed. Don't forget the `+n` overflow: its tooltip lists the
  conditions that did not fit, and a note on one of those has to appear there too.
- **Entry UI.** Reuse `src/popover.ts` anchored to the icon, as the condition
  palette and the plate menu do, rather than a `DialogV2` — same idiom, and it
  cannot be clipped by the plate.
- **A note is worth a badge.** An annotated condition should look annotated
  (a dot or a corner mark), or the GM has to hover every icon to find the one
  they wrote on.

### FR2. A party-inventory tile

**Asked for.** A Bivouac tile that collates the inventories of a set number of
Actors: key totals such as combined currency, with items grouped into categories
(Equipment, Food, Consumables, Loot, …).

Design questions, with a recommendation each:

- **Actor selection.** Reuse the `cards` tile's shape: a list of Actor UUIDs the
  GM drops in, with `applyCardOp` already handling add / remove / reorder. No new
  configuration idiom needed.
- **Currency is system-specific and needs an adapter hook.** dnd5e keeps
  `system.currency` as pp/gp/ep/sp/cp; Daggerheart counts handfuls, bags and
  chests; the generic adapter has no concept of money. This belongs in
  `systems.ts` as a `currency()` reader per adapter (returning labelled
  denominations, not a single number — collapsing to "gp" bakes in a conversion
  rate that is a table's house rule), with the tile drawing whatever comes back
  and showing nothing at all on a system with no reader.
- **So are categories.** "Food" is not an item type in dnd5e, it is
  `consumable` with `system.type.value === "food"`; Loot, Equipment and Tool are
  types. That mapping is exactly the kind of knowledge `systems.ts` exists to
  hold — an `itemCategory(item)` hook per adapter, with an "Other" bucket so an
  unmapped item is still listed rather than silently dropped. The category ORDER
  should be the adapter's, so it reads the way that system's players think.
- **Which totals earn their place.** Combined currency, per-category counts, and
  (where the system has encumbrance) total weight against the party's capacity.
  Resist a wall of numbers: the tile is read from across the room.
- **Permissions.** A player looking at this tile should see what they could see
  by opening the sheets they own — no more. The plate conditions reveal is the
  precedent: default to what `canView` allows, with an explicit GM override to
  make the whole thing public.
- **Sizing.** It is a list tile, so it needs the container-query sizing the mini
  sheet uses plus its own internal scroll, and a sensible LOD placeholder when
  the board is zoomed out.
- **Out of scope for a first version**, and worth saying so up front: moving
  items between actors from the tile. That is a write path into other people's
  sheets and deserves its own round.

## Verification debt

**Nothing in rounds 7, 8 or 9 has run in a live Foundry world.** That is the whole
of the outstanding risk on this branch, and it has grown twice over: round 8 added
a feature that writes TokenDocuments into scenes (#4) and one that writes
ActiveEffects to actors (#5), and round 9 rebuilt the plate chrome around a size
ladder whose correctness is argued from modelled CSS geometry rather than observed
layout. None of it has been executed by Foundry once.

What checking there has been:

- `npm run typecheck`, `npm run lint`, `npm run build` — clean.
- Five harnesses in the session scratchpad: `pt.test` (24), `hp.test` (17),
  `hp2.test` (23), `layout` and `i18n`. The first three `esbuild`-bundle the real
  source against stubbed Foundry globals, so they exercise the shipped modules
  rather than paraphrases — but they stub Foundry, so they prove the logic, not the
  API calls it makes. `layout` models the CSS rather than executing it.
- Unverified by anything: every DOM path. The plate menu, the condition palette,
  the plate-art dialog, the wounded tint, the hover shift, the condition wrap and
  every tier hand-over.
- The harnesses are scratchpad-only and will not survive the session. Worth moving
  into the repo with a runner if this becomes a habit — `layout` in particular
  caught three defects that review had missed.

Round 7's own runtime pass is still outstanding and is separate from all of the
above: the Add-tile picker order, one tile of each of the 10 types, and a meter in
each of the 5 shapes.

Two Foundry APIs are used here for the first time and are worth confirming early,
since a wrong name fails quietly behind a guard: `Actor#toggleStatusEffect`
(assumed present in v13+; the palette shows a notification and does nothing if
not) and `Actor#getTokenDocument` (a parked token silently isn't created if
absent).

One CSS assumption is load-bearing and equally worth an early look: the conditions
column relies on `flex-direction: column` + `flex-wrap: wrap` +
`align-content: flex-end` in a right-anchored absolute box growing LEFTWARD as it
wraps. If a browser lays that out the other way the second column would run off
the plate's right edge instead of inward.
