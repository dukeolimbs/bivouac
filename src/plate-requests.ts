/**
 * Bivouac — a player acting on their OWN plate.
 *
 * Two of the plate states are the player's to set, not the GM's: whether their
 * character is currently in the conversation, and whether they are the one
 * talking. Both were GM-only, for a reason that has nothing to do with intent:
 * **a player cannot write them**. Cast Bar state lives in a Scene flag, and
 * updating a Scene needs ownership of it, which players do not normally have. A
 * button that throws a permission error is worse than no button.
 *
 * So the player asks and the GM writes. The player's client emits a request on
 * the module's socket channel; the ACTIVE GM's client validates it and makes the
 * write, which broadcasts back to everyone through the flag as usual. One writer,
 * chosen the way `plate-tokens.ts` chooses one, so two connected GMs cannot both
 * apply the same request.
 *
 * **What is checked, and what cannot be.** The GM re-derives the whole decision
 * rather than trusting any of it: the plate must exist on the named scene, the
 * action must be one of the two above, and the requesting user must be PLAYING
 * that plate's character (`User#character`, the same rule the raised-hand badge
 * uses). What it cannot check is the identity claim itself — Foundry does not
 * stamp a sender on module socket messages, so `userId` is the sender's word for
 * it. A hand-crafted message could therefore make ANOTHER player's plate leave
 * the conversation or start speaking. That is the ceiling: two cosmetic,
 * reversible states on a plate whose owner could set them anyway, and never
 * anything a plate's player could not already do. Nothing here writes an Actor,
 * a Token or a Combatant.
 *
 * Requests carry the DESIRED VALUE rather than "toggle", so a stale client, a
 * double click and a dropped message cannot leave the flag inverted — the write
 * is idempotent and matches the optimistic state the requester already drew.
 */

import { MODULE_ID, type CastBarData } from "./constants";
import { readCastBar, writeCastBar } from "./layout";
import { isPlayedBy } from "./widgets/foundry-api";

/** The module's own socket channel. */
export const SOCKET = `module.${MODULE_ID}`;

/** The plate states a player may set on their own plate. Deliberately short: it
 *  is the list of things that are theirs to say. */
export const SELF_ACTIONS = ["exited", "speaker"] as const;
export type SelfAction = (typeof SELF_ACTIONS)[number];

export interface PlateRequest {
  type: "plate-request";
  /** The scene holding the plate — sent, not assumed, so a GM viewing another
   *  scene still writes the right one. */
  sceneId: string;
  /** Which bar's flag (`castBar` / `castBar2`). */
  flag: string;
  plateId: string;
  action: SelfAction;
  /** The state to end up in, not a toggle. */
  value: boolean;
  /** The requesting user, as CLAIMED by the sender (see the note above). */
  userId: string;
}

/** Is there a GM connected to answer a request? Without one there is nobody to
 *  write, so the caller can say so rather than leaving the player pressing a
 *  button that does nothing. */
export function activeGMPresent(): boolean {
  const users = game.users as
    | { activeGM?: { id?: string } | null; contents?: { active?: boolean; isGM?: boolean }[] }
    | undefined;
  if (users?.activeGM) return true;
  // `activeGM` is a v11+ getter; fall back to looking for one ourselves.
  return (users?.contents ?? []).some((u) => u.active && u.isGM);
}

/** Ask the GM to set one of this user's own plate states. Returns whether the
 *  request was sent — false means there was nobody to send it to. */
export function requestPlateAction(
  flag: string,
  plateId: string,
  action: SelfAction,
  value: boolean,
): boolean {
  const sceneId = String(canvas?.scene?.id ?? "");
  const userId = String(game.user?.id ?? "");
  if (!sceneId || !userId || !activeGMPresent()) return false;
  const req: PlateRequest = { type: "plate-request", sceneId, flag, plateId, action, value, userId };
  try {
    game.socket?.emit?.(SOCKET, req);
  } catch {
    return false; // no socket — nothing to fall back to
  }
  return true;
}

/** Read a socket payload as a request, or null if it isn't one. Every field is
 *  checked because every field arrived from another client. */
function parse(msg: unknown): PlateRequest | null {
  const m = msg as Partial<PlateRequest> | null | undefined;
  if (!m || m.type !== "plate-request") return null;
  const action = SELF_ACTIONS.find((a) => a === m.action);
  if (!action) return null;
  if (
    typeof m.sceneId !== "string" ||
    typeof m.flag !== "string" ||
    typeof m.plateId !== "string" ||
    typeof m.userId !== "string" ||
    typeof m.value !== "boolean"
  ) {
    return null;
  }
  // The flag names one of the two bars and nothing else — a request must not be
  // able to name an arbitrary flag key on the scene.
  if (m.flag !== "castBar" && m.flag !== "castBar2") return null;
  return { ...(m as PlateRequest), action };
}

/**
 * Apply a player's request, on the active GM's client only.
 *
 * Returns what happened, as a string, for the harness and for a `log()` a future
 * debugging session will want: "" means applied.
 */
export async function handlePlateRequest(msg: unknown): Promise<string> {
  if (!game.user?.isActiveGM) return "not the active GM";
  const req = parse(msg);
  if (!req) return "malformed";

  const scene = game.scenes?.get?.(req.sceneId);
  if (!scene) return "unknown scene";
  const data: CastBarData = readCastBar(scene, req.flag);
  const plate = data.plates.find((p) => p.id === req.plateId);
  if (!plate) return "unknown plate";

  // The requester must be playing this plate's character. Re-derived here from
  // the world, never taken from the message.
  const user = game.users?.get?.(req.userId) as { character?: { id?: string } | null } | null;
  const characterId = user?.character?.id;
  if (!characterId) return "requester plays no character";
  if (!isPlayedBy(fromUuidSync(plate.uuid), new Set([String(characterId)]))) {
    return "not the requester's character";
  }

  if (req.action === "exited") {
    if (plate.exited === req.value) return ""; // already there — no write
    plate.exited = req.value;
  } else {
    const next = req.value ? req.plateId : null;
    if (data.speakerId === next) return "";
    data.speakerId = next;
  }
  await writeCastBar(scene, req.flag, data);
  return "";
}
