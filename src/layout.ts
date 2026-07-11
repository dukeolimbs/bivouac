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
  const widgets = Array.isArray(layout?.widgets) ? layout!.widgets : [];
  // Deep-clone so callers mutate a PRIVATE copy, never the live flag object.
  // Mutating the flag in place both corrupts undo snapshots (writeLayout would
  // snapshot the already-changed state) and can make setFlag a no-op (Foundry
  // diffs the update against flags we've already mutated to match).
  return foundry.utils.deepClone({ widgets }) as Layout;
}

export function readLayout(scene: unknown): Layout {
  const s = scene as { getFlag?: (m: string, k: string) => unknown } | null;
  if (!s?.getFlag) return { ...EMPTY_LAYOUT, widgets: [] };
  return normalize(s.getFlag(MODULE_ID, FLAGS.layout));
}

/* -------------------------------------------- Undo / redo --------------- */
// In-memory, per-session history of the landing layout. Every writeLayout
// snapshots the pre-write state (deep-cloned) onto the undo stack, so undo/redo
// can restore it. Guarded by `applyingHistory` so re-applying a snapshot
// doesn't record itself.

const HISTORY_MAX = 50;
const undoStack: Layout[] = [];
const redoStack: Layout[] = [];
let applyingHistory = false;

function snapshot(scene: unknown): Layout {
  return readLayout(scene); // readLayout already returns a deep copy
}

/** Drop all recorded history — e.g. when the landing scene designation changes. */
export function clearLayoutHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
}

/** Restore the layout as it was before the last change. Returns false if there
 *  is nothing to undo (or no active landing scene). */
export async function undoLayout(): Promise<boolean> {
  if (applyingHistory) return false;
  const scene = activeLandingScene();
  if (!scene || undoStack.length === 0) return false;
  redoStack.push(snapshot(scene));
  const prev = undoStack.pop() as Layout;
  applyingHistory = true;
  try {
    await writeLayout(scene, prev);
  } finally {
    applyingHistory = false;
  }
  return true;
}

/** Re-apply a layout that undoLayout reverted. */
export async function redoLayout(): Promise<boolean> {
  if (applyingHistory) return false;
  const scene = activeLandingScene();
  if (!scene || redoStack.length === 0) return false;
  undoStack.push(snapshot(scene));
  const next = redoStack.pop() as Layout;
  applyingHistory = true;
  try {
    await writeLayout(scene, next);
  } finally {
    applyingHistory = false;
  }
  return true;
}

/** Persist a landing layout to the scene. GM only (enforced by Foundry permissions). */
export async function writeLayout(scene: unknown, layout: Layout): Promise<void> {
  const s = scene as { setFlag?: (m: string, k: string, v: unknown) => Promise<unknown> } | null;
  if (!applyingHistory) {
    undoStack.push(snapshot(scene)); // pre-write state
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack.length = 0; // a fresh edit invalidates the redo trail
  }
  await s?.setFlag?.(MODULE_ID, FLAGS.layout, layout);
}

/* -------------------------------------------- DM screen layout ---------- */

export function readDMLayout(): Layout {
  return normalize(game.user?.getFlag(MODULE_ID, FLAGS.dmScreenLayout));
}

export async function writeDMLayout(layout: Layout): Promise<void> {
  await game.user?.setFlag(MODULE_ID, FLAGS.dmScreenLayout, layout);
}
