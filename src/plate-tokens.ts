/**
 * Bivouac — Plates as Scene Tokens.
 *
 * A Plate is an entry in a Scene flag holding an Actor UUID. That is enough for
 * everything Bivouac itself draws, but it is invisible to the rest of Foundry:
 * modules ask `actor.getActiveTokens()`, `scene.tokens` or
 * `canvas.tokens.placeables`, and a flag entry satisfies none of them. There is
 * no way to fake it — the only thing those calls accept is a real TokenDocument
 * in the scene.
 *
 * So when the setting is on we keep one for each plated actor: a hidden,
 * sightless token parked in the scene's padding, created when a plate appears and
 * deleted when it goes. It is a side effect on world data — it changes what the
 * scene actually CONTAINS — and it shipped off by default for that reason.
 *
 * It is ON by default as of 1.3.3. The reasoning changed rather than the risk:
 * without this, a plate's "add to the encounter" control has nothing to make a
 * combatant out of, so the setting was a prerequisite dressed up as an option and
 * the common case was a button explaining why it could not work. What makes the
 * default defensible is that this pass is reversible and self-correcting — rules
 * 1 and 2 below mean it never touches anything it did not place, and switching
 * the setting off sweeps every token it ever did, in every scene.
 *
 * Three rules keep it from fighting the GM:
 *
 *  1. **A real token always wins.** If the actor already has a token placed, we
 *     add nothing: that token is what the modules will find. Drop a real token
 *     for an actor we were covering and ours is withdrawn on the next pass.
 *  2. **We only ever delete our own.** Removal is keyed on our marker flag, so a
 *     token the GM placed is never touched, whatever happens to the plate.
 *  3. **One per actor, not one per plate.** Two plates for the same actor (both
 *     bars, or the same bar twice) share the single token, because that is what
 *     the scene would hold if you had placed it by hand.
 *
 * The whole pass is a reconcile rather than a set of create/delete callbacks: it
 * reads the scene as it is, works out the difference and applies it. That makes
 * it idempotent, so it can be re-run from any hook — and after its own writes —
 * without keeping a ledger of what it did last time.
 *
 * **Knock-on for what a plate reads.** `sceneActor()` resolves a plate to the
 * actor of the scene's single token for it. Switching this on therefore gives an
 * UNLINKED plated NPC a scene actor where it previously had none, so the plate
 * starts reading the parked token's delta instead of the sidebar prototype. That
 * is the intended direction — the parked token is what a condition applied
 * through the token HUD lands on — but it does mean the plate's numbers and
 * conditions have a different source with the setting on than with it off.
 */

import { FLAGS, MODULE_ID, SETTINGS, log } from "./constants";
import { readCastBar } from "./layout";

/** Columns to park hidden tokens in before wrapping to the next row. Purely
 *  cosmetic — they sit in the padding margin, where a GM can see they exist
 *  without them covering the map. */
const PARK_COLS = 10;

/** Minimal shape of a TokenDocument — as much of it as this file touches. */
type Tok = {
  id: string;
  actorId?: string | null;
  getFlag?: (m: string, k: string) => unknown;
};

/** Minimal shape of a Scene. */
type Scn = {
  id?: string;
  name?: string;
  tokens?: Iterable<Tok>;
  dimensions?: { size?: number };
  grid?: { size?: number };
  createEmbeddedDocuments?: (t: string, d: object[]) => Promise<unknown>;
  deleteEmbeddedDocuments?: (t: string, ids: string[]) => Promise<unknown>;
};

/**
 * Is the feature switched on? `null` means UNKNOWN — the setting could not be
 * read, which the hooks driving this can manage if one fires before `init` has
 * registered it.
 *
 * The three states matter, and collapsing unknown into `false` was a real hazard
 * once the setting became default-on. `false` is an instruction to sweep: the
 * reconcile deletes every parked token, because that is what switching the
 * feature off means. An unreadable setting reported as `false` would therefore
 * delete a scene's worth of tokens and then recreate them on the next pass — a
 * lot of world-data churn triggered by a race. `null` means do nothing and wait
 * for a pass that can actually tell.
 */
function enabled(): boolean | null {
  try {
    return !!game.settings.get(MODULE_ID, SETTINGS.castPlateTokens);
  } catch {
    return null;
  }
}

/** Did WE create this token? This marker is what makes rule 2 safe. */
function isManaged(t: Tok): boolean {
  return t.getFlag?.(MODULE_ID, FLAGS.plateToken) === true;
}

/** The world Actor id a plate points at, or null.
 *
 *  Deliberately narrow: only a plain `Actor.<id>` qualifies. A plate can also
 *  hold an Item (nothing to place), a compendium actor (`Compendium.…`, which
 *  would have to be imported into the world first) or a token's own synthetic
 *  actor (`Scene.…Token.…Actor.…`, which by definition already has its token). */
function worldActorId(uuid: string): string | null {
  const parts = String(uuid ?? "").split(".");
  if (parts.length !== 2 || parts[0] !== "Actor") return null;
  return game.actors?.get?.(parts[1]) ? parts[1] : null;
}

/** Every world Actor id the given scene's plates reference, across both bars. */
function platedActorIds(scene: Scn): Set<string> {
  const out = new Set<string>();
  for (const flag of [FLAGS.castBar, FLAGS.castBar2])
    for (const p of readCastBar(scene, flag).plates) {
      const id = worldActorId(p.uuid);
      if (id) out.add(id);
    }
  return out;
}

/** Token data for one actor, parked at `slot`.
 *
 *  Built through `getTokenDocument` rather than by hand so the prototype token is
 *  honoured in full — art, size, disposition, actor-link, rolled names — and then
 *  overridden only where a parked token must differ from a played one. */
async function parkedToken(
  scene: Scn,
  actorId: string,
  slot: number,
): Promise<object | null> {
  const actor = game.actors?.get?.(actorId) as {
    getTokenDocument?: (d: object) => Promise<{ toObject: () => object }>;
  } | null;
  if (!actor?.getTokenDocument) return null;
  const size = Number(scene.dimensions?.size ?? scene.grid?.size ?? 100) || 100;
  const none = CONST?.TOKEN_DISPLAY_MODES?.NONE ?? 0;
  const doc = await actor
    .getTokenDocument({
      // (0, 0) is the top-left of the scene's PADDING, outside the playable
      // rect — so a GM glancing at the map sees the parked row off to one side
      // rather than a stack of ghosts sitting on the artwork.
      x: (slot % PARK_COLS) * size,
      y: Math.floor(slot / PARK_COLS) * size,
      hidden: true,
      // Sight OFF is not cosmetic. A player-owned token is a vision source even
      // while hidden, so a sighted one parked in the margin would quietly hand
      // its owner a view of the map's corner. Nothing here is meant to be seen
      // through — it exists to be FOUND by other modules.
      sight: { enabled: false },
      displayName: none,
      displayBars: none,
      flags: { [MODULE_ID]: { [FLAGS.plateToken]: true } },
    })
    .catch(() => null);
  return doc ? doc.toObject() : null;
}

/* ------------------------------------------------ the pass --------------- */

/** Re-entrancy guard. Our own creates and deletes fire `createToken` /
 *  `deleteToken`, which are wired to call back in here; the pass is idempotent so
 *  a re-entry is harmless, but there is no reason to pay for it. A call arriving
 *  mid-pass collapses into a single follow-up, so a genuine external change made
 *  during our write is still picked up. */
let running = false;
let queued = false;

/**
 * Reconcile the active scene's parked tokens against its plates.
 *
 * GM-only, and specifically the ACTIVE GM: this writes world data and every
 * connected client runs the same hooks, so without that gate four logged-in GMs
 * would each create a token for the same plate.
 */
export async function syncPlateTokens(): Promise<void> {
  if (!game.user?.isActiveGM) return;
  const scene = canvas?.scene as Scn | null;
  if (!scene) return;
  if (running) {
    queued = true;
    return;
  }
  running = true;
  try {
    await reconcile(scene);
  } catch (e) {
    log("plate tokens: sync failed", e);
  } finally {
    running = false;
    if (queued) {
      queued = false;
      await syncPlateTokens();
    }
  }
}

async function reconcile(scene: Scn): Promise<void> {
  const tokens = [...(scene.tokens ?? [])];
  const managed = tokens.filter(isManaged);

  const on = enabled();
  // Unreadable setting → do nothing at all. Not the same as off; see `enabled`.
  if (on === null) return;
  // Switched off: withdraw everything we put here and do nothing else. The
  // setting's own handler sweeps the other scenes; this covers the active one,
  // and any token left behind by a world that was disabled while off-scene.
  if (!on) {
    if (managed.length) await del(scene, managed.map((t) => t.id));
    return;
  }

  const wanted = platedActorIds(scene);
  const managedIds = new Set(managed.map((t) => t.id));

  // Actors that already have a token the GM placed — rule 1.
  const real = new Set<string>();
  for (const t of tokens)
    if (t.actorId && !managedIds.has(t.id)) real.add(t.actorId);

  // Our own, grouped by actor, so duplicates can be pruned back to one.
  const mine = new Map<string, string[]>();
  for (const t of managed) {
    if (!t.actorId) continue; // an actorless token of ours can only be debris
    const list = mine.get(t.actorId) ?? [];
    list.push(t.id);
    mine.set(t.actorId, list);
  }

  const remove = managed.filter((t) => !t.actorId).map((t) => t.id);
  for (const [actorId, ids] of mine) {
    // Keep exactly one only while the actor is plated AND uncovered; otherwise
    // the whole group goes — the plate was removed, or a real token took over.
    const keep = wanted.has(actorId) && !real.has(actorId) ? 1 : 0;
    remove.push(...ids.slice(keep));
  }
  const add = [...wanted].filter((id) => !real.has(id) && !mine.has(id));

  if (remove.length) await del(scene, remove);
  if (!add.length) return;

  // Park new arrivals after the ones that are staying, so they don't land on top
  // of each other.
  let slot = managed.length - remove.length;
  const data: object[] = [];
  for (const actorId of add) {
    const t = await parkedToken(scene, actorId, slot);
    if (t) {
      data.push(t);
      slot++;
    }
  }
  if (data.length) {
    await scene.createEmbeddedDocuments?.("Token", data);
    log(`plate tokens: +${data.length} in "${scene.name ?? scene.id}"`);
  }
}

async function del(scene: Scn, ids: string[]): Promise<void> {
  await scene.deleteEmbeddedDocuments?.("Token", ids);
  log(`plate tokens: -${ids.length} in "${scene.name ?? scene.id}"`);
}

/**
 * Delete every token we have ever parked, in EVERY scene.
 *
 * Run when the setting is switched off. The normal pass only touches the active
 * scene, so without this a world that had the feature on for a while would keep
 * parked tokens in each scene it visited — invisible litter in world data that
 * the GM never asked for and would have to hunt down by hand.
 */
export async function sweepPlateTokens(): Promise<void> {
  if (!game.user?.isActiveGM) return;
  for (const scene of (game.scenes ?? []) as Iterable<Scn>) {
    const ids = [...(scene.tokens ?? [])].filter(isManaged).map((t) => t.id);
    if (!ids.length) continue;
    try {
      await del(scene, ids);
    } catch (e) {
      log("plate tokens: sweep failed", e);
    }
  }
}
