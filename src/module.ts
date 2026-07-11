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

import { MODULE_ID, SETTINGS, log } from "./constants";
import { getLandingSceneId, isLandingScene, setLandingSceneId } from "./layout";
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
      // The DM screen lives on its own right-side tab (see dmScreen.mountControl),
      // not in this group — opening it shouldn't force edit mode.
    },
  };
});

// Mount / refresh the world layer whenever the canvas (re)loads a scene.
Hooks.on("canvasReady", () => worldLayer.refresh());

// Keep the world layer glued to the map as the user pans / zooms.
Hooks.on("canvasPan", () => worldLayer.syncTransform());

// React to layout changes (from this GM or, for players, broadcast writes).
Hooks.on("updateScene", (scene: { id: string }, changes: object) => {
  if (!isLandingScene(scene)) return;
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) worldLayer.render("updateScene");
});

// React to a change of which scene is the landing scene (cross-client).
function onSettingChange(setting: { key?: string }): void {
  if (setting?.key === `${MODULE_ID}.${SETTINGS.landingSceneId}`) {
    worldLayer.refresh();
    ui.controls?.render();
  }
}
Hooks.on("updateSetting", onSettingChange);
Hooks.on("createSetting", onSettingChange);

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { worldLayer, dmScreen };
  if (game.user?.isGM) dmScreen.mountControl();
  log("Ready");
});

/* -------------------------------------------- toolbar actions ----------- */

async function toggleLandingScene(): Promise<void> {
  const scene = canvas?.scene;
  if (!scene) return;
  const clearing = getLandingSceneId() === scene.id;

  // Clearing hides the whole board in one click, so guard it behind a confirm.
  // Setting a landing scene is harmless and stays immediate.
  if (clearing) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("BIVOUAC.Confirm.ClearLandingTitle") },
      content: `<p>${game.i18n.localize("BIVOUAC.Confirm.ClearLandingBody")}</p>`,
      modal: true,
    });
    if (!ok) return;
  }

  const next = clearing ? "" : scene.id;
  await setLandingSceneId(next);
  ui.notifications?.info(
    game.i18n.localize(next ? "BIVOUAC.Notify.LandingSet" : "BIVOUAC.Notify.LandingCleared"),
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
