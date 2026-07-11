/** Bivouac — persistence for landing layouts (scene flags) and DM screens (user flags). */

import { MODULE_ID, FLAGS, SETTINGS, EMPTY_LAYOUT, type Layout } from "./constants";

/* -------------------------------------------- Landing scene ------------- */

/** The Scene id designated as the campaign landing page, or "" if unset. */
export function getLandingSceneId(): string {
  return (game.settings.get(MODULE_ID, SETTINGS.landingSceneId) as string) ?? "";
}

/** Designate (or clear) the landing scene. GM only. */
export async function setLandingSceneId(sceneId: string): Promise<void> {
  await game.settings.set(MODULE_ID, SETTINGS.landingSceneId, sceneId);
}

export function isLandingScene(scene: unknown): boolean {
  const s = scene as { id?: string } | null | undefined;
  return !!s?.id && s.id === getLandingSceneId();
}

/** The currently-viewed scene if — and only if — it is the landing scene. */
export function activeLandingScene(): { id: string } | null {
  const scene = canvas?.scene ?? null;
  return scene && isLandingScene(scene) ? scene : null;
}

/* -------------------------------------------- Landing layout ------------ */

function normalize(raw: unknown): Layout {
  const layout = raw as Partial<Layout> | undefined;
  return { widgets: Array.isArray(layout?.widgets) ? layout!.widgets : [] };
}

export function readLayout(scene: unknown): Layout {
  const s = scene as { getFlag?: (m: string, k: string) => unknown } | null;
  if (!s?.getFlag) return { ...EMPTY_LAYOUT, widgets: [] };
  return normalize(s.getFlag(MODULE_ID, FLAGS.layout));
}

/** Persist a landing layout to the scene. GM only (enforced by Foundry permissions). */
export async function writeLayout(scene: unknown, layout: Layout): Promise<void> {
  const s = scene as { setFlag?: (m: string, k: string, v: unknown) => Promise<unknown> } | null;
  await s?.setFlag?.(MODULE_ID, FLAGS.layout, layout);
}

/* -------------------------------------------- DM screen layout ---------- */

export function readDMLayout(): Layout {
  return normalize(game.user?.getFlag(MODULE_ID, FLAGS.dmScreenLayout));
}

export async function writeDMLayout(layout: Layout): Promise<void> {
  await game.user?.setFlag(MODULE_ID, FLAGS.dmScreenLayout, layout);
}
