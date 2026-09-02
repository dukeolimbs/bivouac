/**
 * Bivouac — entry point.
 *
 * A persistent, modular "table surface": a designated landing Scene carries a
 * grid of widgets (web views, clickable images, notes) that pan and zoom with
 * the map, plus a GM-only DM screen drawer.
 *
 * MVP scope — landing widgets (webview / image / note), GM edit mode
 * (add / move / resize / configure / delete), per-GM DM screen, LOD for
 * web views. See docs/landing-page-design-spec.md.
 */

import { FLAGS, GRID, MODULE_ID, PLATE_SHAPE_DEFAULT, SETTINGS, TEXT_STROKE, log } from "./constants";
import {
  activeLandingScene,
  clearLayoutHistory,
  getLandingSceneId,
  getLandingSceneIds,
  isLandingScene,
  redoLayout,
  setLandingSceneId,
  setLandingScenes,
  undoLayout,
  writeBoardHidden,
} from "./layout";
import { worldLayer } from "./world-layer";
import { dmScreen } from "./dm-screen";
import {
  castBar,
  castBar2,
  castBars,
  castPlateAction,
  castToggleAllVisible,
  castToggleVisible,
  onRaiseHandMessage,
} from "./cast-bar";
import { availableFonts, ensureGoogleFont, setTextStrokeVars, textOutlineMode } from "./widgets";
import { pickWidgetType } from "./widget-config";
import { decorateSettingsForm, teardownSettingsForm } from "./settings-ui";
import { ADAPTERS, activeAdapter, statSettingKey } from "./systems";
import { syncPlateTokens, sweepPlateTokens } from "./plate-tokens";

Hooks.once("init", () => {
  log("Initializing");

  /* ============================================================ settings ===
   * Registration order IS the order of the rows in Foundry's Settings window,
   * so the visible settings below are grouped and ordered exactly as they are
   * presented — see `SETTING_GROUPS` in `settings-ui.ts`, which draws the
   * section headings around these same rows. Add a new visible setting to both.
   * Hidden (`config: false`) state settings live in their own block further down.
   */

  /* -------------------------------------------- Appearance -------------- */

  // Bivouac's text nearly always sits over artwork — plate portraits, tile art,
  // the map itself — so a thin dark stroke keeps it legible against anything.
  // Applied to short labels over art (see the `--bivouac-text-stroke` block in
  // module.css); prose and panel text opt in per-tile instead, where a stroke
  // would hurt more than it helps at reading sizes.
  game.settings.register(MODULE_ID, SETTINGS.textStroke, {
    name: "BIVOUAC.Settings.TextStroke.Name",
    hint: "BIVOUAC.Settings.TextStroke.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => applyTextStroke(),
  });

  // Outline SHAPE. Same mechanism, different numbers — a hard outline suits the
  // chunky display faces the plates use, while a soft dark halo reads cleaner
  // over busy or light artwork and doesn't fight thin serifs. Stroke stays the
  // default, so nothing changes for an existing world.
  game.settings.register(MODULE_ID, SETTINGS.textOutlineMode, {
    name: "BIVOUAC.Settings.TextOutlineMode.Name",
    hint: "BIVOUAC.Settings.TextOutlineMode.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      stroke: "BIVOUAC.Settings.TextOutlineMode.Stroke",
      blur: "BIVOUAC.Settings.TextOutlineMode.Blur",
    },
    default: "stroke",
    onChange: () => applyTextStroke(),
  });

  // Width in px. Slider bounds live in `TEXT_STROKE` so the registration, both
  // apply paths and the live preview share one source of truth. The number means
  // the same thing in both modes: blur mode scales it (see `OUTLINE_BLUR`)
  // rather than reusing it raw, which would look far softer at the same setting.
  game.settings.register(MODULE_ID, SETTINGS.textStrokeWidth, {
    name: "BIVOUAC.Settings.TextStrokeWidth.Name",
    hint: "BIVOUAC.Settings.TextStrokeWidth.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: TEXT_STROKE.min, max: TEXT_STROKE.max, step: TEXT_STROKE.step },
    default: TEXT_STROKE.default,
    onChange: () => applyTextStroke(),
  });

  /* -------------------------------------------- Landing Page ------------- */

  // Minimum user role that can control tiles/cards (add / remove / reorder /
  // drop-to-tile). Default GM. Non-GMs also need Foundry permission to persist
  // (scene ownership for the landing board).
  game.settings.register(MODULE_ID, SETTINGS.controlRole, {
    name: "BIVOUAC.Settings.ControlRole.Name",
    hint: "BIVOUAC.Settings.ControlRole.Hint",
    scope: "world",
    config: true,
    type: Number,
    choices: {
      1: "BIVOUAC.Settings.ControlRole.Player",
      2: "BIVOUAC.Settings.ControlRole.Trusted",
      3: "BIVOUAC.Settings.ControlRole.Assistant",
      4: "BIVOUAC.Settings.ControlRole.GM",
    },
    default: CONST.USER_ROLES.GAMEMASTER,
  });

  // Largest a widget may be resized to, in grid squares (read live on resize).
  game.settings.register(MODULE_ID, SETTINGS.maxWidgetSize, {
    name: "BIVOUAC.Settings.MaxWidgetSize.Name",
    hint: "BIVOUAC.Settings.MaxWidgetSize.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 4, max: 100, step: 1 },
    default: GRID.max,
  });

  // What dropping an Actor on the board makes. Per client, because it's a
  // workflow preference of whoever is dragging, not a property of the world.
  // "Ask" is the default per the request; the other two exist because always
  // prompting wears thin while laying out a scene. Holding Shift while dropping
  // brings the prompt back whatever this is set to.
  game.settings.register(MODULE_ID, SETTINGS.actorDropTile, {
    name: "BIVOUAC.Settings.ActorDropTile.Name",
    hint: "BIVOUAC.Settings.ActorDropTile.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      ask: "BIVOUAC.Settings.ActorDropTile.Ask",
      actor: "BIVOUAC.Settings.ActorDropTile.Art",
      minisheet: "BIVOUAC.Settings.ActorDropTile.Mini",
    },
    default: "ask",
  });

  // How many live web views the board may show before level-of-detail kicks in
  // (LOD then swaps far-away web views for a quiet placeholder while zoomed out).
  // Per-client performance knob; set high to keep every web view live.
  game.settings.register(MODULE_ID, SETTINGS.lodMinWebviews, {
    name: "BIVOUAC.Settings.LodMinWebviews.Name",
    hint: "BIVOUAC.Settings.LodMinWebviews.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 1, max: 60, step: 1 },
    default: 10,
    onChange: () => worldLayer.render("lod"),
  });

  /* -------------------------------------------- DM Screen --------------- */

  // DM-screen dock mode — beside the sidebar (default; keeps chat/dice visible)
  // or over it (the original behaviour). Also toggleable from the DM header gear.
  game.settings.register(MODULE_ID, SETTINGS.dmDock, {
    name: "BIVOUAC.Settings.DmDock.Name",
    hint: "BIVOUAC.Settings.DmDock.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      beside: "BIVOUAC.Settings.DmDock.Beside",
      over: "BIVOUAC.Settings.DmDock.Over",
      left: "BIVOUAC.Settings.DmDock.Left",
      top: "BIVOUAC.Settings.DmDock.Top",
      bottom: "BIVOUAC.Settings.DmDock.Bottom",
    },
    default: "over",
    onChange: () => dmScreen.applyDock(),
  });

  // Vertical position of the DM-screen tab, as a percentage of viewport height.
  game.settings.register(MODULE_ID, SETTINGS.dmTabTop, {
    name: "BIVOUAC.Settings.DmTabTop.Name",
    hint: "BIVOUAC.Settings.DmTabTop.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 100, step: 0.1 },
    default: 45.1,
    onChange: () => applyTabSettings(),
  });

  // Gap the DM-screen tab keeps to the left of the sidebar edge — exposed as a
  // slider so it can be widened to clear other right-docked UI (e.g. a party
  // HUD) without editing CSS. Applied live via `applyDmTabPad`.
  game.settings.register(MODULE_ID, SETTINGS.dmTabPad, {
    name: "BIVOUAC.Settings.DmTabPad.Name",
    hint: "BIVOUAC.Settings.DmTabPad.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: -200, max: 400, step: 1 }, // negative pushes the tab toward / over the sidebar edge
    default: -33,
    onChange: () => applyTabSettings(),
  });

  /* -------------------------------------------- Cast Bar ---------------- */
  // Per-client placement; roster / visibility live on the scene.

  // Which edge the Cast Bar docks to. Per client, so each user can place it.
  game.settings.register(MODULE_ID, SETTINGS.castBarDock, {
    name: "BIVOUAC.Settings.CastBarDock.Name",
    hint: "BIVOUAC.Settings.CastBarDock.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      top: "BIVOUAC.Settings.CastBarDock.Top",
      bottom: "BIVOUAC.Settings.CastBarDock.Bottom",
      left: "BIVOUAC.Settings.CastBarDock.Left",
      right: "BIVOUAC.Settings.CastBarDock.Right",
    },
    default: "right",
    onChange: () => {
      castBar.applyDock();
      castBar.applySize();
    },
  });

  // GM override for the primary bar's edge. The GM frames a scene around where
  // the strip sits — what it covers, where the art's focal point is — and by
  // default every player places it somewhere else, so nobody's screen matches
  // what was set up.
  //
  // A SEPARATE world setting rather than flipping `castBarDock`'s scope: changing
  // an existing setting's scope silently discards every client's saved choice, so
  // turning the override back off would leave everyone somewhere they never
  // picked. This way the client value is preserved underneath and returns intact.
  // (The second bar has been world-scoped all along, so this really just makes
  // bar 1 able to behave like bar 2.)
  game.settings.register(MODULE_ID, SETTINGS.castBarDockForced, {
    name: "BIVOUAC.Settings.CastBarDockForced.Name",
    hint: "BIVOUAC.Settings.CastBarDockForced.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      off: "BIVOUAC.Settings.CastBarDockForced.Off",
      top: "BIVOUAC.Settings.CastBarDock.Top",
      bottom: "BIVOUAC.Settings.CastBarDock.Bottom",
      left: "BIVOUAC.Settings.CastBarDock.Left",
      right: "BIVOUAC.Settings.CastBarDock.Right",
    },
    default: "off",
    onChange: () => {
      castBar.applyDock();
      castBar.applySize();
    },
  });

  // Optional SECOND Cast Bar — "off" (default) or which edge it docks to, so a GM
  // can run two strips (e.g. party in one, NPCs in the other). World-scoped so
  // enabling it shows it for every client. It keeps its own per-scene roster;
  // Actor size / tab position / tab padding are shared with the primary bar.
  game.settings.register(MODULE_ID, SETTINGS.castBar2Dock, {
    name: "BIVOUAC.Settings.CastBar2Dock.Name",
    hint: "BIVOUAC.Settings.CastBar2Dock.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      off: "BIVOUAC.Settings.CastBar2Dock.Off",
      top: "BIVOUAC.Settings.CastBar2Dock.Top",
      bottom: "BIVOUAC.Settings.CastBar2Dock.Bottom",
      left: "BIVOUAC.Settings.CastBar2Dock.Left",
      right: "BIVOUAC.Settings.CastBar2Dock.Right",
    },
    default: "off",
    onChange: () => {
      castBar2.applyDock();
      castBar2.applySize();
      castBar2.refresh();
    },
  });

  // Cast Bar plate size (px). Per client, so each user (players too) sizes the
  // floating plates to taste.
  game.settings.register(MODULE_ID, SETTINGS.castBarSize, {
    name: "BIVOUAC.Settings.CastBarSize.Name",
    hint: "BIVOUAC.Settings.CastBarSize.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 100, max: 400, step: 5 },
    default: 220,
    onChange: () => castBars.forEach((b) => b.applySize()),
  });

  // Plate shape. World-scoped, unlike the plate SIZE (client): size is "how big
  // on my screen", but shape is driven by the art the GM chose for the cast —
  // full-body character art wants a tall plate, token art wants a square one —
  // so it should look the same for everyone at the table.
  game.settings.register(MODULE_ID, SETTINGS.castPlateShape, {
    name: "BIVOUAC.Settings.CastPlateShape.Name",
    hint: "BIVOUAC.Settings.CastPlateShape.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      portrait: "BIVOUAC.Settings.CastPlateShape.Portrait",
      tarot: "BIVOUAC.Settings.CastPlateShape.Tarot",
      square: "BIVOUAC.Settings.CastPlateShape.Square",
      wide: "BIVOUAC.Settings.CastPlateShape.Wide",
    },
    default: PLATE_SHAPE_DEFAULT,
    // applySize republishes the aspect var and re-runs the fit maths, which both
    // depend on the shape.
    onChange: () => castBars.forEach((b) => b.applySize()),
  });

  // Hide the Cast Bar(s) while a combat encounter is running (edit mode overrides).
  game.settings.register(MODULE_ID, SETTINGS.castHideInCombat, {
    name: "BIVOUAC.Settings.CastHideInCombat.Name",
    hint: "BIVOUAC.Settings.CastHideInCombat.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => castBars.forEach((b) => b.refresh()),
  });

  // Back every plate with a hidden Token in the scene, so the rest of Foundry can
  // find plated characters.
  //
  // ON by default as of 1.3.3. It shipped off, on the reasoning that it writes to
  // world data and so should be asked for — but that put the cost in the wrong
  // place. Without it the combat control on a plate has nothing to make a
  // combatant out of, so the common case was a button that explained why it could
  // not work; the setting was effectively a prerequisite dressed up as an option.
  //
  // What makes the default safe is that the pass is reversible and
  // self-correcting: it never touches a token it did not place, it stands aside
  // for any real token, and switching the setting OFF sweeps every token it ever
  // placed, in every scene. So a GM who does not want this gets a clean scene
  // back from one click, which is the property a default needs.
  game.settings.register(MODULE_ID, SETTINGS.castPlateTokens, {
    name: "BIVOUAC.Settings.CastPlateTokens.Name",
    hint: "BIVOUAC.Settings.CastPlateTokens.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: (v: unknown) => void (v ? syncPlateTokens() : sweepPlateTokens()),
  });

  // Wounded states on plates: swap to the plate's injured / critical art when it
  // has any, otherwise tint the normal portrait — so it reads with no per-character
  // setup and the art is an upgrade rather than the entry fee.
  game.settings.register(MODULE_ID, SETTINGS.castWoundStates, {
    name: "BIVOUAC.Settings.CastWoundStates.Name",
    hint: "BIVOUAC.Settings.CastWoundStates.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => castBars.forEach((b) => b.refresh()),
  });

  // The two thresholds, as PERCENTAGES of full health. Configurable rather than
  // fixed at 50/10: where "hurt" sits is a table's judgement, and systems differ
  // in how fast health falls. `critical` is tested first, so setting both to the
  // same number collapses to a single state rather than misbehaving.
  for (const [key, def] of [
    [SETTINGS.castWoundInjured, 50],
    [SETTINGS.castWoundCritical, 10],
  ] as const) {
    game.settings.register(MODULE_ID, key, {
      name: `BIVOUAC.Settings.${key[0].toUpperCase()}${key.slice(1)}.Name`,
      hint: `BIVOUAC.Settings.${key[0].toUpperCase()}${key.slice(1)}.Hint`,
      scope: "world",
      config: true,
      type: Number,
      range: { min: 0, max: 100, step: 5 },
      default: def,
      onChange: () => castBars.forEach((b) => b.refresh()),
    });
  }

  // Position of the Cast Bar toggle tab along its docked edge (%).
  game.settings.register(MODULE_ID, SETTINGS.castBarTabPos, {
    name: "BIVOUAC.Settings.CastBarTabPos.Name",
    hint: "BIVOUAC.Settings.CastBarTabPos.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 100, step: 0.1 },
    default: 50,
    onChange: () => castBars.forEach((b) => b.applyTabPos()),
  });

  // Horizontal gap the right-docked Cast Bar toggle tab keeps from the sidebar
  // (same method + range as the DM-screen tab's edge padding; negative pushes it
  // toward / over the sidebar edge). Only affects a right-docked Cast Bar.
  game.settings.register(MODULE_ID, SETTINGS.castBarTabPad, {
    name: "BIVOUAC.Settings.CastBarTabPad.Name",
    hint: "BIVOUAC.Settings.CastBarTabPad.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: -200, max: 400, step: 1 },
    default: -33,
    onChange: () => castBars.forEach((b) => b.applyTabPos()),
  });

  /* -------------------------------------------- Cast Bar — text --------- */

  // Cast Bar font — a dropdown of Foundry's known fonts (incl. Manage-Fonts ones)
  // plus a custom Google Font that overrides it, mirroring the tile font chooser.
  // Per client. Empty = the theme default.
  const castFontChoices: Record<string, string> = { "": "BIVOUAC.Settings.CastBarFont.Default" };
  for (const f of availableFonts()) castFontChoices[f] = f;
  game.settings.register(MODULE_ID, SETTINGS.castBarFont, {
    name: "BIVOUAC.Settings.CastBarFont.Name",
    hint: "BIVOUAC.Settings.CastBarFont.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: castFontChoices,
    default: "",
    onChange: () => applyCastFont(),
  });
  game.settings.register(MODULE_ID, SETTINGS.castBarFontCustom, {
    name: "BIVOUAC.Settings.CastBarFontCustom.Name",
    hint: "BIVOUAC.Settings.CastBarFontCustom.Hint",
    scope: "client",
    config: true,
    type: String,
    default: "",
    onChange: () => applyCastFont(),
  });
  // Cast Bar name font-size multiplier (1 = the auto size that scales with the
  // plate). Per client.
  game.settings.register(MODULE_ID, SETTINGS.castBarFontSize, {
    name: "BIVOUAC.Settings.CastBarFontSize.Name",
    hint: "BIVOUAC.Settings.CastBarFontSize.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0.5, max: 2, step: 0.05 },
    default: 1,
    onChange: () => applyCastFont(),
  });

  /* -------------------------------------------- Cast Bar — stats -------- */

  // Which game system's data the stats are read from. Auto-detects from
  // `game.system.id` — the world already knows what it's running, so a manual
  // picker would only be one more thing to get wrong. The setting is the OVERRIDE:
  // force the generic (no stats), or point a reskinned system at an adapter that
  // fits it. Requires a reload because the per-stat toggles below are registered
  // from whatever this resolves to.
  game.settings.register(MODULE_ID, SETTINGS.castSystem, {
    name: "BIVOUAC.Settings.CastSystem.Name",
    hint: "BIVOUAC.Settings.CastSystem.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      auto: "BIVOUAC.Settings.CastSystem.Auto",
      ...Object.fromEntries(ADAPTERS.map((a) => [a.id, a.label])),
    },
    default: "auto",
    requiresReload: true,
  });

  // GM-defined stat rows. Registered HERE, out of order with the other hidden
  // settings further down, because the toggle loop immediately below reads it via
  // `activeAdapter()` — a `config: false` setting has to exist before anything
  // derived from it is registered. That ordering constraint is the whole reason
  // custom rows are more than a read-side change.
  game.settings.register(MODULE_ID, SETTINGS.customStats, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });

  // One toggle per stat the ACTIVE adapter exposes, rather than a fixed dnd5e
  // four — under Daggerheart those four would be meaningless (it has no AC and no
  // passive skills at all). All on by default; each plate still starts with its
  // stats hidden, toggled per-plate from the bar's hover controls.
  //
  // GM-defined rows come through the same list, but their labels are literals the
  // GM typed rather than i18n keys, so they can't go through `statSettingKey`.
  for (const stat of activeAdapter().stats) {
    game.settings.register(MODULE_ID, stat.setting, {
      name: stat.custom ? stat.label : statSettingKey(stat, "Name"),
      hint: stat.custom ? (stat.hint ?? "") : statSettingKey(stat, "Hint"),
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => castBars.forEach((b) => b.refresh()),
    });
  }

  /* ------------------------------ stored state (not shown in Settings) --- */
  // `config: false` — these persist what the user set by dragging / clicking in
  // the UI itself, so they'd only be noise in the Settings window.

  // Legacy single landing Scene id, migrated into `landingSceneIds` on ready.
  game.settings.register(MODULE_ID, SETTINGS.landingSceneId, {
    scope: "world",
    config: false,
    type: String,
    default: "",
  });

  // Set of Scenes designated as landing pages (several allowed). Any of them
  // shows the board when it's the active/viewed scene.
  game.settings.register(MODULE_ID, SETTINGS.landingSceneIds, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });

  // DM-screen drawer width (px). Set by dragging the drawer's inner edge, so it
  // is hidden from the settings menu and persisted per-GM (applied on mount by
  // `dmScreen.applyDrawerWidth`).
  game.settings.register(MODULE_ID, SETTINGS.dmDrawerWidth, {
    scope: "client",
    config: false,
    type: Number,
    default: 380,
  });

  // DM-screen drawer height (px, top/bottom dock). Drag-set + persisted per-GM.
  game.settings.register(MODULE_ID, SETTINGS.dmDrawerHeight, {
    scope: "client",
    config: false,
    type: Number,
    default: 320,
  });

  // Per-bar quick scale multiplier (driven by the hover +/- on each bar), per
  // client.
  game.settings.register(MODULE_ID, SETTINGS.castBarScale, {
    scope: "client",
    config: false,
    type: Number,
    default: 1,
    onChange: () => castBar.applySize(),
  });
  game.settings.register(MODULE_ID, SETTINGS.castBar2Scale, {
    scope: "client",
    config: false,
    type: Number,
    default: 1,
    onChange: () => castBar2.applySize(),
  });

  /* ========================================================= keybindings === */

  // Esc closes the DM screen. Registered as a PRIORITY keybinding that consumes
  // the key (returns true) only while the drawer is open, so it pre-empts
  // Foundry's core "dismiss" action (which would otherwise open the Esc menu).
  // When the drawer is closed it returns false and Esc behaves normally.
  game.keybindings.register(MODULE_ID, "closeDMScreen", {
    name: "BIVOUAC.Keybindings.CloseDMScreen",
    editable: [{ key: "Escape" }],
    restricted: true,
    precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
    onDown: () => {
      if (!dmScreen.isOpen) return false;
      dmScreen.toggle(false);
      return true;
    },
  });

  // Cast Bar accelerators. Every one of these already exists as a button — the
  // bar's × and the four hover controls on a plate — but hunting a small button
  // with the pointer mid-conversation is the fiddly part, so these do the same
  // thing to whatever the pointer is already over.
  //
  // They all return FALSE when they didn't act (no plate hovered, or no
  // permission), so the key falls straight through to Foundry or another module.
  // That's what makes plain-ish defaults safe: the binding is inert unless you're
  // actually hovering a plate. Shift+<letter> because core takes most unmodified
  // letters (A C D E F Q R S T U W) and Electron treats Alt as a menu key.
  const castKey = (
    id: string,
    key: string,
    onDown: () => boolean,
    editable = true,
  ): void => {
    game.keybindings.register(MODULE_ID, id, {
      name: `BIVOUAC.Keybindings.${id[0].toUpperCase()}${id.slice(1)}`,
      editable: editable ? [{ key, modifiers: ["Shift"] }] : [],
      // NOT `restricted` (which would mean GM-only): the buttons these stand in
      // for are shown to whoever the `controlRole` setting allows, which can
      // include trusted players. `canControl()` inside each handler is the real
      // gate, so a user who may not act simply falls through to Foundry.
      restricted: false,
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
      onDown,
    });
  };

  castKey("castToggleBar", "KeyB", () => castToggleVisible());
  // The all-bars key, so the hovered one above can be exactly that. It ships
  // bound because it is what the old hovered-or-everything behaviour of Shift+B
  // fell back to — splitting them should not cost the capability.
  castKey("castToggleBars", "KeyV", () => castToggleAllVisible());
  castKey("castSpeaker", "KeyS", () => castPlateAction("speaker"));
  castKey("castStats", "KeyT", () => castPlateAction("stats"));
  castKey("castHidePlate", "KeyH", () => castPlateAction("hidden"));
  castKey("castExitPlate", "KeyE", () => castPlateAction("exited"));
  castKey("castToggleName", "KeyN", () => castPlateAction("name"));
  castKey("castConditions", "KeyC", () => castPlateAction("conditions"));
  castKey("castArt", "KeyA", () => castPlateAction("art"));
  // The menu holds hide / stats / conditions-reveal / name / remove, so this key
  // is also the escape hatch at the smallest size tiers, where the control bar
  // thins to a grip and a menu button — or, below 50px wide, disappears.
  castKey("castMenu", "KeyM", () => castPlateAction("menu"));
  castKey("castCombat", "KeyF", () => castPlateAction("combat"));
  // Removing a plate is the one destructive action here and there is no confirm
  // on it, so it ships UNBOUND — a hotkey that deletes on a single press is far
  // too easy to fire by accident. Assign it in Configure Controls if wanted.
  castKey("castRemovePlate", "", () => castPlateAction("remove"), false);

  // Hide/show the board TILES for the whole table — the "everyone look at the
  // map for a moment" key. Deliberately NOT the same thing as `toggleLanding`
  // below: that removes the scene's landing DESIGNATION and asks first, while
  // this leaves the scene a landing page with its layout intact and flips one
  // flag. Scene state, so it broadcasts (see `worldLayer.boardHidden`).
  //
  // Ships BOUND, unlike `toggleLanding`, because it is reversible in one press
  // and has no confirm to bypass. Not `restricted` — GM-only — for the same
  // reason the Cast Bar keys are not: `canControl()` inside is the real gate, so
  // a trusted player the GM has given control can use it and everyone else falls
  // straight through to Foundry.
  game.keybindings.register(MODULE_ID, "toggleTiles", {
    name: "BIVOUAC.Keybindings.ToggleTiles",
    hint: "BIVOUAC.Keybindings.ToggleTilesHint",
    editable: [{ key: "KeyL", modifiers: ["Shift"] }],
    restricted: false,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    onDown: () => worldLayer.toggleTiles(),
  });

  // Toggle the Landing Page on the current scene. The scene-control button
  // already does this, but reaching it means selecting the Bivouac control group
  // — which turns EDIT MODE on as a side effect (the group's `onChange` drives
  // `setEditMode`). The key does the one thing without that.
  //
  // Ships UNBOUND, like `castRemovePlate`: every unmodified letter worth having
  // is taken by core, and this is a world change that hides a scene's board.
  //
  // The existing confirm is NOT bypassed — `toggleLandingScene()` prompts when
  // it's removing a designation, and a hotkey that silently un-lands a scene is
  // exactly the accident the tracker already flagged for "remove hovered plate".
  game.keybindings.register(MODULE_ID, "toggleLanding", {
    name: "BIVOUAC.Keybindings.ToggleLanding",
    hint: "BIVOUAC.Keybindings.ToggleLandingHint",
    editable: [],
    restricted: true, // a GM-level scene change
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    onDown: () => {
      if (!canvas?.scene) return false; // nothing to toggle — let the key through
      void toggleLandingScene();
      return true;
    },
  });

  // Ctrl+Z / Ctrl+Y undo & redo of the landing layout. Foundry's own undo only
  // covers canvas placeables, not our scene-flag layout, so we run our own
  // history. Both consume the key (and pre-empt core undo) ONLY while editing
  // the landing board; otherwise they return false so core undo still works.
  game.keybindings.register(MODULE_ID, "undo", {
    name: "BIVOUAC.Keybindings.Undo",
    editable: [{ key: "KeyZ", modifiers: ["Control"] }],
    restricted: true,
    precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
    onDown: () => {
      if (!worldLayer.editMode || !activeLandingScene()) return false;
      void undoLayout();
      return true;
    },
  });
  game.keybindings.register(MODULE_ID, "redo", {
    name: "BIVOUAC.Keybindings.Redo",
    editable: [{ key: "KeyY", modifiers: ["Control"] }],
    restricted: true,
    precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
    onDown: () => {
      if (!worldLayer.editMode || !activeLandingScene()) return false;
      void redoLayout();
      return true;
    },
  });
});

// Add the Bivouac control group to the scene-controls toolbar (GM only).
Hooks.on("getSceneControlButtons", (controls: Record<string, unknown>) => {
  if (!game.user?.isGM) return;

  const onLanding = !!canvas?.scene && isLandingScene(canvas.scene);

  controls[MODULE_ID] = {
    name: MODULE_ID,
    title: "BIVOUAC.Controls.Title",
    icon: "fa-solid fa-campground",
    order: 90,
    // Being in the Bivouac control group *is* edit mode: activating the group
    // turns editing on, switching to any other control group turns it off. The
    // Cast Bar also keys its drop-zone off this, so refresh it too.
    onChange: (_event: Event, active: boolean) => {
      worldLayer.setEditMode(active);
      castBars.forEach((b) => b.refresh()); // both bars key their drop-zone off edit mode
    },
    activeTool: "arrange",
    tools: {
      // Plain default tool — required as the group's activeTool (buttons/toggles
      // can't be active). It carries no behaviour of its own; the group's
      // onChange drives edit mode. It reads as the "select / move" cursor.
      arrange: {
        name: "arrange",
        order: 1,
        title: "BIVOUAC.Controls.Arrange",
        icon: "fa-solid fa-arrow-pointer",
        onChange: () => {},
      },
      landing: {
        name: "landing",
        order: 2,
        title: onLanding ? "BIVOUAC.Controls.UnsetLanding" : "BIVOUAC.Controls.SetLanding",
        icon: "fa-solid fa-map-location-dot",
        button: true,
        onChange: () => void toggleLandingScene(),
      },
      add: {
        name: "add",
        order: 3,
        title: "BIVOUAC.Controls.AddWidget",
        icon: "fa-solid fa-plus",
        button: true,
        onChange: () => void addWidget(),
      },
      fit: {
        name: "fit",
        order: 4,
        title: "BIVOUAC.Controls.Fit",
        icon: "fa-solid fa-expand",
        button: true,
        onChange: () => worldLayer.fitToTiles(),
      },
      // The DM screen lives on its own right-side tab (see dmScreen.mountControl),
      // not in this group — opening it shouldn't force edit mode.
    },
  };
});

// Mount / refresh the world layer whenever the canvas (re)loads a scene.
Hooks.on("canvasReady", () => {
  // Undo history is per active-scene layout; a scene switch means a different
  // layout context, so drop it (prevents undoing one landing scene onto another).
  clearLayoutHistory();
  worldLayer.refresh();
  // The Cast Bars' rosters are per-scene — reflect the newly-loaded scene's cast.
  castBars.forEach((b) => b.refresh());
  // Reconcile this scene's parked plate tokens. On scene LOAD this is the pass
  // that matters most: plates may have been added, actors deleted or tokens
  // placed by hand while the scene sat inactive, and nothing was watching.
  void syncPlateTokens();
});

// Keep the world layer glued to the map as the user pans / zooms.
Hooks.on("canvasPan", () => worldLayer.syncTransform());

// Drop a document (Actor / Journal / Table / Macro …) onto the board while
// editing a landing scene → create a tile at the drop point. In view mode this
// returns nothing, so Foundry's normal drop (e.g. token creation) is untouched.
Hooks.on("dropCanvasData", (_canvas: unknown, data: { x?: number; y?: number } & Record<string, unknown>) =>
  worldLayer.handleCanvasDrop(data),
);

// React to layout changes (from this GM or, for players, broadcast writes).
Hooks.on("updateScene", (scene: { id: string }, changes: object) => {
  if (isLandingScene(scene) && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAGS.layout}`)) {
    worldLayer.render("updateScene");
  }
  // Hidden/shown is scene state, so this fires on EVERY client — which is what
  // makes one GM keypress take the board off (or put it back on) the whole
  // table's screens. `refresh()`, not `render()`: the overlay is unmounted while
  // hidden, and `render()` returns early with nothing to draw into.
  if (
    scene.id === canvas?.scene?.id &&
    foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAGS.boardHidden}`)
  ) {
    worldLayer.refresh();
  }
  // Cast Bar state is per-scene and works on any scene — refresh when the current
  // scene's cast-bar flags change (broadcast to players too).
  if (
    scene.id === canvas?.scene?.id &&
    (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAGS.castBar}`) ||
      foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAGS.castBar2}`))
  ) {
    castBars.forEach((b) => b.refresh());
    // The roster just changed — a plate was added, removed or re-pointed, so the
    // set of actors needing a parked token has moved with it.
    void syncPlateTokens();
  }
});

// A token appearing or disappearing changes whether a plate still needs ours: a
// real token the GM places SUPERSEDES the parked one (so it is withdrawn), and
// deleting that real token leaves the plate uncovered again (so one is parked).
// The pass is idempotent, which is what makes it safe to hang off hooks its own
// writes will fire.
for (const hook of ["createToken", "deleteToken"]) {
  Hooks.on(hook, (doc: { parent?: { id?: string } }) => {
    if (doc?.parent?.id === canvas?.scene?.id) void syncPlateTokens();
  });
}

// Keep document-backed tiles (Actor / Journal / Table / Macro …) live: when a
// referenced document changes or is removed, re-render just the tiles that point
// at it, on both surfaces (a page also refreshes its parent journal's tiles).
type RefreshTarget = {
  uuid?: string;
  id?: string;
  isToken?: boolean;
  parent?: { uuid?: string };
};

function refreshDocTiles(doc: RefreshTarget | undefined): void {
  if (doc?.uuid) {
    worldLayer.refreshDocTiles(doc.uuid);
    dmScreen.refreshDocTiles(doc.uuid);
    castBars.forEach((b) => b.refreshActor(doc.uuid as string));
  }
  if (doc?.parent?.uuid) {
    worldLayer.refreshDocTiles(doc.parent.uuid);
    dmScreen.refreshDocTiles(doc.parent.uuid);
    castBars.forEach((b) => b.refreshActor(doc.parent!.uuid as string));
  }
  // A TOKEN's actor is a different document from the sidebar one: its uuid is
  // `Scene.x.Token.y.Actor.z`, which never matches the plain `Actor.<id>` a plate
  // or tile stores, so neither branch above would touch them and the display
  // would sit stale. That matters for anything read off the live actor — damage
  // taken by an unlinked NPC, and the conditions applied to it. A synthetic actor
  // keeps its SOURCE actor's id, so that is what to re-broadcast under.
  if (doc?.isToken && doc.id) refreshDocTiles({ uuid: `Actor.${doc.id}` });
}
for (const kind of ["Actor", "Item", "JournalEntry", "JournalEntryPage", "RollableTable", "Macro"]) {
  Hooks.on(`update${kind}`, (doc: RefreshTarget) => refreshDocTiles(doc));
  Hooks.on(`delete${kind}`, (doc: RefreshTarget) => refreshDocTiles(doc));
}

// Conditions change through ActiveEffects, which are NOT covered by the loop
// above — an effect is created/deleted on the actor rather than the actor itself
// being updated, so without these the plate's condition icons would go stale at
// exactly the moment they matter (someone gets stunned mid-combat). `create` is
// needed as well as update/delete: applying a condition is a create.
//
// The effect's `parent` is the Actor, so this routes through the same
// `refreshDocTiles` path as everything else — including its token handling — and
// picks up the Mini Sheet too.
for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
  Hooks.on(hook, (effect: { parent?: RefreshTarget }) => refreshDocTiles(effect?.parent));
}

// The cast bar can hide while a combat runs (per the setting) — re-evaluate the
// bars whenever combat state changes (start / end / round / turn).
//
// The COMBATANT hooks matter for a different reason: each plate's combat control
// is lit while its character is in the encounter, and that changes when a
// combatant is added or removed from anywhere at all — this button, the tracker,
// the token HUD, another GM. Without these the plate would keep claiming the
// state it had when it was last drawn.
for (const hook of [
  "combatStart",
  "createCombat",
  "deleteCombat",
  "updateCombat",
  "createCombatant",
  "deleteCombatant",
  "updateCombatant",
]) {
  Hooks.on(hook, () => castBars.forEach((b) => b.refresh()));
}

// Raised-hand tie-in: a flag-based raised-hand module changes a user flag when a
// player raises/lowers their hand → update just the hand overlays (no flash).
Hooks.on("updateUser", () => castBars.forEach((b) => b.refreshHands()));

// React to a change in the set of landing scenes (cross-client).
function onSettingChange(setting: { key?: string }): void {
  if (setting?.key === `${MODULE_ID}.${SETTINGS.landingSceneIds}`) {
    clearLayoutHistory(); // designation changed — history context may no longer apply
    worldLayer.refresh();
    ui.controls?.render();
  }
}
Hooks.on("updateSetting", onSettingChange);
Hooks.on("createSetting", onSettingChange);

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { worldLayer, dmScreen, castBar, castBar2 };
  if (game.user?.isGM) {
    dmScreen.mountControl();
    void migrateLandingScenes();
  }
  // The Cast Bars are player-facing — mount for everyone (the toggle tab and
  // controls are gated to controllers inside `mount`).
  castBars.forEach((b) => b.mount());
  wireRaiseHand();
  applyTabSettings();
  applyCastFont();
  applyTextStroke();
  log("Ready");
});

/** Wire the "Raise My Hand" (raise-my-hand / -plus) integration so a plate's hand
 *  badge tracks live. It fires no hooks, so we hook several signals:
 *   • incoming socket — OTHER users' raises/lowers reach us here;
 *   • outgoing socket — the LOCAL user's own raise/lower (socketlib emits only to
 *     others, so our own never echoes back) — we read the outgoing message, which
 *     carries our user id, so the raiser sees their OWN hand;
 *   • the players-list ✋ marker + the old module's `game.handRaiser` — extra
 *     coverage for state we joined into. */
function wireRaiseHand(): void {
  // Only the hand overlays are updated (not a full re-render), so raise/lower
  // never flashes the bar or restarts the wave animation.
  const bump = (): void => void window.setTimeout(() => castBars.forEach((b) => b.refreshHands()), 0);
  try {
    game.socket?.on?.("module.raise-my-hand", (msg: unknown) => {
      onRaiseHandMessage(msg);
      bump();
    });
  } catch {
    /* socket unavailable */
  }
  // Wrap the outgoing emit so the LOCAL user's own raise/lower is seen too
  // (thin passthrough — only inspects the one channel; guarded so it never
  // breaks other socket traffic).
  try {
    const sock = game.socket as { emit?: (...a: unknown[]) => unknown; _bivouacEmit?: boolean };
    if (sock?.emit && !sock._bivouacEmit) {
      sock._bivouacEmit = true;
      const orig = sock.emit.bind(sock);
      sock.emit = (channel: unknown, ...rest: unknown[]): unknown => {
        if (channel === "module.raise-my-hand") {
          try {
            onRaiseHandMessage(rest[0]);
            bump();
          } catch {
            /* ignore */
          }
        }
        return orig(channel, ...rest);
      };
    }
  } catch {
    /* can't wrap emit */
  }
  const players = document.getElementById("players");
  if (players && "MutationObserver" in window) {
    new MutationObserver(bump).observe(players, { childList: true, subtree: true });
  }
  const patch = (): void => {
    const hr = (game as { handRaiser?: Record<string, unknown> & { _bivouacPatched?: boolean } }).handRaiser;
    if (!hr || hr._bivouacPatched) return;
    hr._bivouacPatched = true;
    for (const name of ["raise", "lower", "toggle"]) {
      const fn = hr[name];
      if (typeof fn === "function") {
        hr[name] = function (this: unknown, ...args: unknown[]): unknown {
          const r = (fn as (...a: unknown[]) => unknown).apply(this, args);
          bump();
          return r;
        };
      }
    }
  };
  patch();
  window.setTimeout(patch, 3000); // in case raise-my-hand initialised after us
}

/** One-time migration: fold the legacy single `landingSceneId` into the
 *  `landingSceneIds` set, then clear the legacy value so removing all landing
 *  scenes can't be undone by the fallback. GM only (world-scope writes). */
async function migrateLandingScenes(): Promise<void> {
  const legacy = getLandingSceneId();
  if (legacy && getLandingSceneIds().length === 0) {
    await setLandingScenes([legacy]);
    await setLandingSceneId("");
  }
}

/** Apply the Cast Bar font — a custom Google Font name (lazy-loaded from the CDN)
 *  overrides the dropdown pick; empty = the theme default. Sets a CSS var both
 *  bars inherit. Per client. */
function applyCastFont(): void {
  const custom = String(game.settings.get(MODULE_ID, SETTINGS.castBarFontCustom) ?? "").trim();
  const picked = String(game.settings.get(MODULE_ID, SETTINGS.castBarFont) ?? "").trim();
  const family = custom || picked;
  const root = document.documentElement.style;
  if (family) {
    if (custom) ensureGoogleFont(custom);
    root.setProperty("--bivouac-castbar-font", `"${family}", var(--font-primary, "Signika", sans-serif)`);
  } else {
    root.removeProperty("--bivouac-castbar-font");
  }
  const size = Number(game.settings.get(MODULE_ID, SETTINGS.castBarFontSize) ?? 1);
  root.setProperty("--bivouac-castbar-font-scale", `${Number.isFinite(size) ? size : 1}`);
}

/** Push the text-stroke setting into `--bivouac-text-stroke` (a width; `0` when
 *  off, which makes every `-webkit-text-stroke` that reads it a no-op). Tiles can
 *  override the var on themselves — see `applyTextStroke` in `widgets.ts`. */
function applyTextStroke(): void {
  const on = game.settings.get(MODULE_ID, SETTINGS.textStroke) !== false;
  const w = Number(game.settings.get(MODULE_ID, SETTINGS.textStrokeWidth) ?? TEXT_STROKE.default);
  setTextStrokeVars(document.documentElement, on, Number.isFinite(w) ? w : TEXT_STROKE.default, textOutlineMode());
}

/** Push the DM-tab settings into their CSS vars and reposition the tab. */
function applyTabSettings(): void {
  const root = document.documentElement.style;
  const pad = Number(game.settings.get(MODULE_ID, SETTINGS.dmTabPad) ?? 16);
  const top = Number(game.settings.get(MODULE_ID, SETTINGS.dmTabTop) ?? 50);
  root.setProperty("--bivouac-dmtab-pad", `${pad}px`);
  root.setProperty("--bivouac-dmtab-top", `${top}%`);
  dmScreen.refreshTab();
}

/** The control Foundry rendered for one of our settings, in the Settings form. */
function settingInput(root: HTMLElement, key: string): HTMLElement | null {
  return root.querySelector(`[name="${MODULE_ID}.${key}"]`);
}

/** Read a setting control's value **as it is right now, mid-drag**.
 *
 *  A setting with `range: {min, max, step}` is rendered as Foundry's
 *  `<range-picker>`, whose own `.value` is only updated on `change` — i.e. when
 *  the drag ENDS — and whose internal change handler calls `stopPropagation()`,
 *  so that update never reaches a listener on the form. Reading the host would
 *  therefore return the pre-drag value on every frame and the preview would sit
 *  still until release. The picker is light DOM and keeps its inner number input
 *  in step on every drag frame (and it's what the user types into), so read that
 *  instead; plain inputs have no inner control and fall through to themselves. */
function liveValue(root: HTMLElement, key: string): number {
  const host = settingInput(root, key);
  if (!host) return NaN;
  const inner = host.querySelector<HTMLInputElement>('input[type="number"], input[type="range"]');
  const raw = (inner ?? (host as HTMLInputElement)).value;
  return raw == null || raw === "" ? NaN : Number(raw);
}

/** Live-preview the settings that are only judgeable by eye — the DM/Cast Bar
 *  tab placement and the text-stroke width — as the user drags their sliders in
 *  the Settings window. A setting's `onChange` only fires on Save, so we read the
 *  form's *current* values and apply them (without persisting). */
function previewSettings(root: HTMLElement): void {
  const style = document.documentElement.style;
  const pad = liveValue(root, SETTINGS.dmTabPad);
  const top = liveValue(root, SETTINGS.dmTabTop);
  if (Number.isFinite(pad)) style.setProperty("--bivouac-dmtab-pad", `${pad}px`);
  if (Number.isFinite(top)) style.setProperty("--bivouac-dmtab-top", `${top}%`);
  dmScreen.refreshTab();

  // …and the Cast Bar tab (shared pos/pad settings) — preview both bars' tabs.
  const pos = liveValue(root, SETTINGS.castBarTabPos);
  const padPx = liveValue(root, SETTINGS.castBarTabPad);
  if (Number.isFinite(pos) || Number.isFinite(padPx)) castBars.forEach((b) => b.previewTab(pos, padPx));

  // …and the text stroke, so its width can be judged against real plates and
  // tiles (the whole point of the slider) instead of by save-and-look.
  const sOn = settingInput(root, SETTINGS.textStroke) as HTMLInputElement | null;
  const w = liveValue(root, SETTINGS.textStrokeWidth);
  // The mode previews too — switching stroke↔blur is the change you most want to
  // see against real art before committing, and reading it from the form (rather
  // than the saved setting) is what makes the width slider preview in the right
  // shape as you drag it.
  const sMode = settingInput(root, SETTINGS.textOutlineMode) as HTMLSelectElement | null;
  if (sOn || sMode || Number.isFinite(w)) {
    const on = sOn ? sOn.checked !== false : true;
    const mode = sMode?.value === "blur" ? "blur" : sMode ? "stroke" : textOutlineMode();
    setTextStrokeVars(document.documentElement, on, Number.isFinite(w) ? w : TEXT_STROKE.default, mode);
  }
}

// Group our settings into labelled sections (see `settings-ui.ts`), and while
// the window is open preview our tab settings live on any input; on close,
// re-apply the SAVED values so Cancel reverts the preview (and Save confirms it
// — its onChange fires applyTabSettings too).
Hooks.on("renderSettingsConfig", (_app: unknown, html: unknown) => {
  const root = html instanceof HTMLElement ? html : (html as { [0]?: HTMLElement } | null)?.[0];
  if (!root) return;
  decorateSettingsForm(root);
  root.addEventListener("input", () => previewSettings(root));
});
Hooks.on("closeSettingsConfig", () => {
  teardownSettingsForm();
  applyTabSettings();
  applyTextStroke(); // revert the stroke preview to saved
  castBars.forEach((b) => b.applyTabPos()); // revert cast-bar tab preview to saved
});

/* -------------------------------------------- toolbar actions ----------- */

async function toggleLandingScene(): Promise<void> {
  const scene = canvas?.scene;
  if (!scene) return;
  const ids = getLandingSceneIds();
  const clearing = ids.includes(scene.id); // toggling THIS scene off (others untouched)

  // Removing a scene's landing status hides its board, so guard it behind a
  // confirm. Adding one is harmless and stays immediate.
  if (clearing) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("BIVOUAC.Confirm.ClearLandingTitle") },
      classes: ["bivouac-dialog"],
      content: `<p>${game.i18n.localize("BIVOUAC.Confirm.ClearLandingBody")}</p>`,
      modal: true,
    });
    if (!ok) return;
  }

  await setLandingScenes(clearing ? ids.filter((id) => id !== scene.id) : [...ids, scene.id]);
  // Designating a scene always SHOWS its board. Hidden is scene state that
  // outlives the designation, so without this a scene hidden before it was
  // un-designated would come back invisible — the GM sets a landing page, no
  // tiles appear, and nothing on screen says why.
  if (!clearing) await writeBoardHidden(scene, false);
  ui.notifications?.info(
    game.i18n.localize(clearing ? "BIVOUAC.Notify.LandingCleared" : "BIVOUAC.Notify.LandingSet"),
  );
}

async function addWidget(): Promise<void> {
  if (!canvas?.scene || !isLandingScene(canvas.scene)) {
    ui.notifications?.warn(game.i18n.localize("BIVOUAC.Notify.NotLanding"));
    return;
  }
  if (!worldLayer.editMode) worldLayer.setEditMode(true);
  const type = await pickWidgetType();
  if (type) await worldLayer.addWidget(type);
}
