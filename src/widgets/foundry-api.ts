/** Bivouac — the Foundry API seam.
 *
 *  Everything in here reaches into a Foundry API whose SHAPE has moved between
 *  versions, so each access is a probe with a fallback rather than a plain call.
 *  They live together on purpose: when a Foundry release moves one of them, this
 *  is the only file that needs looking at. Nothing here holds Bivouac logic — the
 *  callers decide what to do with the answers. */

/** Foundry's text enricher. The implementation moved from a global `TextEditor`
 *  to `foundry.applications.ux.TextEditor` and then behind `.implementation`, so
 *  all three are tried newest-first. */
function textEditor(): { enrichHTML?: (h: string, o?: object) => Promise<string> } | undefined {
  return (foundry.applications?.ux?.TextEditor?.implementation ??
    foundry.applications?.ux?.TextEditor ??
    (globalThis as { TextEditor?: unknown }).TextEditor) as
    | { enrichHTML?: (h: string, o?: object) => Promise<string> }
    | undefined;
}

/** Enrich note HTML with Foundry's text enrichers (document @UUID links, inline
 *  [[/roll]]s, content links, etc.) and swap the result into the box. Clickable
 *  links/rolls work via Foundry's global delegated handlers on the document.
 *  Async, so the caller shows the raw HTML first; falls back to it on error. */
export async function enrichNote(box: HTMLElement, html: string): Promise<void> {
  const TE = textEditor();
  if (!TE?.enrichHTML) return;
  try {
    box.innerHTML = await TE.enrichHTML(html, { secrets: !!game.user?.isGM });
  } catch {
    /* keep the raw-HTML fallback the caller already set */
  }
}

/** Font families Foundry already knows about (core + any the GM added via
 *  "Manage Fonts", which is where Google Fonts get registered natively).
 *
 *  Two probes, because `FontConfig` moved under
 *  `foundry.applications.settings.menus` and `CONFIG.fontDefinitions` is the
 *  older/parallel source. Returns whatever was found, deduped — the caller
 *  handles the "found nothing" case. */
export function foundryFontFamilies(): string[] {
  const g = globalThis as { foundry?: unknown; FontConfig?: unknown; CONFIG?: { fontDefinitions?: object } };
  const out = new Set<string>();
  try {
    const fc =
      (g.foundry as { applications?: { settings?: { menus?: { FontConfig?: { getAvailableFonts?: () => string[] } } } } })
        ?.applications?.settings?.menus?.FontConfig ??
      (g.FontConfig as { getAvailableFonts?: () => string[] } | undefined);
    const list = fc?.getAvailableFonts?.();
    if (Array.isArray(list)) list.forEach((f) => out.add(String(f)));
  } catch {
    /* older/newer API — fall back below */
  }
  try {
    const defs = g.CONFIG?.fontDefinitions;
    if (defs) Object.keys(defs).forEach((f) => out.add(f));
  } catch {
    /* ignore */
  }
  return [...out];
}

/** Can the current user at least see this document? Doc tiles render a quiet
 *  "restricted" placeholder for users below LIMITED permission, so a shared tile
 *  never leaks GM-only content. Defaults to visible when the document doesn't
 *  implement the check. */
export function canView(doc: unknown): boolean {
  const d = doc as { testUserPermission?: (u: unknown, p: string) => boolean } | null;
  try {
    return d?.testUserPermission ? d.testUserPermission(game.user, "LIMITED") : true;
  } catch {
    return true;
  }
}

/** May this client write to the scene itself?
 *
 *  Asked of the DOCUMENT rather than assumed from the role, because all three
 *  answers occur: a GM can, a player who owns the scene can, and a plain player
 *  cannot — and the last is the normal case, which is why a player's plate
 *  actions are relayed to a GM instead (see `plate-requests.ts`). Falls back to
 *  "am I a GM" if the method is missing, which is the conservative answer for the
 *  only two callers that matter. */
export function canWriteScene(scene: unknown): boolean {
  const s = scene as { canUserModify?: (u: unknown, a: string) => boolean } | null;
  try {
    return s?.canUserModify
      ? !!s.canUserModify(game.user, "update")
      : !!game.user?.isGM;
  } catch {
    return !!game.user?.isGM;
  }
}

/* ------------------------------------------------- raised hands --------- */

/** Which characters have their hand up, and which raisers could not be answered.
 *
 *  `User#character` is the actor assigned to a user in Foundry's Players
 *  configuration — literally "this is who I am playing" — and it is the only
 *  thing that maps a raised hand to ONE actor.
 *
 *  OWNERSHIP cannot, which is what this replaced. A player may own several
 *  actors, a GM owns all of them, and `testUserPermission` honours
 *  `ownership.default`, so a party whose sheets are readable by the whole table
 *  is owned by the whole table: "any raised owner" then put every hand up from a
 *  single raise. Ownership answers "may this user act on this actor", which is a
 *  different question from "is this user playing it".
 *
 *  GMs are NOT excluded any more. They were, because a GM owns everything and so
 *  matched every plate; with an exact character match a GM's raise can only ever
 *  reach the one actor they are assigned, which is the right answer for the GM
 *  who is also running a PC.
 *
 *  `unassigned` is returned rather than dropped so the caller can say out loud
 *  that a raise landed nowhere. A user with no character assigned is the one case
 *  this rule cannot serve, and silence there looks exactly like the bug it
 *  replaced. */
export function raisedCharacters(userIds: Iterable<string>): {
  characters: Set<string>;
  unassigned: Set<string>;
} {
  const characters = new Set<string>();
  const unassigned = new Set<string>();
  for (const uid of userIds) {
    const user = game.users?.get?.(uid) as { character?: { id?: string } | null } | null;
    if (!user) continue; // a stale id — a user who has since disconnected or gone
    const id = user.character?.id;
    if (id) characters.add(String(id));
    else unassigned.add(uid);
  }
  return { characters, unassigned };
}

/** Is this document one of those characters?
 *
 *  Two ids are accepted because a plate can be pointed at either end of the same
 *  character: its own (a sidebar Actor, or a LINKED token's actor, which is the
 *  same document) and, for an UNLINKED token's synthetic actor, the sidebar actor
 *  it was made from. An assigned character on an unlinked token is unusual, but
 *  the check costs one property read. */
export function isPlayedBy(doc: unknown, characterIds: Set<string>): boolean {
  if (!characterIds.size) return false;
  const d = doc as {
    id?: string;
    token?: { baseActor?: { id?: string } | null } | null;
  } | null;
  if (!d) return false;
  if (d.id && characterIds.has(String(d.id))) return true;
  const base = d.token?.baseActor?.id;
  return !!base && characterIds.has(String(base));
}

/** Is this document the actor the CURRENT user is playing? The same rule as the
 *  raised-hand badge (`User#character`, not ownership), because it answers the
 *  same question: which one plate is this user's own. */
export function isOwnCharacter(doc: unknown): boolean {
  const id = (game.user as { character?: { id?: string } | null } | null)?.character?.id;
  return !!id && isPlayedBy(doc, new Set([String(id)]));
}

/**
 * The version of an Actor that actually exists **in the current scene**.
 *
 * An UNLINKED token doesn't share the sidebar Actor: Foundry gives it a synthetic
 * actor holding a delta, and everything that happens to that token in play —
 * damage, conditions, temporary effects — is written there, not to the actor the
 * token was created from. Anything Bivouac stores as an `Actor.<id>` uuid
 * therefore resolves to the PROTOTYPE, and shows the state the actor had before
 * it was ever placed. That's how a plate came to show none of the conditions
 * applied to its token.
 *
 * So: if the scene holds exactly one token for this actor, read from that token's
 * actor instead. For a LINKED token that's the same document, so this is a no-op
 * there and safe to call unconditionally.
 *
 * **Several tokens of one actor is deliberately left alone.** Five goblins from
 * one statblock give no way to know which the plate means, and silently picking
 * the first would show one goblin's wounds under a name that stands for all of
 * them — worse than showing the prototype, because it looks right.
 */
export function sceneActor<T>(doc: T): T {
  const d = doc as { documentName?: string; id?: string; isToken?: boolean } | null;
  // Already a token's actor, or not an Actor at all → nothing to resolve.
  if (!d || d.documentName !== "Actor" || d.isToken || !d.id) return doc;
  try {
    const placeables = (canvas?.tokens?.placeables ?? []) as {
      actor?: { id?: string; isToken?: boolean } | null;
      document?: { actorId?: string; actorLink?: boolean } | null;
    }[];
    const matches = placeables.filter((t) => t.document?.actorId === d.id);
    if (matches.length !== 1) return doc;
    return ((matches[0].actor as T | undefined) ?? doc) as T;
  } catch {
    return doc;
  }
}

/** One thing to draw on a plate's condition strip. */
export interface ConditionBadge {
  /** Stable-ish key for de-duplication and debugging. */
  key: string;
  /** What to show on hover. */
  label: string;
  /** Icon path. */
  img: string;
  /** True for a timed ActiveEffect that is not a status condition — a spell or
   *  feature running on this character rather than a state it is in. */
  effect: boolean;
  /** The `CONFIG.statusEffects` id this badge came from, when it is a status
   *  condition (absent on a bare effect). Exposed so a caller can ask the active
   *  system whether the status carries a LEVEL — dnd5e exhaustion — without this
   *  file having to know that any system does. */
  status?: string;
}

/**
 * What a plate should show as "conditions".
 *
 * Two sources, deliberately:
 *
 *  1. **Status conditions** — `CONFIG.statusEffects` entries present in
 *     `actor.statuses`. Walked in the world's configured order so the strip is
 *     stable between renders, and so anything unrecognised is skipped rather
 *     than drawn as a broken icon.
 *  2. **Temporary ActiveEffects that grant no status** — Bless, Bardic
 *     Inspiration, a Hunter's Mark running on this character. These carry real
 *     information a status list cannot: they are the reason a number on the sheet
 *     is not the number on the statblock.
 *
 * Only TEMPORARY effects, via `appliedEffects` + `isTemporary`. That is the whole
 * guard against burying the portrait: `appliedEffects` is already filtered to
 * active (not disabled, not suppressed, not expired), and `isTemporary` then
 * drops the permanents — a PC's racial and feat effects, which are numerous,
 * unchanging and of no interest mid-scene. It is also why this can share the
 * per-plate conditions toggle instead of needing one of its own: the set it adds
 * is small and it changes for reasons the table cares about.
 *
 * **Status labels are enriched from the effect that granted them.** This is the
 * point of the exercise. dnd5e's concentration applies an effect named
 * "Concentrating: Hunter's Mark" carrying the `concentrating` status, so the
 * status alone tells you a character is concentrating while the useful half —
 * on WHAT — sits in the effect's name. Where a granting effect has a name of its
 * own, that name is preferred; where it just restates the condition ("Prone"
 * granting `prone`), the condition's own localised name is used instead.
 */
export function conditionBadges(doc: unknown): ConditionBadge[] {
  const actor = doc as {
    statuses?: Set<string>;
    appliedEffects?: Iterable<Eff>;
    effects?: Iterable<Eff>;
  } | null;
  if (!actor) return [];

  const statuses =
    actor.statuses && typeof actor.statuses.has === "function"
      ? actor.statuses
      : new Set<string>();

  // `appliedEffects` is the v11+ getter and already excludes disabled, suppressed
  // and expired effects. Fall back to the raw collection with the same tests
  // applied by hand, so a version that drops the getter degrades rather than
  // showing nothing.
  const live: Eff[] = [];
  try {
    const src = actor.appliedEffects ?? actor.effects ?? [];
    for (const e of src) {
      if (!e) continue;
      if (actor.appliedEffects) live.push(e);
      else if (!e.disabled && !e.isSuppressed) live.push(e);
    }
  } catch {
    /* an actor shape we don't recognise — statuses alone still work */
  }

  const temporary = live.filter(isTemporary);
  const out: ConditionBadge[] = [];

  /* 1. status conditions, in the world's configured order */
  const cfg = (CONFIG?.statusEffects ?? []) as StatusCfg[];
  for (const s of cfg) {
    if (!s?.id || !statuses.has(s.id)) continue;
    const generic = loc(String(s.name ?? s.label ?? s.id));
    // Names of the effects that granted this status, minus any that merely
    // restate it. Usually none (a "Prone" effect granting `prone`), sometimes one
    // and worth reading ("Concentrating: Hunter's Mark").
    const named = temporary
      .filter((e) => hasStatus(e, s.id!))
      .map((e) => String(e.name ?? "").trim())
      .filter((n) => n && n !== generic);
    out.push({
      key: `status:${s.id}`,
      label: named.length ? [...new Set(named)].join(" · ") : generic,
      img: String(s.img ?? s.icon ?? ""),
      effect: false,
      status: String(s.id),
    });
  }

  /* 2. temporary effects that granted no status of their own */
  const spare = temporary
    .filter((e) => !anyStatus(e))
    .map((e) => ({
      key: `effect:${String(e.id ?? e.name ?? "")}`,
      label: loc(String(e.name ?? "")),
      img: String(e.img ?? e.icon ?? ""),
      effect: true,
    }))
    .filter((b) => b.label);
  // Sorted by name: a document collection's order is an accident of when things
  // were applied, and a strip that reshuffles itself as effects come and go is
  // harder to read at a glance than one that doesn't.
  spare.sort((a, b) => a.label.localeCompare(b.label, game.i18n?.lang));
  out.push(...spare);

  return out;
}

type StatusCfg = {
  id?: string;
  name?: string;
  label?: string;
  img?: string;
  icon?: string;
};

type Eff = {
  id?: string;
  name?: string;
  img?: string;
  icon?: string;
  disabled?: boolean;
  isSuppressed?: boolean;
  isTemporary?: boolean;
  statuses?: Set<string> | string[];
  duration?: { expiry?: unknown; value?: unknown; rounds?: unknown; seconds?: unknown; turns?: unknown };
};

function loc(s: string): string {
  try {
    return game.i18n?.localize ? game.i18n.localize(s) : s;
  } catch {
    return s;
  }
}

/** Does this effect have a duration at all?
 *
 *  `isTemporary` is the getter to trust when it is there. The fallback mirrors
 *  what it does (v13: `!!duration.expiry || Number.isFinite(duration.value)`)
 *  and also accepts the older rounds/seconds/turns shape, so this keeps working
 *  either side of that change. */
function isTemporary(e: Eff): boolean {
  if (typeof e.isTemporary === "boolean") return e.isTemporary;
  const d = e.duration ?? {};
  return (
    !!d.expiry ||
    Number.isFinite(Number(d.value)) ||
    Number.isFinite(Number(d.rounds)) ||
    Number.isFinite(Number(d.seconds)) ||
    Number.isFinite(Number(d.turns))
  );
}

function statusSet(e: Eff): string[] {
  const s = e.statuses;
  return s instanceof Set ? [...s] : Array.isArray(s) ? s : [];
}
const hasStatus = (e: Eff, id: string): boolean => statusSet(e).includes(id);
const anyStatus = (e: Eff): boolean => statusSet(e).length > 0;

/* ------------------------------------------------ combat ---------------- */

/** As much of a TokenDocument as the combat helpers touch. */
type CombatTok = {
  id?: string;
  inCombat?: boolean;
  constructor?: unknown;
};

/**
 * The Tokens in the CURRENT scene that belong to this actor.
 *
 * `getActiveTokens(linked, document)` with `document: true` gives
 * TokenDocuments rather than placeables, and only ever looks at the scene on the
 * canvas — which is the right scope, since combat is a property of the scene you
 * are running.
 *
 * Returns every matching token, not one. Unlike `sceneActor()`, which refuses to
 * choose when an actor has several (showing one goblin's wounds under a name that
 * stands for five is worse than showing none), there is nothing to choose here:
 * putting an actor's presence into a fight means all of it. That also keeps this
 * consistent with the parked-token rule, which is one token per ACTOR rather than
 * one per plate.
 */
export function sceneTokensOf(doc: unknown): CombatTok[] {
  const actor = doc as {
    getActiveTokens?: (linked?: boolean, document?: boolean) => CombatTok[];
  } | null;
  try {
    return actor?.getActiveTokens?.(false, true) ?? [];
  } catch {
    return [];
  }
}

/** Is this actor in the encounter? True when ANY of its tokens is a combatant —
 *  the plate is one row of chrome and cannot show a half state, and "some of
 *  these are fighting" is much more usefully reported as "in" than as "out". */
export function inCombat(doc: unknown): boolean {
  return sceneTokensOf(doc).some((t) => !!t.inCombat);
}

/** What `toggleCombat` did, so the caller can say so without re-deriving it. */
export type CombatResult = "added" | "removed" | "no-token" | "failed";

/**
 * Put this actor's tokens into the encounter, or take them out.
 *
 * Foundry's own `TokenDocument.createCombatants` does the fiddly parts and is
 * used rather than reimplemented: it creates the Combat when none is active,
 * skips tokens already in it, and carries each token's `hidden` across so a
 * hidden combatant stays hidden in the tracker.
 *
 * `no-token` is a real outcome and the caller must handle it. A plate holds an
 * Actor uuid, not a token, so a plated character need not be in the scene at all
 * — and combat is defined on tokens (a Combatant carries `tokenId` and
 * `sceneId`). This is the case the "give plates a token in the scene" setting
 * exists to remove.
 */
export async function toggleCombat(doc: unknown): Promise<CombatResult> {
  const tokens = sceneTokensOf(doc);
  if (!tokens.length) return "no-token";
  const leaving = tokens.some((t) => !!t.inCombat);
  const cls = tokenClass(tokens[0]) as {
    createCombatants?: (t: CombatTok[]) => Promise<unknown>;
    deleteCombatants?: (t: CombatTok[]) => Promise<unknown>;
  } | null;
  try {
    if (leaving) {
      // Only the ones actually in it, or Foundry is asked to delete combatants
      // that do not exist.
      const inIt = tokens.filter((t) => !!t.inCombat);
      if (!cls?.deleteCombatants) return "failed";
      await cls.deleteCombatants(inIt);
      return "removed";
    }
    if (!cls?.createCombatants) return "failed";
    await cls.createCombatants(tokens);
    return "added";
  } catch {
    return "failed";
  }
}

/** The TokenDocument class, for its static combatant helpers. Taken from the
 *  instance first — that is what Foundry's own `toggleCombatant` does, and it
 *  respects a system that has subclassed TokenDocument — with the registered
 *  class as the fallback. */
function tokenClass(t: CombatTok | undefined): unknown {
  return (
    (t?.constructor as unknown) ??
    (foundry.utils?.getDocumentClass?.("Token") as unknown) ??
    null
  );
}
