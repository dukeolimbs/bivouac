/** Bivouac — widget type registry and renderers (webview / image / note). */

import {
  GRID,
  WEBVIEW,
  MODULE_ID,
  type Widget,
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
    const frame = document.createElement("iframe");
    frame.className = "bivouac-webview__frame";
    frame.src = url;
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("loading", "lazy");

    // Consistent content scale: render the iframe at a logical resolution based
    // on the widget's square count, then scale it to fit. Same square-aspect →
    // same content magnification, independent of absolute pixel size.
    // Per-widget content zoom (config.zoom, default 1): higher renders the page
    // at fewer logical px so it appears larger; lower shows more of the page.
    const zoom = Number(ctx.widget.config.zoom) || 1;
    if (!ctx.fillContainer) {
      // Logical-resolution iframe: rendered at a fixed logical size and scaled
      // to fit at map scale 1. The map ZOOM is applied by the per-widget
      // .bivouac-scaler ancestor, so this transform is otherwise constant —
      // matching how the old scaled-world layer treated the iframe, which
      // embeds cleanly (a per-frame-changing iframe transform breaks some apps).
      const L = WEBVIEW.logicalPerSquare;
      frame.style.width = `${(ctx.widget.cell.gw * L) / zoom}px`;
      frame.style.height = `${(ctx.widget.cell.gh * L) / zoom}px`;
      frame.style.transformOrigin = "0 0";
      frame.style.transform = `scale(${(ctx.gridSize * zoom) / L})`;
    } else if (zoom !== 1) {
      // DM-screen fill mode: honor zoom by rendering at a larger logical area
      // and scaling it back to fill the card.
      frame.style.width = `${100 / zoom}%`;
      frame.style.height = `${100 / zoom}%`;
      frame.style.transformOrigin = "0 0";
      frame.style.transform = `scale(${zoom})`;
    }
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
    // GM-authored content; rendered as-is for MVP (enrichment comes later).
    // Fills its container (the .bivouac-scaler for landing widgets, or the card
    // for DM screen); zoom scaling is handled by that ancestor. On the landing
    // board the font scales with the tile size (cqmin) × this per-tile multiplier.
    box.innerHTML = html;
    box.style.setProperty("--bivouac-note-scale", String(Number(ctx.widget.config.textScale) || 1));
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
