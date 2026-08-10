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

import { FLAGS, GRID, MODULE_ID, SETTINGS, log } from "./constants";
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
} from "./layout";
import { worldLayer } from "./world-layer";
import { dmScreen } from "./dm-screen";
import { castBar, castBar2, castBars, onRaiseHandMessage } from "./cast-bar";
import { availableFonts, ensureGoogleFont } from "./widgets";
import { pickWidgetType } from "./widget-config";
import { decorateSettingsForm, teardownSettingsForm } from "./settings-ui";

Hooks.once("init", () => {
  log("Initializing");

  /* ============================================================ settings ===
   * Registration order IS the order of the rows in Foundry's Settings window,
   * so the visible settings below are grouped and ordered exactly as they are
   * presented — see `SETTING_GROUPS` in `settings-ui.ts`, which draws the
   * section headings around these same rows. Add a new visible setting to both.
   * Hidden (`config: false`) state settings live in their own block further down.
   */

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

  // Which stats a plate may overlay (AC / passive perception / current HP /
  // passive investigation). GM/world toggles, all on by default; each plate still
  // starts with its stats hidden (toggle per-plate from the bar's hover controls).
  for (const [key, label] of [
    [SETTINGS.castStatAC, "AC"],
    [SETTINGS.castStatPP, "PP"],
    [SETTINGS.castStatHP, "HP"],
    [SETTINGS.castStatInv, "Inv"],
  ] as const) {
    game.settings.register(MODULE_ID, key, {
      name: `BIVOUAC.Settings.CastStat${label}.Name`,
      hint: `BIVOUAC.Settings.CastStat${label}.Hint`,
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
  // Cast Bar state is per-scene and works on any scene — refresh when the current
  // scene's cast-bar flags change (broadcast to players too).
  if (
    scene.id === canvas?.scene?.id &&
    (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAGS.castBar}`) ||
      foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAGS.castBar2}`))
  ) {
    castBars.forEach((b) => b.refresh());
  }
});

// Keep document-backed tiles (Actor / Journal / Table / Macro …) live: when a
// referenced document changes or is removed, re-render just the tiles that point
// at it, on both surfaces (a page also refreshes its parent journal's tiles).
function refreshDocTiles(doc: { uuid?: string; parent?: { uuid?: string } } | undefined): void {
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
}
for (const kind of ["Actor", "Item", "JournalEntry", "JournalEntryPage", "RollableTable", "Macro"]) {
  Hooks.on(`update${kind}`, (doc: { uuid?: string; parent?: { uuid?: string } }) => refreshDocTiles(doc));
  Hooks.on(`delete${kind}`, (doc: { uuid?: string; parent?: { uuid?: string } }) => refreshDocTiles(doc));
}

// The cast bar can hide while a combat runs (per the setting) — re-evaluate the
// bars whenever combat state changes (start / end / round / turn).
for (const hook of ["combatStart", "createCombat", "deleteCombat", "updateCombat"]) {
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

/** Push the DM-tab settings into their CSS vars and reposition the tab. */
function applyTabSettings(): void {
  const root = document.documentElement.style;
  const pad = Number(game.settings.get(MODULE_ID, SETTINGS.dmTabPad) ?? 16);
  const top = Number(game.settings.get(MODULE_ID, SETTINGS.dmTabTop) ?? 50);
  root.setProperty("--bivouac-dmtab-pad", `${pad}px`);
  root.setProperty("--bivouac-dmtab-top", `${top}%`);
  dmScreen.refreshTab();
}

/** Live-preview the DM-tab settings as the user drags the sliders in the
 *  Settings window — a setting's `onChange` only fires on Save, so we read the
 *  form's *current* values and apply them (without persisting). */
function previewTabSettings(root: HTMLElement): void {
  const style = document.documentElement.style;
  const pad = root.querySelector(`[name="${MODULE_ID}.${SETTINGS.dmTabPad}"]`) as { value?: string } | null;
  const top = root.querySelector(`[name="${MODULE_ID}.${SETTINGS.dmTabTop}"]`) as { value?: string } | null;
  if (pad?.value != null && pad.value !== "") style.setProperty("--bivouac-dmtab-pad", `${Number(pad.value)}px`);
  if (top?.value != null && top.value !== "") style.setProperty("--bivouac-dmtab-top", `${Number(top.value)}%`);
  dmScreen.refreshTab();

  // …and the Cast Bar tab (shared pos/pad settings) — preview both bars' tabs.
  const cPos = root.querySelector(`[name="${MODULE_ID}.${SETTINGS.castBarTabPos}"]`) as { value?: string } | null;
  const cPad = root.querySelector(`[name="${MODULE_ID}.${SETTINGS.castBarTabPad}"]`) as { value?: string } | null;
  const pos = cPos?.value != null && cPos.value !== "" ? Number(cPos.value) : NaN;
  const padPx = cPad?.value != null && cPad.value !== "" ? Number(cPad.value) : NaN;
  if (Number.isFinite(pos) || Number.isFinite(padPx)) castBars.forEach((b) => b.previewTab(pos, padPx));
}

// Group our settings into labelled sections (see `settings-ui.ts`), and while
// the window is open preview our tab settings live on any input; on close,
// re-apply the SAVED values so Cancel reverts the preview (and Save confirms it
// — its onChange fires applyTabSettings too).
Hooks.on("renderSettingsConfig", (_app: unknown, html: unknown) => {
  const root = html instanceof HTMLElement ? html : (html as { [0]?: HTMLElement } | null)?.[0];
  if (!root) return;
  decorateSettingsForm(root);
  root.addEventListener("input", () => previewTabSettings(root));
});
Hooks.on("closeSettingsConfig", () => {
  teardownSettingsForm();
  applyTabSettings();
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
      content: `<p>${game.i18n.localize("BIVOUAC.Confirm.ClearLandingBody")}</p>`,
      modal: true,
    });
    if (!ok) return;
  }

  await setLandingScenes(clearing ? ids.filter((id) => id !== scene.id) : [...ids, scene.id]);
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
