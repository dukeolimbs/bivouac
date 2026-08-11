/** Bivouac — the shared scaffold for document-backed tiles (actor / journal /
 *  table / macro / mini sheet): resolve the linked document, gate on permission,
 *  hand the live document to the tile. */

import { el, placeholder } from "./dom";
import { canView } from "./foundry-api";
import { type RenderContext } from "./registry";

/** Shared scaffold for a document-backed tile: resolve `config.uuid`, gate on
 *  permission, then hand the live document to `fill`. Renders synchronously with
 *  a placeholder and swaps in the resolved view. */
export function docBody(
  ctx: RenderContext,
  fill: (doc: Record<string, unknown>, host: HTMLElement) => void,
): HTMLElement {
  const wrap = el("div", "bivouac-doc");
  const uuid = String(ctx.widget.config.uuid ?? "");
  if (!uuid) {
    wrap.appendChild(placeholder("fa-solid fa-link-slash", game.i18n.localize("BIVOUAC.Doc.None")));
    return wrap;
  }
  void (async () => {
    const doc = (await fromUuid(uuid).catch(() => null)) as Record<string, unknown> | null;
    if (!doc) {
      wrap.replaceChildren(placeholder("fa-solid fa-triangle-exclamation", game.i18n.localize("BIVOUAC.Doc.Missing")));
      return;
    }
    if (!canView(doc)) {
      wrap.replaceChildren(placeholder("fa-solid fa-lock", game.i18n.localize("BIVOUAC.Doc.Restricted")));
      return;
    }
    fill(doc, wrap);
  })();
  return wrap;
}

/** Best-effort image for a document (portrait, falling back to the token). */
export function docImg(doc: Record<string, unknown>): string {
  const token = (doc.prototypeToken as { texture?: { src?: string } } | undefined)?.texture?.src;
  return (doc.img as string) || token || "icons/svg/mystery-man.svg";
}

/** Extract renderable HTML from a JournalEntry (first text page) or a page. */
export function journalHtml(doc: Record<string, unknown>): string {
  const asPage = (doc.text as { content?: string } | undefined)?.content;
  if (typeof asPage === "string") return asPage;
  const pages = (doc.pages as { contents?: { type?: string; text?: { content?: string } }[] } | undefined)?.contents;
  const text = pages?.find((p) => p.type === "text")?.text?.content;
  return typeof text === "string" ? text : "";
}

/** Open a document's sheet on click, outside edit mode. The three doc tiles that
 *  are "a thing you click to open" all do exactly this. */
export function openOnClick(box: HTMLElement, doc: Record<string, unknown>): void {
  box.classList.add("bivouac-interactive");
  box.addEventListener("click", () => (doc.sheet as { render?: (b: boolean) => void })?.render?.(true));
}
