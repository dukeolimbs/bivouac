/** Bivouac — the journal tile: the page rendered inline, or a link that opens it. */

import { docBody, journalHtml, openOnClick } from "../doc-tile";
import { el } from "../dom";
import { enrichNote } from "../foundry-api";
import { registerWidgetType } from "../registry";

/** Journal tile: inline-render the page content (default) or a link that opens
 *  it (config.journalMode === "link"). */
registerWidgetType({
  type: "journal",
  label: "BIVOUAC.Widgets.Journal.Label",
  icon: "fa-solid fa-book-open",
  defaultConfig: () => ({ uuid: "", journalMode: "inline" }),
  renderBody(ctx) {
    const link = ctx.widget.config.journalMode === "link";
    return docBody(ctx, (doc, host) => {
      if (link) {
        const box = el("div", "bivouac-doclink");
        box.appendChild(el("i", "bivouac-doclink__icon fa-solid fa-book-open"));
        box.appendChild(el("span", "bivouac-doclink__name", String(doc.name ?? "")));
        if (!ctx.editMode) openOnClick(box, doc);
        host.replaceChildren(box);
        return;
      }
      const note = el("div", "bivouac-note");
      const html = journalHtml(doc);
      note.innerHTML = html || `<p class="bivouac-doc__empty">${game.i18n.localize("BIVOUAC.Doc.EmptyJournal")}</p>`;
      if (html) void enrichNote(note, html);
      host.replaceChildren(note);
    });
  },
});
