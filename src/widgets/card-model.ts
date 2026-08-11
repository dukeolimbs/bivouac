/** Bivouac — the card-list model shared by the cards tile, the mini sheet's pins,
 *  and both host surfaces. Pure functions over a widget config: no DOM, no
 *  Foundry documents, nothing to mock. */

import { type Widget } from "../constants";

/** Does this widget reference the given document UUID (for targeted refresh)? */
export function refsUuid(widget: Widget, uuid: string): boolean {
  if (widget.config?.uuid === uuid) return true;
  const many = widget.config?.uuids;
  if (Array.isArray(many) && many.includes(uuid)) return true;
  const cards = widget.config?.cards;
  return Array.isArray(cards) && cards.some((c) => (c as { uuid?: string })?.uuid === uuid);
}

/** Apply a card-collection op (add / remove / move) to a widget config, returning
 *  the new config (or null if it's a no-op). Cards are `{ cid, uuid }` so the same
 *  document can appear multiple times and each instance is addressed by `cid`.
 *  Shared by the world layer and DM screen. */
export function applyCardOp(
  config: Record<string, unknown>,
  detail: { op?: string; uuid?: string; cid?: string; targetCid?: string; after?: boolean },
): Record<string, unknown> | null {
  const list: { cid: string; uuid: string }[] = Array.isArray(config.cards)
    ? (config.cards as { cid: string; uuid: string }[]).map((c) => ({ cid: c.cid, uuid: c.uuid }))
    : Array.isArray(config.uuids)
      ? (config.uuids as string[]).map((u) => ({ cid: u, uuid: u })) // legacy migration
      : [];
  const { op, uuid, cid, targetCid, after } = detail;
  if (op === "add" && uuid) {
    list.push({ cid: foundry.utils.randomID(), uuid });
  } else if (op === "remove" && cid) {
    const i = list.findIndex((c) => c.cid === cid);
    if (i < 0) return null;
    list.splice(i, 1);
  } else if (op === "move" && cid) {
    const from = list.findIndex((c) => c.cid === cid);
    if (from < 0) return null;
    const [moved] = list.splice(from, 1);
    const ti = targetCid ? list.findIndex((c) => c.cid === targetCid) : -1;
    if (ti < 0) list.push(moved);
    else list.splice(ti + (after ? 1 : 0), 0, moved);
  } else {
    return null;
  }
  const next = { ...config, cards: list };
  delete (next as { uuids?: unknown }).uuids;
  return next;
}
