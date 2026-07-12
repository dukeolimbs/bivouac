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

import { GRID, LOD, MODULE_ID, SETTINGS, log } from "./constants";
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
import { pickWidgetType } from "./widget-config";

Hooks.once("init", () => {
  log("Initializing");

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
    default: 16,
    onChange: () => applyTabSettings(),
  });

  // Vertical position of the DM-screen tab, as a percentage of viewport height.
  game.settings.register(MODULE_ID, SETTINGS.dmTabTop, {
    name: "BIVOUAC.Settings.DmTabTop.Name",
    hint: "BIVOUAC.Settings.DmTabTop.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 100, step: 0.1 },
    default: 50,
    onChange: () => applyTabSettings(),
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
    default: LOD.minWebviews,
    onChange: () => worldLayer.render("lod"),
  });

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
    default: "beside",
    onChange: () => dmScreen.applyDock(),
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
    // turns editing on, switching to any other control group turns it off.
    onChange: (_event: Event, active: boolean) => worldLayer.setEditMode(active),
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
  if (!isLandingScene(scene)) return;
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) worldLayer.render("updateScene");
});

// Keep document-backed tiles (Actor / Journal / Table / Macro …) live: when a
// referenced document changes or is removed, re-render just the tiles that point
// at it, on both surfaces (a page also refreshes its parent journal's tiles).
function refreshDocTiles(doc: { uuid?: string; parent?: { uuid?: string } } | undefined): void {
  if (doc?.uuid) {
    worldLayer.refreshDocTiles(doc.uuid);
    dmScreen.refreshDocTiles(doc.uuid);
  }
  if (doc?.parent?.uuid) {
    worldLayer.refreshDocTiles(doc.parent.uuid);
    dmScreen.refreshDocTiles(doc.parent.uuid);
  }
}
for (const kind of ["Actor", "Item", "JournalEntry", "JournalEntryPage", "RollableTable", "Macro"]) {
  Hooks.on(`update${kind}`, (doc: { uuid?: string; parent?: { uuid?: string } }) => refreshDocTiles(doc));
  Hooks.on(`delete${kind}`, (doc: { uuid?: string; parent?: { uuid?: string } }) => refreshDocTiles(doc));
}

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
  if (mod) mod.api = { worldLayer, dmScreen };
  if (game.user?.isGM) {
    dmScreen.mountControl();
    void migrateLandingScenes();
  }
  applyTabSettings();
  log("Ready");
});

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
}

// While the Settings window is open, preview our tab settings live on any input;
// on close, re-apply the SAVED values so Cancel reverts the preview (and Save
// confirms it — its onChange fires applyTabSettings too).
Hooks.on("renderSettingsConfig", (_app: unknown, html: unknown) => {
  const root = html instanceof HTMLElement ? html : (html as { [0]?: HTMLElement } | null)?.[0];
  if (root) root.addEventListener("input", () => previewTabSettings(root));
});
Hooks.on("closeSettingsConfig", () => applyTabSettings());

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
