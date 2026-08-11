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
