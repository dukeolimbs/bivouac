/** Bivouac — parse Foundry document drags and turn them into tiles. Shared by
 *  the world layer (board) and the DM screen. */

import { type Widget, type WidgetType } from "./constants";

interface DropData {
  /** Document type, e.g. "Actor" | "JournalEntry" | "RollableTable" | "Macro". */
  type: string;
  uuid: string;
}

/** Foundry document type → Bivouac tile type. Items reuse the actor card. */
const DOC_TO_TILE: Record<string, WidgetType> = {
  Actor: "actor",
  Item: "actor",
  JournalEntry: "journal",
  JournalEntryPage: "journal",
  RollableTable: "table",
  Macro: "macro",
};

/** Default tile size (grid squares) per tile type. */
function defaultSize(type: WidgetType): { gw: number; gh: number } {
  if (type === "journal") return { gw: 4, gh: 5 };
  if (type === "macro" || type === "table") return { gw: 2, gh: 2 };
  return { gw: 3, gh: 4 }; // actor / item portrait
}

/** Normalise raw Foundry drag data → `{ type, uuid }`, or null if it isn't a
 *  document we handle. Shared by the DOM parser and the canvas-drop hook. */
export function normalizeDropData(data: unknown): DropData | null {
  const d = data as Record<string, unknown> | null | undefined;
  if (!d) return null;
  const type = String(d.type ?? "");
  let uuid = String(d.uuid ?? "");
  // Some legacy drags carry { type, id, pack } instead of a uuid.
  if (!uuid && d.id) uuid = d.pack ? `Compendium.${String(d.pack)}.${String(d.id)}` : `${type}.${String(d.id)}`;
  if (!type || !uuid || !(type in DOC_TO_TILE)) return null;
  return { type, uuid };
}

/** Parse a DOM drop event into `{ type, uuid }` (used by the DM screen panel).
 *  Uses Foundry's drag-data helper with a JSON fallback. */
export function parseDrop(event: DragEvent): DropData | null {
  const TE = (foundry.applications?.ux?.TextEditor?.implementation ??
    foundry.applications?.ux?.TextEditor ??
    (globalThis as { TextEditor?: unknown }).TextEditor) as
    | { getDragEventData?: (e: DragEvent) => Record<string, unknown> }
    | undefined;
  let data: Record<string, unknown> | undefined;
  try {
    data = TE?.getDragEventData?.(event);
  } catch {
    data = undefined;
  }
  if (!data) {
    try {
      data = JSON.parse(event.dataTransfer?.getData("text/plain") || "null") as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return normalizeDropData(data);
}

/** Build a tile from a parsed drop at cell (gx, gy). Resolves the document for a
 *  default title; returns null for unsupported drops. */
export async function widgetFromDrop(data: DropData, gx: number, gy: number): Promise<Widget | null> {
  const type = DOC_TO_TILE[data.type];
  if (!type) return null;
  const doc = (await fromUuid(data.uuid).catch(() => null)) as { name?: string } | null;
  const size = defaultSize(type);
  return {
    id: foundry.utils.randomID(),
    type,
    cell: { gx: Math.max(0, gx), gy: Math.max(0, gy), gw: size.gw, gh: size.gh },
    scope: "shared",
    title: doc?.name || undefined,
    chrome: "subtle",
    interactions: [],
    config: type === "journal" ? { uuid: data.uuid, journalMode: "inline" } : { uuid: data.uuid },
  };
}

/** Whether a drag currently carries a document Bivouac can turn into a tile.
 *  (dragover can't read the payload in all browsers, so this is best-effort — we
 *  accept the dragover and validate for real on drop.) */
export function isDocDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return !!types && (types.includes("text/plain") || types.includes("application/json"));
}
