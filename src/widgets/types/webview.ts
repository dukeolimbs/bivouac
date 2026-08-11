/** Bivouac — the webview tile: an embedded page, zoomable, with a pop-out escape
 *  hatch for sites that refuse embedding. */

import { el, placeholder } from "../dom";
import { registerWidgetType } from "../registry";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

registerWidgetType({
  type: "webview",
  label: "BIVOUAC.Widgets.Webview.Label",
  icon: "fa-solid fa-globe",
  defaultConfig: () => ({ url: "" }),
  renderBody(ctx) {
    const url = String(ctx.widget.config.url ?? "").trim();
    if (!url) return placeholder("fa-solid fa-globe", game.i18n.localize("BIVOUAC.Widgets.Webview.Empty"));

    // LOD: a graceful, quiet card — only shown when the board is busy and
    // zoomed way out (decided by the caller). No dev-looking chrome.
    if (ctx.lod && !ctx.editMode) {
      const box = el("div", "bivouac-webview__lod");
      box.appendChild(el("i", "bivouac-webview__lod-icon fa-solid fa-globe"));
      box.appendChild(el("span", "bivouac-webview__lod-host", hostOf(url)));
      return box;
    }

    const wrap = el("div", "bivouac-webview");
    const frame = document.createElement("iframe");
    frame.className = "bivouac-webview__frame";
    frame.src = url;
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("loading", "lazy");

    // Content zoom (config.zoom, default 1) as a *browser-style* zoom that always
    // fills the whole tile. The iframe is sized to (100/zoom)% and scaled by
    // `zoom`, so its painted size is exactly 100% of the container at EVERY zoom
    // (higher zoom → smaller CSS viewport → content bigger; lower → larger
    // viewport → more of the page). Percentage-based, so it fills regardless of
    // the tile's aspect or pixel size — at zoom = 1 it is a plain 100% with no
    // overflow at all. Identical for the landing board (inside the world-px
    // .bivouac-scaler) and DM cards (inside the card body).
    //
    // Clipping is DEFERRED to the screen-space body (.bivouac-widget__body /
    // .bivouac-card): those sit ABOVE the scaler + iframe transforms, so the
    // oversized iframe is clipped AFTER its transform. The immediate .bivouac-
    // webview must NOT clip, or it crops the logical iframe *before* the scale()
    // (that cropped the tile to half width — the bug this fixes).
    //
    // LegendKeeper-safe: the iframe's viewport (a % of the constant-size scaler)
    // and its own transform are CONSTANT per config; the per-frame map zoom rides
    // the .bivouac-scaler ANCESTOR. LK only ever broke on a *per-frame-changing*
    // iframe transform.
    const zoom = Number(ctx.widget.config.zoom) || 1;
    frame.style.transformOrigin = "0 0";
    frame.style.width = `${100 / zoom}%`;
    frame.style.height = `${100 / zoom}%`;
    frame.style.transform = `scale(${zoom})`;
    wrap.appendChild(frame);

    // Pop-out fallback for sites that refuse embedding.
    const popout = el("button", "bivouac-webview__popout");
    popout.type = "button";
    popout.title = game.i18n.localize("BIVOUAC.Widgets.Webview.Popout");
    popout.appendChild(el("i", "fa-solid fa-arrow-up-right-from-square"));
    popout.addEventListener("click", (e) => {
      e.stopPropagation();
      window.open(url, "_blank", "noopener");
    });
    wrap.appendChild(popout);
    return wrap;
  },
});
