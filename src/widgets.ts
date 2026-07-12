/** Bivouac — widget type registry and renderers (webview / image / note). */

import {
  GRID,
  WEBVIEW,
  MODULE_ID,
  type Widget,
  type WidgetBackground,
  type WidgetFrame,
  type WidgetInteraction,
  type WidgetType,
} from "./constants";

export interface RenderContext {
  widget: Widget;
  /** Pixel size of one scene grid square (for consistent web-view scaling). */
  gridSize: number;
  editMode: boolean;
  isGM: boolean;
  /** Show a lightweight placeholder instead of live content (LOD). */
  lod: boolean;
  /** Fill the container 1:1 rather than using world-space scaling (DM screen). */
  fillContainer?: boolean;
}

export interface WidgetTypeDef {
  type: WidgetType;
  label: string;
  icon: string;
  /** Build the widget's body content (the frame/chrome is added by the caller). */
  renderBody(ctx: RenderContext): HTMLElement;
  /** Default config for a freshly-created widget of this type. */
  defaultConfig(): Record<string, unknown>;
}

const registry = new Map<WidgetType, WidgetTypeDef>();

export function registerWidgetType(def: WidgetTypeDef): void {
  registry.set(def.type, def);
}

export function getWidgetType(type: WidgetType): WidgetTypeDef | undefined {
  return registry.get(type);
}

export function widgetTypes(): WidgetTypeDef[] {
  return [...registry.values()];
}

/* -------------------------------------------- helpers ------------------- */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Run a widget interaction against Foundry documents, honoring the user's permissions. */
export async function runInteraction(interaction: WidgetInteraction): Promise<void> {
  if (interaction.action === "none" || !interaction.uuid) return;
  const doc = await fromUuid(interaction.uuid);
  if (!doc) {
    ui.notifications?.warn(`${MODULE_ID}: linked document not found.`);
    return;
  }
  switch (interaction.action) {
    case "openSheet":
    case "openJournal":
      doc.sheet?.render(true);
      break;
    case "runMacro":
      doc.execute?.();
      break;
  }
}

/** Wire a widget's interactions onto a node. Each widget instance gets its own
 *  handlers, so any number of widgets can independently link to documents. */
export function attachInteractions(node: HTMLElement, widget: Widget): void {
  if (!widget.interactions?.length) return;
  node.classList.add("bivouac-interactive");
  for (const interaction of widget.interactions) {
    node.addEventListener(interaction.trigger, (event) => {
      event.stopPropagation();
      void runInteraction(interaction);
    });
  }
}

/** Convert `#rrggbb` + alpha (0–1) to an `rgba()` string. */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return `rgba(217, 139, 58, ${alpha})`; // fallback = accent orange
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

/** Resolve a tile's frame (border) style — `config.frame`, falling back to the
 *  legacy `chrome` for layouts saved before the frame/background split. */
export function frameOf(widget: Widget): WidgetFrame {
  const f = widget.config.frame;
  if (f === "none" || f === "subtle" || f === "framed") return f;
  return widget.chrome === "none" ? "none" : widget.chrome === "framed" ? "framed" : "subtle";
}

/** Resolve a tile's background (fill) style — `config.background`, falling back
 *  to the legacy `chrome` (none → none; subtle/framed → frosted). */
export function backgroundOf(widget: Widget): WidgetBackground {
  const b = widget.config.background;
  if (b === "none" || b === "solid" || b === "frosted" || b === "gradient") return b;
  return widget.chrome === "none" ? "none" : "frosted";
}

/** Apply a tile's frame colour/opacity to its EDGE (border + framed top accent)
 *  only — not the fill. Overrides the border CSS vars inline; defaults to the
 *  accent orange at 0.4 when unset. */
export function applyFrameStyle(el: HTMLElement, widget: Widget): void {
  const color = typeof widget.config.frameColor === "string" ? widget.config.frameColor : "#d98b3a";
  const raw = Number(widget.config.frameOpacity);
  const opacity = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.4;
  const edge = hexToRgba(color, opacity);
  el.style.setProperty("--bivouac-panel-border", edge);
  el.style.setProperty("--bivouac-frame-border", edge);
  el.style.setProperty("--bivouac-frame-accent", color);
}

/** Apply a tile's background colour/opacity to the fill CSS vars inline. Used by
 *  the Solid / Frosted / Gradient background styles (`--bivouac-bg-fill` and,
 *  for gradients, `--bivouac-bg-fill2`). Defaults to the dark panel at 0.4. */
export function applyBackground(el: HTMLElement, widget: Widget): void {
  const raw = Number(widget.config.bgOpacity);
  const opacity = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.4;
  const c1 = typeof widget.config.bgColor === "string" ? widget.config.bgColor : "#101219";
  const c2 = typeof widget.config.bgColor2 === "string" ? widget.config.bgColor2 : c1;
  el.style.setProperty("--bivouac-bg-fill", hexToRgba(c1, opacity));
  el.style.setProperty("--bivouac-bg-fill2", hexToRgba(c2, opacity));
}

function placeholder(icon: string, label: string): HTMLElement {
  const box = el("div", "bivouac-placeholder");
  box.appendChild(el("i", `bivouac-placeholder__icon ${icon}`));
  box.appendChild(el("span", "bivouac-placeholder__label", label));
  return box;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Enrich note HTML with Foundry's text enrichers (document @UUID links, inline
 *  [[/roll]]s, content links, etc.) and swap the result into the box. Clickable
 *  links/rolls work via Foundry's global delegated handlers on the document.
 *  Async, so the caller shows the raw HTML first; falls back to it on error. */
async function enrichNote(box: HTMLElement, html: string): Promise<void> {
  const TE = (foundry.applications?.ux?.TextEditor?.implementation ??
    foundry.applications?.ux?.TextEditor ??
    (globalThis as { TextEditor?: unknown }).TextEditor) as
    | { enrichHTML?: (h: string, o?: object) => Promise<string> }
    | undefined;
  if (!TE?.enrichHTML) return;
  try {
    box.innerHTML = await TE.enrichHTML(html, { secrets: !!game.user?.isGM });
  } catch {
    /* keep the raw-HTML fallback the caller already set */
  }
}

/* -------------------------------------------- webview ------------------- */

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
    const zoomBox = el("div", "bivouac-webview__zoom");
    const frame = document.createElement("iframe");
    frame.className = "bivouac-webview__frame";
    frame.src = url;
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("loading", "lazy");

    // Consistent content scale: the iframe renders at a logical resolution based
    // on the widget's square count, then scales to fit. Same square-aspect → same
    // content magnification, independent of absolute pixel size.
    //
    // Content zoom (config.zoom, default 1) — and the LegendKeeper invariant:
    // embedded apps like LK only stay healthy when the *iframe itself* matches
    // the known-good baseline (viewport gw·L, own transform scale(gs/L)). A
    // changing transform on an ANCESTOR is fine — that's exactly how map zoom
    // works, on .bivouac-scaler. So for zoom ≥ 1 we keep the iframe byte-
    // identical to the baseline and magnify on the .bivouac-webview__zoom
    // wrapper (crop-to-fill). Only zoom < 1 ("show more of the page") enlarges
    // the iframe's logical viewport — a *larger* viewport is LK-safe; a smaller
    // one is what used to crash it (`useMapContext … MapScope`).
    const zoom = Number(ctx.widget.config.zoom) || 1;
    const L = WEBVIEW.logicalPerSquare;
    if (!ctx.fillContainer) {
      frame.style.transformOrigin = "0 0";
      if (zoom < 1) {
        frame.style.width = `${(ctx.widget.cell.gw * L) / zoom}px`;
        frame.style.height = `${(ctx.widget.cell.gh * L) / zoom}px`;
        frame.style.transform = `scale(${(ctx.gridSize * zoom) / L})`;
      } else {
        frame.style.width = `${ctx.widget.cell.gw * L}px`;
        frame.style.height = `${ctx.widget.cell.gh * L}px`;
        frame.style.transform = `scale(${ctx.gridSize / L})`;
        if (zoom > 1) zoomBox.style.transform = `scale(${zoom})`;
      }
    } else if (zoom < 1) {
      // DM-screen fill: a bigger viewport shows more of the page.
      frame.style.transformOrigin = "0 0";
      frame.style.width = `${100 / zoom}%`;
      frame.style.height = `${100 / zoom}%`;
      frame.style.transform = `scale(${zoom})`;
    } else if (zoom > 1) {
      // DM-screen fill: iframe fills 100% (baseline); magnify on the wrapper.
      zoomBox.style.transform = `scale(${zoom})`;
    }
    zoomBox.appendChild(frame);
    wrap.appendChild(zoomBox);

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

/* -------------------------------------------- image --------------------- */

registerWidgetType({
  type: "image",
  label: "BIVOUAC.Widgets.Image.Label",
  icon: "fa-solid fa-image",
  defaultConfig: () => ({ src: "", fit: "cover" }),
  renderBody(ctx) {
    const src = String(ctx.widget.config.src ?? "").trim();
    if (!src) return placeholder("fa-solid fa-image", game.i18n.localize("BIVOUAC.Widgets.Image.Empty"));

    const wrap = el("div", "bivouac-image");
    const img = document.createElement("img");
    img.className = "bivouac-image__img";
    img.src = src;
    img.style.objectFit = String(ctx.widget.config.fit ?? "cover");
    img.alt = ctx.widget.title ?? "";
    wrap.appendChild(img);
    return wrap;
  },
});

/* -------------------------------------------- note ---------------------- */

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
    // Show the raw HTML immediately, then enrich (document links, inline rolls,
    // etc.) asynchronously and swap it in.
    box.innerHTML = html;
    void enrichNote(box, html);
    return box;
  },
});

/* -------------------------------------------- factory ------------------- */

/** Create a new widget of the given type with default geometry/config. */
export function createWidget(type: WidgetType, gx: number, gy: number): Widget {
  const def = getWidgetType(type);
  return {
    id: foundry.utils.randomID(),
    type,
    cell: { gx, gy, gw: GRID.defaultSize, gh: GRID.defaultSize },
    scope: "shared",
    chrome: "subtle",
    interactions: [],
    config: def ? def.defaultConfig() : {},
  };
}
