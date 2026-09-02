/** Bivouac — persistence for landing layouts (scene flags) and DM screens (user flags). */

import { MODULE_ID, FLAGS, SETTINGS, EMPTY_LAYOUT, EMPTY_CASTBAR, type CastBarData, type Layout } from "./constants";

/* -------------------------------------------- Landing scene ------------- */

/** Legacy single-id accessors — kept only for the one-time migration into the
 *  `landingSceneIds` set (see module.ts). */
export function getLandingSceneId(): string {
  return (game.settings.get(MODULE_ID, SETTINGS.landingSceneId) as string) ?? "";
}
export async function setLandingSceneId(sceneId: string): Promise<void> {
  await game.settings.set(MODULE_ID, SETTINGS.landingSceneId, sceneId);
}

/** All Scene ids currently designated as landing pages. */
export function getLandingSceneIds(): string[] {
  const raw = game.settings.get(MODULE_ID, SETTINGS.landingSceneIds);
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

/** Replace the set of landing scenes (deduped). GM only. */
export async function setLandingScenes(ids: string[]): Promise<void> {
  await game.settings.set(MODULE_ID, SETTINGS.landingSceneIds, [...new Set(ids)]);
}

export function isLandingScene(scene: unknown): boolean {
  const s = scene as { id?: string } | null | undefined;
  return !!s?.id && getLandingSceneIds().includes(s.id);
}

/** The currently-viewed scene if — and only if — it is a landing scene. */
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

/* -------------------------------------------- Board visibility ---------- */
// Hidden is a SCENE flag, not a client setting, because hiding the board is a
// thing the table sees — the same decision (and the same storage) as the Cast
// Bar's own `visible`. It sits beside the layout rather than inside it on
// purpose: the layout carries undo/redo history, and hiding the board is not an
// edit to it.

/** Is the board hidden on this scene? False for a scene that has never been
 *  told either way, which is what makes the flag's absence mean "shown". */
export function readBoardHidden(scene: unknown): boolean {
  const s = scene as { getFlag?: (m: string, k: string) => unknown } | null;
  return s?.getFlag?.(MODULE_ID, FLAGS.boardHidden) === true;
}

/** Hide/show the board on this scene, for everyone. GM only (enforced by
 *  Foundry permissions — a non-GM controller needs scene ownership, and Foundry
 *  says so itself if they lack it). */
export async function writeBoardHidden(scene: unknown, hidden: boolean): Promise<void> {
  const s = scene as { setFlag?: (m: string, k: string, v: unknown) => Promise<unknown> } | null;
  await s?.setFlag?.(MODULE_ID, FLAGS.boardHidden, hidden);
}

/* -------------------------------------------- DM screen layout ---------- */

export function readDMLayout(): Layout {
  return normalize(game.user?.getFlag(MODULE_ID, FLAGS.dmScreenLayout));
}

export async function writeDMLayout(layout: Layout): Promise<void> {
  await game.user?.setFlag(MODULE_ID, FLAGS.dmScreenLayout, layout);
}

/* -------------------------------------------- Cast Bar ------------------ */
// Roster + speaker + visibility live on the Scene flag, so a GM write broadcasts
// to players via `updateScene` (same mechanism as the landing layout). No undo
// history here — the Cast Bar isn't part of the board's edit-mode history.

function normalizeCastBar(raw: unknown): CastBarData {
  const c = raw as Partial<CastBarData> | undefined;
  const plates = Array.isArray(c?.plates)
    ? c!.plates.filter((p): p is CastBarData["plates"][number] => !!p && typeof (p as { uuid?: unknown }).uuid === "string")
    : [];
  // Deep-clone so callers mutate a PRIVATE copy, never the live flag object
  // (same reasoning as `normalize` above).
  return foundry.utils.deepClone({
    visible: !!c?.visible,
    speakerId: typeof c?.speakerId === "string" ? c.speakerId : null,
    plates,
  }) as CastBarData;
}

export function readCastBar(scene: unknown, flag: string = FLAGS.castBar): CastBarData {
  const s = scene as { getFlag?: (m: string, k: string) => unknown } | null;
  if (!s?.getFlag) return { ...EMPTY_CASTBAR, plates: [] };
  return normalizeCastBar(s.getFlag(MODULE_ID, flag));
}

/** Persist a Cast Bar to a scene under its flag. GM only (Foundry permissions). */
export async function writeCastBar(scene: unknown, flag: string, data: CastBarData): Promise<void> {
  const s = scene as { setFlag?: (m: string, k: string, v: unknown) => Promise<unknown> } | null;
  await s?.setFlag?.(MODULE_ID, flag, data);
}
