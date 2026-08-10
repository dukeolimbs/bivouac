/** Bivouac — parse Foundry document drags and turn them into tiles. Shared by
 *  the world layer (board) and the DM screen. */

import { MODULE_ID, SETTINGS, type Widget, type WidgetType } from "./constants";

interface DropData {
  /** Document type, e.g. "Actor" | "JournalEntry" | "RollableTable" | "Macro". */
  type: string;
  uuid: string;
}

/** Foundry document type → Bivouac tile type. Items reuse the actor card — an
 *  Item has no character sheet to miniaturise, so it never offers the choice
 *  below. */
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
  if (type === "journal" || type === "minisheet") return { gw: 4, gh: 5 };
  if (type === "macro" || type === "table") return { gw: 2, gh: 2 };
  return { gw: 3, gh: 4 }; // actor / item portrait
}

/**
 * An Actor can become either tile, so ask which — unless the dropper has pinned a
 * default.
 *
 * Always prompting would wear thin fast while laying out a scene, so the setting
 * decides and **holding Shift while dropping always brings the prompt back**.
 * That way the escape hatch is one rule rather than an inversion that depends on
 * what the setting happens to be.
 */
async function pickActorTile(name: string): Promise<WidgetType | null> {
  const pref = String(game.settings.get(MODULE_ID, SETTINGS.actorDropTile) ?? "ask");
  const forceAsk = game.keyboard?.isModifierActive?.("SHIFT") === true;
  if (!forceAsk && (pref === "actor" || pref === "minisheet")) return pref;

  const t = (k: string): string => game.i18n.localize(k);
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: t("BIVOUAC.Drop.ActorTitle"), icon: "fa-solid fa-user-plus" },
    classes: ["bivouac-dialog", "bivouac-dialog--picker"],
    position: { width: 560 },
    content: `<p class="bivouac-pick-hint">${foundry.utils.escapeHTML(
      game.i18n.format("BIVOUAC.Drop.ActorPrompt", { name }),
    )}</p>`,
    buttons: [
      { action: "actor", label: t("BIVOUAC.Drop.ActorArt"), icon: "fa-solid fa-image", default: true },
      { action: "minisheet", label: t("BIVOUAC.Drop.ActorMini"), icon: "fa-solid fa-id-card" },
    ],
    rejectClose: false,
  });
  return choice === "actor" || choice === "minisheet" ? choice : null;
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
  let type = DOC_TO_TILE[data.type];
  if (!type) return null;
  const doc = (await fromUuid(data.uuid).catch(() => null)) as { name?: string } | null;

  // An Actor can be art or a Mini Sheet. Asking here (rather than at each call
  // site) means both drop paths — the board's canvas drop and the DM-screen
  // panel — get the same behaviour for free. Cancelling the prompt cancels the
  // drop, which is why this returns null rather than falling back to a default.
  if (data.type === "Actor") {
    const picked = await pickActorTile(doc?.name ?? "");
    if (!picked) return null;
    type = picked;
  }

  const size = defaultSize(type);
  return {
    id: foundry.utils.randomID(),
    type,
    cell: { gx: Math.max(0, gx), gy: Math.max(0, gy), gw: size.gw, gh: size.gh },
    scope: "shared",
    title: doc?.name || undefined,
    chrome: "subtle",
    interactions: [],
    config:
      type === "journal"
        ? { uuid: data.uuid, journalMode: "inline" }
        : type === "minisheet"
          ? { uuid: data.uuid, cards: [] } // pins start empty; see the Mini Sheet tile
          : { uuid: data.uuid },
  };
}

/** Whether a drag currently carries a document Bivouac can turn into a tile.
 *  (dragover can't read the payload in all browsers, so this is best-effort — we
 *  accept the dragover and validate for real on drop.) */
export function isDocDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return !!types && (types.includes("text/plain") || types.includes("application/json"));
}
