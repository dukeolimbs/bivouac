/** Bivouac — the note tile: rich text, enriched with Foundry's document links and
 *  inline rolls, in a font of the GM's choosing. */

import { el, placeholder } from "../dom";
import { fontStack } from "../fonts";
import { enrichNote } from "../foundry-api";
import { registerWidgetType } from "../registry";

registerWidgetType({
  type: "note",
  label: "BIVOUAC.Widgets.Note.Label",
  icon: "fa-solid fa-scroll",
  defaultConfig: () => ({ html: "" }),
  renderBody(ctx) {
    const html = String(ctx.widget.config.html ?? "").trim();
    if (!html) return placeholder("fa-solid fa-scroll", game.i18n.localize("BIVOUAC.Widgets.Note.Empty"));
    const box = el("div", "bivouac-note");
    // Fills its container (the .bivouac-scaler for landing tiles, or the card
    // for DM screen); zoom scaling is handled by that ancestor. On the landing
    // board the font scales with the tile size (cqmin) × this per-tile multiplier.
    box.style.setProperty("--bivouac-note-scale", String(Number(ctx.widget.config.textScale) || 1));
    // Per-note font: a custom Google Font name (loaded from the CDN) overrides
    // the dropdown pick (a font Foundry already has). Empty → tile default.
    const stack = fontStack(
      String(ctx.widget.config.font ?? "").trim(),
      String(ctx.widget.config.fontCustom ?? "").trim(),
    );
    if (stack) box.style.fontFamily = stack;
    // Show the raw HTML immediately, then enrich (document links, inline rolls,
    // etc.) asynchronously and swap it in.
    box.innerHTML = html;
    void enrichNote(box, html);
    return box;
  },
});
