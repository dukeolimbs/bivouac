/** Bivouac — widget type registry and renderers (webview / image / note). */

import {
  GRID,
  MODULE_ID,
  SETTINGS,
  TEXT_STROKE,
  cardsCanControl,
  type Widget,
  type WidgetBackground,
  type WidgetFrame,
  type WidgetInteraction,
  type WidgetType,
} from "./constants";
import { isDocDrag, parseDrop } from "./drop";
import { formatStat, visibleStats } from "./systems";

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
  if (b === "none" || b === "solid" || b === "frosted" || b === "gradient" || b === "image") return b;
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
 *  the Solid / Frosted / Gradient styles (`--bivouac-bg-fill` / `-fill2`) and the
 *  Image style (`--bivouac-bg-image` + `--bivouac-bg-opacity`). Defaults to the
 *  dark panel at 0.4. */
export function applyBackground(el: HTMLElement, widget: Widget): void {
  const raw = Number(widget.config.bgOpacity);
  const opacity = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.4;
  const c1 = typeof widget.config.bgColor === "string" ? widget.config.bgColor : "#101219";
  const c2 = typeof widget.config.bgColor2 === "string" ? widget.config.bgColor2 : c1;
  el.style.setProperty("--bivouac-bg-fill", hexToRgba(c1, opacity));
  el.style.setProperty("--bivouac-bg-fill2", hexToRgba(c2, opacity));
  // Image fill: raw opacity (applied to the image layer) + the image URL.
  el.style.setProperty("--bivouac-bg-opacity", String(opacity));
  const img = typeof widget.config.bgImage === "string" ? widget.config.bgImage.trim() : "";
  el.style.setProperty("--bivouac-bg-image", img ? `url("${img.replace(/"/g, "%22")}")` : "none");
}

/** Apply an optional per-tile text colour (`config.textColor`, a #rrggbb) via the
 *  `--bivouac-text-color` var that text tiles inherit. Empty → theme default. */
export function applyTextColor(el: HTMLElement, widget: Widget): void {
  const c = typeof widget.config.textColor === "string" ? widget.config.textColor : "";
  if (/^#[0-9a-fA-F]{6}$/.test(c)) el.style.setProperty("--bivouac-text-color", c);
  else el.style.removeProperty("--bivouac-text-color");
}

/** Write the text-stroke vars on an element. Switching it OFF has to null the
 *  COLOUR, not just the width: the outline is a ring of glyph copies (see the
 *  text-stroke block in module.css), and at width 0 those copies sit exactly
 *  behind the glyph, where they would still show through its antialiased edge
 *  pixels and subtly bolden the text. */
export function setTextStrokeVars(el: HTMLElement, on: boolean, width: number): void {
  el.style.setProperty("--bivouac-text-stroke", on ? `${width}px` : "0px");
  if (on) el.style.removeProperty("--bivouac-text-stroke-color"); // fall back to the themed default
  else el.style.setProperty("--bivouac-text-stroke-color", "transparent");
}

/** The configured stroke width in px, clamped to the slider's bounds. */
export function textStrokeWidth(): number {
  const w = Number(game.settings.get(MODULE_ID, SETTINGS.textStrokeWidth) ?? TEXT_STROKE.default);
  if (!Number.isFinite(w)) return TEXT_STROKE.default;
  return Math.min(TEXT_STROKE.max, Math.max(TEXT_STROKE.min, w));
}

/** Apply a tile's text-stroke override (`config.textStroke`). Tri-state, because
 *  a plain boolean couldn't express "follow the world default":
 *   • `""`    — inherit `--bivouac-text-stroke` from the world setting;
 *   • `"off"` — pin the width to 0 (and the colour to transparent) on this tile,
 *               switching off every stroke rule inside it;
 *   • `"on"`  — force the configured width AND apply the outline at the tile root,
 *               so it inherits into prose and enriched document HTML (which the
 *               default rules deliberately leave alone). */
export function applyTextStroke(el: HTMLElement, widget: Widget): void {
  const mode = String(widget.config.textStroke ?? "");
  el.classList.toggle("bivouac-stroke-on", mode === "on");
  if (mode === "off") setTextStrokeVars(el, false, 0);
  else if (mode === "on") setTextStrokeVars(el, true, textStrokeWidth());
  else {
    el.style.removeProperty("--bivouac-text-stroke");
    el.style.removeProperty("--bivouac-text-stroke-color");
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

/* -------------------------------------------- fonts --------------------- */

/** Font families Foundry already knows about (core + any the GM added via
 *  "Manage Fonts", which is where Google Fonts get registered natively). Used to
 *  populate the note font dropdown. Defensive across Foundry versions. */
export function availableFonts(): string[] {
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
  if (out.size === 0) ["Signika", "Arial", "Times New Roman", "Courier New"].forEach((f) => out.add(f));
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** Lazily inject a Google Fonts stylesheet for a custom family name (once per
 *  family). Only used for the note's "custom font" field — dropdown fonts are
 *  already loaded by Foundry. */
const loadedGoogleFonts = new Set<string>();
export function ensureGoogleFont(family: string): void {
  const name = family.trim();
  if (!name) return;
  const key = name.toLowerCase();
  if (loadedGoogleFonts.has(key)) return;
  loadedGoogleFonts.add(key);
  const id = `bivouac-font-${key.replace(/[^a-z0-9]+/g, "-")}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@400;600;700&display=swap`;
  document.head.appendChild(link);
}

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
    // Per-note font: a custom Google Font name (loaded from the CDN) overrides
    // the dropdown pick (a font Foundry already has). Empty → tile default.
    const fontCustom = String(ctx.widget.config.fontCustom ?? "").trim();
    const family = fontCustom || String(ctx.widget.config.font ?? "").trim();
    if (family) {
      if (fontCustom) ensureGoogleFont(fontCustom);
      box.style.fontFamily = `"${family}", var(--font-primary, "Signika", sans-serif)`;
    }
    // Show the raw HTML immediately, then enrich (document links, inline rolls,
    // etc.) asynchronously and swap it in.
    box.innerHTML = html;
    void enrichNote(box, html);
    return box;
  },
});

/* -------------------------------------------- meter --------------------- */

/** Meter display styles. `bar` and `dial` are the two Gauge shapes (a linear
 *  fill and an arc + needle); `circle` is a segmented clock, `slider` a scale
 *  with a draggable handle, and `pool` a spread of tokens. */
export const METER_KINDS = ["bar", "dial", "circle", "slider", "pool"] as const;
export type MeterKind = (typeof METER_KINDS)[number];

/** The counting styles build one node per unit — a pip div, or a ring segment
 *  plus its hit arc — so a mistyped max needs a backstop or a stray keystroke
 *  builds tens of thousands of nodes and rebuilds them on every value change.
 *  512 is far above any real pool or clock while still cheap (~1k SVG nodes at
 *  the very top end). */
const METER_MAX_PIPS = 512;

/** A meter's sanitised, render-ready state. */
export interface MeterState {
  kind: MeterKind;
  label: string;
  min: number;
  max: number;
  value: number;
  step: number;
  color: string;
  trackColor: string;
  showValue: boolean;
  /** Font Awesome classes for the Circle style's centre icon (empty = none). */
  icon: string;
  /** Optional per-part text colours (#rrggbb; empty = inherit the tile's). */
  labelColor: string;
  numberColor: string;
  /** Per-part size multipliers on top of the automatic tile-relative sizing. */
  labelScale: number;
  numberScale: number;
  /** Label typeface: a font Foundry knows, or a Google Font name overriding it. */
  labelFont: string;
  labelFontCustom: string;
}

/** Styles that draw one node per unit — always whole numbers counted from 0. */
function isCounting(kind: MeterKind): boolean {
  return kind === "circle" || kind === "pool";
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hexOr(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

/** Trim a value to a short display string (no trailing float dust). */
function fmtNum(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Clamp a raw value onto a meter's range and snap it to its step. */
export function snapMeter(raw: number, m: MeterState): number {
  if (!Number.isFinite(raw)) return m.min;
  let v = Math.min(m.max, Math.max(m.min, raw));
  if (m.step > 0) v = m.min + Math.round((v - m.min) / m.step) * m.step;
  v = Math.min(m.max, Math.max(m.min, v));
  return Math.round(v * 1e6) / 1e6; // drop the float dust stepping leaves behind
}

/** Read + sanitise a meter tile's config. Counting styles (circle / pool) are
 *  forced to whole units from 0, since each unit is a drawn node. */
export function readMeter(config: Record<string, unknown>): MeterState {
  const kind = (METER_KINDS as readonly string[]).includes(String(config.meterKind))
    ? (String(config.meterKind) as MeterKind)
    : "bar";
  const counting = isCounting(kind);
  const min = counting ? 0 : num(config.min, 0);
  let max = num(config.max, counting ? 6 : 10);
  if (counting) max = Math.min(METER_MAX_PIPS, Math.max(1, Math.round(max)));
  else if (max <= min) max = min + 1;
  const m: MeterState = {
    kind,
    label: String(config.label ?? ""),
    min,
    max,
    value: min,
    step: counting ? 1 : Math.max(0, num(config.step, 1)),
    color: hexOr(config.color, "#d98b3a"),
    trackColor: hexOr(config.trackColor, "#101219"),
    showValue: config.showValue !== false,
    // Class list only — it lands in a className, never as markup.
    icon: String(config.icon ?? "").trim().replace(/[^\w\s-]/g, ""),
    labelColor: hexOr(config.labelColor, ""),
    numberColor: hexOr(config.numberColor, ""),
    labelScale: Math.min(3, Math.max(0.3, num(config.labelScale, 1))),
    numberScale: Math.min(3, Math.max(0.3, num(config.numberScale, 1))),
    labelFont: String(config.labelFont ?? "").trim(),
    labelFontCustom: String(config.labelFontCustom ?? "").trim(),
  };
  m.value = snapMeter(num(config.value, min), m);
  return m;
}

/** Clamp a value against a meter widget's stored config. Used by the surfaces
 *  that persist a change, so they validate exactly as the tile does. */
export function clampMeterValue(config: Record<string, unknown>, raw: number): number {
  return snapMeter(raw, readMeter(config));
}

/** How far along its range a value sits, 0–1. */
function fraction(value: number, m: MeterState): number {
  return m.max > m.min ? Math.min(1, Math.max(0, (value - m.min) / (m.max - m.min))) : 0;
}

/* --- SVG helpers (the dial and circle scale by viewBox, so they stay crisp
       at any tile size or map zoom without measuring anything). -------------- */

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function svgRoot(vbW: number, vbH: number): SVGSVGElement {
  return svgEl("svg", {
    class: "bivouac-meter__svg",
    viewBox: `0 0 ${vbW} ${vbH}`,
    preserveAspectRatio: "xMidYMid meet",
  });
}

function svgText(x: number, y: number, size: number, anchor: string, cls: string, content: string): SVGTextElement {
  const node = svgEl("text", {
    class: `bivouac-meter__svgtext ${cls}`.trim(),
    x,
    y,
    "font-size": size,
    "text-anchor": anchor,
  });
  node.textContent = content;
  return node;
}

/** Point on a circle. `deg` runs counter-clockwise from the +x axis with screen
 *  y flipped, so 90 is the top of the circle. */
function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

/** Path `d` for a circular arc sweeping clockwise (on screen) between angles. */
function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  const large = Math.abs(from - to) > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

/** Map client coords into an SVG's viewBox units. Derived from the element's
 *  bounding rect + the viewBox aspect (rather than getScreenCTM) so it stays
 *  correct under the board scaler's CSS transform. */
function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number, vbW: number, vbH: number): { x: number; y: number } {
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return { x: 0, y: 0 };
  const s = Math.min(r.width / vbW, r.height / vbH); // preserveAspectRatio: meet
  return {
    x: (clientX - r.left - (r.width - vbW * s) / 2) / s,
    y: (clientY - r.top - (r.height - vbH * s) / 2) / s,
  };
}

/** Click or drag along a horizontal track to set the value. The whole gesture
 *  previews locally and commits ONCE on release, so a drag is a single layout
 *  write rather than one per pointermove. Rects and clientX are both screen
 *  space, so this is correct under the world scaler's transform. */
function attachScrub(
  track: HTMLElement,
  m: MeterState,
  preview: (value: number) => void,
  commit: (value: number) => void,
): void {
  const valueAt = (clientX: number): number => {
    const r = track.getBoundingClientRect();
    const t = r.width > 0 ? (clientX - r.left) / r.width : 0;
    return snapMeter(m.min + t * (m.max - m.min), m);
  };
  track.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return; // leave right-drag to the canvas pan
    e.preventDefault();
    e.stopPropagation();
    let value = valueAt(e.clientX);
    preview(value);
    track.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent): void => {
      value = valueAt(ev.clientX);
      preview(value);
    };
    const onUp = (ev: PointerEvent): void => {
      track.releasePointerCapture(ev.pointerId);
      track.removeEventListener("pointermove", onMove);
      track.removeEventListener("pointerup", onUp);
      track.removeEventListener("pointercancel", onUp);
      commit(value);
    };
    track.addEventListener("pointermove", onMove);
    track.addEventListener("pointerup", onUp);
    track.addEventListener("pointercancel", onUp);
  });
}

/** Clicking node *i* fills up to it; clicking the topmost filled node again
 *  empties it — so a pool/clock can be stepped both ways with one gesture. */
function pipTarget(index: number, m: MeterState): number {
  return index + 1 === m.value ? index : index + 1;
}

/** Gauge — bar: a rounded track with a proportional fill and the number. */
function meterBar(m: MeterState, live: boolean, commit: (v: number) => void): HTMLElement {
  const bar = el("div", "bivouac-meter__bar");
  const fill = el("div", "bivouac-meter__fill");
  bar.appendChild(fill);
  const readout = m.showValue ? el("span", "bivouac-meter__num") : null;
  if (readout) bar.appendChild(readout);
  const show = (v: number): void => {
    fill.style.width = `${(fraction(v, m) * 100).toFixed(2)}%`;
    if (readout) readout.textContent = `${fmtNum(v)} / ${fmtNum(m.max)}`;
  };
  show(m.value);
  if (live) attachScrub(bar, m, show, commit);
  return bar;
}

/** Gauge — dial: a 240° arc with a needle, min/max end labels and the number.
 *  Click or drag anywhere on it to set the value from the angle. */
const DIAL = { vbW: 100, vbH: 78, cx: 50, cy: 46, r: 34, from: 210, sweep: 240 } as const;

function meterDial(m: MeterState, live: boolean, commit: (v: number) => void): SVGSVGElement {
  const { vbW, vbH, cx, cy, r, from, sweep } = DIAL;
  const svg = svgRoot(vbW, vbH);
  svg.appendChild(
    svgEl("path", {
      class: "bivouac-meter__arc bivouac-meter__arc--track",
      d: arcPath(cx, cy, r, from, from - sweep),
      "stroke-width": 10,
    }),
  );
  const valueArc = svgEl("path", { class: "bivouac-meter__arc bivouac-meter__arc--value", d: "", "stroke-width": 10 });
  const needle = svgEl("line", { class: "bivouac-meter__needle", x1: cx, y1: cy, x2: cx, y2: cy - r, "stroke-width": 3 });
  svg.append(valueArc, needle, svgEl("circle", { class: "bivouac-meter__hub", cx, cy, r: 4.5 }));
  // The dial's type is SVG, sized in viewBox units, so the size multiplier is
  // applied here rather than in CSS — and capped, since the root clips and an
  // over-scaled readout would simply be cut off.
  const ts = Math.min(1.8, m.numberScale);
  // End labels clear the arc's stroked ends (which reach y 68 at x 15.6–25.6).
  svg.appendChild(svgText(8, 75.5, 7 * ts, "start", "bivouac-meter__end", fmtNum(m.min)));
  svg.appendChild(svgText(92, 75.5, 7 * ts, "end", "bivouac-meter__end", fmtNum(m.max)));
  const readout = m.showValue ? svgText(cx, 68, 16 * ts, "middle", "bivouac-meter__big", "") : null;
  if (readout) svg.appendChild(readout);

  const show = (v: number): void => {
    const t = fraction(v, m);
    const angle = from - sweep * t;
    // A zero-length arc would still paint a dot through the round line cap.
    valueArc.setAttribute("d", t > 0.001 ? arcPath(cx, cy, r, from, angle) : "");
    const tip = polar(cx, cy, r * 0.7, angle);
    needle.setAttribute("x2", tip.x.toFixed(2));
    needle.setAttribute("y2", tip.y.toFixed(2));
    if (readout) readout.textContent = fmtNum(v);
  };
  show(m.value);

  if (live) {
    const valueAt = (clientX: number, clientY: number): number => {
      const p = svgPoint(svg, clientX, clientY, vbW, vbH);
      let deg = (Math.atan2(cy - p.y, p.x - cx) * 180) / Math.PI; // -180 … 180
      // The gap under the dial is centred on -90; anything past it belongs to
      // the min end, so lift that half back above 180 before measuring.
      if (deg < -90) deg += 360;
      return snapMeter(m.min + ((from - deg) / sweep) * (m.max - m.min), m);
    };
    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      let value = valueAt(e.clientX, e.clientY);
      show(value);
      svg.setPointerCapture(e.pointerId);
      const onMove = (ev: PointerEvent): void => {
        value = valueAt(ev.clientX, ev.clientY);
        show(value);
      };
      const onUp = (ev: PointerEvent): void => {
        svg.releasePointerCapture(ev.pointerId);
        svg.removeEventListener("pointermove", onMove);
        svg.removeEventListener("pointerup", onUp);
        svg.removeEventListener("pointercancel", onUp);
        commit(value);
      };
      svg.addEventListener("pointermove", onMove);
      svg.addEventListener("pointerup", onUp);
      svg.addEventListener("pointercancel", onUp);
    });
  }
  return svg;
}

/** Circle: a ring of `max` segments that fills CLOCKWISE FROM THE BOTTOM, with
 *  an optional icon (and/or the count) in the middle. Click a segment to fill up
 *  to it — a countdown clock. Drawn as stroked arcs with an angular gap between
 *  them, so few segments read as a broken ring and many read as dashes. */
// r leaves room inside the 100-unit viewBox for the hover glow and the wide hit
// arc — the SVG root clips, so anything past 50 from centre would be cut off.
const RING = { cx: 50, cy: 50, r: 39, stroke: 9, start: 270 } as const;

function meterCircle(m: MeterState, live: boolean, commit: (v: number) => void): HTMLElement {
  const n = Math.max(1, Math.round(m.max));
  const { cx, cy, r, stroke, start } = RING;
  const step = 360 / n;
  // Gap scaled to the segment: a floor so it stays visible on small segments, a
  // ceiling so it stays a gap on big ones — and the floor itself capped at 40%
  // of the step, so a many-segment ring can never have a gap wider than its own
  // segment (which would invert the arc). A lone segment is an unbroken ring.
  const gap = n === 1 ? 0 : Math.min(8, Math.max(step * 0.28, Math.min(2.5, step * 0.4)));
  const box = el("div", "bivouac-meter__ring");
  const svg = svgRoot(100, 100);
  for (let i = 0; i < n; i++) {
    // Clockwise on screen = decreasing angle, and 270 is the bottom of the ring.
    const from = start - i * step - gap / 2;
    const to = start - (i + 1) * step + gap / 2;
    const shape = (width: number): SVGElement =>
      n === 1
        ? svgEl("circle", { cx, cy, r, "stroke-width": width })
        : svgEl("path", { d: arcPath(cx, cy, r, from, to), "stroke-width": width });
    // Segment + its hit arc share a <g> so CSS can glow the arc the pointer is
    // over — the hit arc sits on top, so the segment never sees the hover
    // itself. Groups never overlap (each owns a distinct angular range).
    const g = svgEl("g", { class: "bivouac-meter__segwrap" });
    const seg = shape(stroke);
    seg.setAttribute("class", `bivouac-meter__seg${i < m.value ? " bivouac-meter__seg--on" : ""}`);
    g.appendChild(seg);
    if (live) {
      const hit = shape(stroke * 2.2);
      hit.setAttribute("class", "bivouac-meter__seghit");
      hit.addEventListener("click", (e) => {
        e.stopPropagation();
        commit(pipTarget(i, m));
      });
      g.appendChild(hit);
    }
    svg.appendChild(g);
  }
  box.appendChild(svg);

  // Centre overlay. The SVG is letterboxed by preserveAspectRatio, so the box
  // centre IS the ring centre — a plain absolute overlay lands on it.
  const centre = el("div", "bivouac-meter__centre");
  if (m.icon) centre.appendChild(el("i", `bivouac-meter__icon ${m.icon}`));
  if (m.showValue) centre.appendChild(el("span", "bivouac-meter__num", `${fmtNum(m.value)}/${n}`));
  if (m.icon && m.showValue) centre.classList.add("bivouac-meter__centre--both");
  if (centre.childElementCount) box.appendChild(centre);
  return box;
}

/** Sliding scale: min at one end, max at the other, a draggable handle between
 *  them carrying the current number. */
function meterSlider(m: MeterState, live: boolean, commit: (v: number) => void): HTMLElement {
  const box = el("div", "bivouac-meter__slider");
  const track = el("div", "bivouac-meter__track");
  const fill = el("div", "bivouac-meter__fill");
  const handle = el("div", "bivouac-meter__handle");
  const bubble = m.showValue ? el("span", "bivouac-meter__bubble") : null;
  if (bubble) handle.appendChild(bubble);
  track.append(fill, handle);
  const ends = el("div", "bivouac-meter__ends");
  ends.append(el("span", undefined, fmtNum(m.min)), el("span", undefined, fmtNum(m.max)));
  box.append(track, ends);

  const show = (v: number): void => {
    const pct = (fraction(v, m) * 100).toFixed(2);
    fill.style.width = `${pct}%`;
    handle.style.left = `${pct}%`;
    if (bubble) bubble.textContent = fmtNum(v);
  };
  show(m.value);
  if (live) attachScrub(track, m, show, commit);
  return box;
}

/** Size a pool's pips to the tile: pick the column count that yields the
 *  largest pip still fitting the box (same idea as the card fan's auto-fit).
 *  Layout px, so it's independent of the map zoom the scaler applies. */
function layoutPips(box: HTMLElement, n: number): void {
  const w = box.clientWidth;
  const h = box.clientHeight;
  if (!box.isConnected || w < 2 || h < 2) return;
  // The box is sized by its tile (full width, flexed height), never by its pips
  // — but bail on an unchanged size anyway so a resize can never feed back into
  // another resize and walk the pips down to nothing.
  const key = `${Math.round(w)}x${Math.round(h)}`;
  if (box.dataset.pipfit === key) return;
  box.dataset.pipfit = key;
  let best = { cols: n, size: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const size = Math.min(w / cols, h / Math.ceil(n / cols));
    if (size > best.size) best = { cols, size };
  }
  const gap = Math.max(1, best.size * 0.14);
  box.style.setProperty("--bivouac-pip", `${Math.max(2, best.size - gap)}px`);
  box.style.setProperty("--bivouac-pip-gap", `${gap}px`);
  box.style.gridTemplateColumns = `repeat(${best.cols}, var(--bivouac-pip))`;
}

/** Token pool: `max` pips, filled to `value`; click one to set the count. */
function meterPool(m: MeterState, live: boolean, commit: (v: number) => void): HTMLElement {
  const n = Math.max(1, Math.round(m.max));
  const box = el("div", "bivouac-meter__pool");
  for (let i = 0; i < n; i++) {
    const pip = el("div", `bivouac-meter__pip${i < m.value ? " bivouac-meter__pip--on" : ""}`);
    if (live) {
      pip.addEventListener("click", (e) => {
        e.stopPropagation();
        commit(pipTarget(i, m));
      });
    }
    box.appendChild(pip);
  }
  // renderBody runs before the tile is inserted, and a DM card can be built
  // while its drawer is closed — so size the pips from a ResizeObserver (which
  // also fires once on observe) rather than a one-shot measurement.
  const ro = new ResizeObserver(() => {
    if (box.isConnected) layoutPips(box, n);
    else ro.disconnect(); // the tile was rebuilt or removed
  });
  ro.observe(box);
  return box;
}

/** Meter tile: one number, drawn as a gauge (bar or dial), a segmented circle,
 *  a sliding scale, or a pool of tokens. The value lives in `config.value` and
 *  adjustments are dispatched as a bubbling `bivouac-meter-set` event that the
 *  host surface (world layer / DM screen) persists. */
registerWidgetType({
  type: "meter",
  label: "BIVOUAC.Widgets.Meter.Label",
  icon: "fa-solid fa-gauge-high",
  defaultConfig: () => ({
    meterKind: "bar",
    label: "",
    min: 0,
    max: 10,
    value: 0,
    step: 1,
    color: "#d98b3a",
    trackColor: "#101219",
    showValue: true,
    icon: "",
    labelColor: "",
    numberColor: "",
    labelScale: 1,
    numberScale: 1,
    labelFont: "",
    labelFontCustom: "",
    editRole: 0,
  }),
  renderBody(ctx) {
    const m = readMeter(ctx.widget.config);
    // Adjustable in normal play only — in edit mode clicks belong to selecting
    // and dragging the tile. Who may adjust is the tile's own role gate.
    const live = !ctx.editMode && cardsCanControl(ctx.widget.config);
    const wrap = el("div", `bivouac-meter bivouac-meter--${m.kind}${live ? " bivouac-meter--live" : ""}`);
    wrap.style.setProperty("--bivouac-meter-fill", m.color);
    wrap.style.setProperty("--bivouac-meter-track", m.trackColor);
    // Per-part text colours; unset ones fall through to the tile's text colour.
    if (m.labelColor) wrap.style.setProperty("--bivouac-meter-label-color", m.labelColor);
    if (m.numberColor) wrap.style.setProperty("--bivouac-meter-num-color", m.numberColor);
    wrap.style.setProperty("--bivouac-meter-label-scale", String(m.labelScale));
    wrap.style.setProperty("--bivouac-meter-num-scale", String(m.numberScale));
    const commit = (value: number): void => {
      const next = snapMeter(value, m);
      if (next === m.value) return;
      wrap.dispatchEvent(
        new CustomEvent("bivouac-meter-set", { bubbles: true, detail: { id: ctx.widget.id, value: next } }),
      );
    };

    if (m.label) {
      const labelEl = el("span", "bivouac-meter__label", m.label);
      // A custom Google Font name (loaded on demand) beats the dropdown pick,
      // exactly as the note tile's font fields work.
      const family = m.labelFontCustom || m.labelFont;
      if (family) {
        if (m.labelFontCustom) ensureGoogleFont(m.labelFontCustom);
        labelEl.style.fontFamily = `"${family}", var(--font-primary, "Signika", sans-serif)`;
      }
      wrap.appendChild(labelEl);
    }
    const body = el("div", "bivouac-meter__body");
    switch (m.kind) {
      case "bar":
        body.appendChild(meterBar(m, live, commit));
        break;
      case "dial":
        body.appendChild(meterDial(m, live, commit));
        break;
      case "circle":
        body.appendChild(meterCircle(m, live, commit));
        break;
      case "slider":
        body.appendChild(meterSlider(m, live, commit));
        break;
      case "pool":
        body.appendChild(meterPool(m, live, commit));
        // The pips carry no number of their own, so caption them.
        if (m.showValue) body.appendChild(el("span", "bivouac-meter__num", `${fmtNum(m.value)} / ${fmtNum(m.max)}`));
        break;
    }
    wrap.appendChild(body);
    return wrap;
  },
});

/* -------------------------------------------- document tiles ------------ */

/** Does this widget reference the given document UUID (for targeted refresh)? */
export function refsUuid(widget: Widget, uuid: string): boolean {
  if (widget.config?.uuid === uuid) return true;
  const many = widget.config?.uuids;
  if (Array.isArray(many) && many.includes(uuid)) return true;
  const cards = widget.config?.cards;
  return Array.isArray(cards) && cards.some((c) => (c as { uuid?: string })?.uuid === uuid);
}

/** Apply a card-collection op (add / remove / move) to a widget config, returning
 *  the new config (or null if it's a no-op). Cards are `{ cid, uuid }` so the same
 *  document can appear multiple times and each instance is addressed by `cid`.
 *  Shared by the world layer and DM screen. */
export function applyCardOp(
  config: Record<string, unknown>,
  detail: { op?: string; uuid?: string; cid?: string; targetCid?: string; after?: boolean },
): Record<string, unknown> | null {
  const list: { cid: string; uuid: string }[] = Array.isArray(config.cards)
    ? (config.cards as { cid: string; uuid: string }[]).map((c) => ({ cid: c.cid, uuid: c.uuid }))
    : Array.isArray(config.uuids)
      ? (config.uuids as string[]).map((u) => ({ cid: u, uuid: u })) // legacy migration
      : [];
  const { op, uuid, cid, targetCid, after } = detail;
  if (op === "add" && uuid) {
    list.push({ cid: foundry.utils.randomID(), uuid });
  } else if (op === "remove" && cid) {
    const i = list.findIndex((c) => c.cid === cid);
    if (i < 0) return null;
    list.splice(i, 1);
  } else if (op === "move" && cid) {
    const from = list.findIndex((c) => c.cid === cid);
    if (from < 0) return null;
    const [moved] = list.splice(from, 1);
    const ti = targetCid ? list.findIndex((c) => c.cid === targetCid) : -1;
    if (ti < 0) list.push(moved);
    else list.splice(ti + (after ? 1 : 0), 0, moved);
  } else {
    return null;
  }
  const next = { ...config, cards: list };
  delete (next as { uuids?: unknown }).uuids;
  return next;
}

/** Can the current user at least see this document? Doc tiles render a quiet
 *  "restricted" placeholder for users below LIMITED permission, so a shared tile
 *  never leaks GM-only content. */
export function canView(doc: unknown): boolean {
  const d = doc as { testUserPermission?: (u: unknown, p: string) => boolean } | null;
  try {
    return d?.testUserPermission ? d.testUserPermission(game.user, "LIMITED") : true;
  } catch {
    return true;
  }
}

/** Shared scaffold for a document-backed tile: resolve `config.uuid`, gate on
 *  permission, then hand the live document to `fill`. Renders synchronously with
 *  a placeholder and swaps in the resolved view. */
function docBody(ctx: RenderContext, fill: (doc: Record<string, unknown>, host: HTMLElement) => void): HTMLElement {
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
function journalHtml(doc: Record<string, unknown>): string {
  const asPage = (doc.text as { content?: string } | undefined)?.content;
  if (typeof asPage === "string") return asPage;
  const pages = (doc.pages as { contents?: { type?: string; text?: { content?: string } }[] } | undefined)?.contents;
  const text = pages?.find((p) => p.type === "text")?.text?.content;
  return typeof text === "string" ? text : "";
}

/** Actor / Item card: portrait art + name; click opens the sheet (view mode). */
registerWidgetType({
  type: "actor",
  label: "BIVOUAC.Widgets.Actor.Label",
  icon: "fa-solid fa-user",
  defaultConfig: () => ({ uuid: "" }),
  renderBody(ctx) {
    return docBody(ctx, (doc, host) => {
      const box = el("div", "bivouac-actorcard");
      const img = document.createElement("img");
      img.className = "bivouac-actorcard__img";
      img.src = docImg(doc);
      img.alt = String(doc.name ?? "");
      box.appendChild(img);
      box.appendChild(el("span", "bivouac-actorcard__name", String(doc.name ?? "")));
      if (!ctx.editMode) {
        box.classList.add("bivouac-interactive");
        box.addEventListener("click", () => (doc.sheet as { render?: (b: boolean) => void })?.render?.(true));
      }
      host.replaceChildren(box);
    });
  },
});

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
        if (!ctx.editMode) {
          box.classList.add("bivouac-interactive");
          box.addEventListener("click", () => (doc.sheet as { render?: (b: boolean) => void })?.render?.(true));
        }
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

/** Rollable table tile: a scrollable list of the table's entries + a Roll button.
 *  Rolling draws normally (posts to chat, so Dice So Nice etc. animate) and then
 *  highlights the matching result row and scrolls it into view. */
registerWidgetType({
  type: "table",
  label: "BIVOUAC.Widgets.Table.Label",
  icon: "fa-solid fa-dice-d20",
  defaultConfig: () => ({ uuid: "", textScale: 1 }),
  renderBody(ctx) {
    const scale = Number(ctx.widget.config.textScale) || 1;
    return docBody(ctx, (doc, host) => {
      const box = el("div", "bivouac-table");
      box.style.fontSize = `${(14 * Math.min(3, Math.max(0.4, scale))).toFixed(1)}px`;

      const header = el("div", "bivouac-table__header");
      header.appendChild(el("span", "bivouac-table__name", String(doc.name ?? "")));
      const roll = el("button", "bivouac-table__roll");
      roll.type = "button";
      roll.appendChild(el("i", "fa-solid fa-dice-d20"));
      roll.append(` ${String(doc.formula ?? "") || game.i18n.localize("BIVOUAC.Widgets.Table.Roll")}`);
      header.appendChild(roll);
      box.appendChild(header);

      const listEl = el("div", "bivouac-table__list");
      const results = ((doc.results as { contents?: unknown[] } | undefined)?.contents ?? []) as Record<
        string,
        unknown
      >[];
      const rows: HTMLElement[] = [];
      for (const rr of results) {
        const range = Array.isArray(rr.range) ? (rr.range as number[]) : [0, 0];
        const row = el("div", "bivouac-table__row");
        row.dataset.low = String(range[0]);
        row.dataset.high = String(range[1]);
        row.appendChild(el("span", "bivouac-table__range", range[0] === range[1] ? `${range[0]}` : `${range[0]}–${range[1]}`));
        const rimg = String(rr.img ?? rr.icon ?? "");
        if (rimg) {
          const im = document.createElement("img");
          im.className = "bivouac-table__thumb";
          im.src = rimg;
          row.appendChild(im);
        }
        row.appendChild(el("span", "bivouac-table__text", String(rr.text ?? rr.name ?? rr.description ?? "")));
        listEl.appendChild(row);
        rows.push(row);
      }
      box.appendChild(listEl);

      const settle = (total: number | undefined): void => {
        let hit: HTMLElement | undefined;
        for (const r of rows) {
          r.classList.remove("bivouac-table__row--cycling");
          const on = typeof total === "number" && total >= Number(r.dataset.low) && total <= Number(r.dataset.high);
          r.classList.toggle("bivouac-table__row--rolled", on && !hit);
          if (on && !hit) hit = r;
        }
        hit?.scrollIntoView({ block: "nearest" });
      };
      const doRoll = (): void => {
        if (!rows.length || roll.disabled) return;
        roll.disabled = true;
        rows.forEach((r) => r.classList.remove("bivouac-table__row--rolled"));
        // Kick off the real draw (posts to chat, so the dice roll / Dice So Nice
        // animate), and spin the on-tile highlight through the rows, decelerating,
        // before landing on the drawn result — like Foundry's own table popout.
        const draw = (doc.draw as (() => Promise<{ roll?: { total?: number } }>) | undefined)?.();
        const spinEnd = performance.now() + 1100;
        let delay = 55;
        let last = -1;
        const tick = (): void => {
          rows.forEach((r) => r.classList.remove("bivouac-table__row--cycling"));
          if (performance.now() < spinEnd) {
            let idx = last;
            if (rows.length > 1) while (idx === last) idx = Math.floor(Math.random() * rows.length);
            else idx = 0;
            last = idx;
            rows[idx].classList.add("bivouac-table__row--cycling");
            rows[idx].scrollIntoView({ block: "nearest" });
            delay = Math.min(240, delay * 1.14);
            window.setTimeout(tick, delay);
          } else {
            void Promise.resolve(draw).then((res) => {
              settle(res?.roll?.total);
              roll.disabled = false;
            });
          }
        };
        tick();
      };
      roll.addEventListener("click", (e) => {
        e.stopPropagation();
        doRoll();
      });
      host.replaceChildren(box);
    });
  },
});

/** Macro tile: icon/name button that executes the macro. Icon + title can each
 *  be shown/hidden and sized. */
registerWidgetType({
  type: "macro",
  label: "BIVOUAC.Widgets.Macro.Label",
  icon: "fa-solid fa-scroll",
  defaultConfig: () => ({ uuid: "", showIcon: true, showTitle: true, iconSize: 48, titleSize: 14 }),
  renderBody(ctx) {
    const cfg = ctx.widget.config;
    const showIcon = cfg.showIcon !== false;
    const showTitle = cfg.showTitle !== false;
    const iconSize = Number(cfg.iconSize) || 48;
    const titleSize = Number(cfg.titleSize) || 14;
    return docBody(ctx, (doc, host) => {
      const box = el("div", "bivouac-doctile bivouac-macrotile");
      if (showIcon) {
        if (doc.img) {
          const im = document.createElement("img");
          im.className = "bivouac-macrotile__img";
          im.src = String(doc.img);
          im.style.width = `${iconSize}px`;
          im.style.height = `${iconSize}px`;
          box.appendChild(im);
        } else {
          const ic = el("i", "bivouac-doctile__icon fa-solid fa-scroll");
          ic.style.fontSize = `${iconSize}px`;
          box.appendChild(ic);
        }
      }
      if (showTitle) {
        const nm = el("span", "bivouac-doctile__name", String(doc.name ?? ""));
        nm.style.fontSize = `${titleSize}px`;
        box.appendChild(nm);
      }
      if (!ctx.editMode) {
        box.classList.add("bivouac-interactive");
        box.addEventListener("click", () => (doc.execute as (() => void) | undefined)?.());
      }
      host.replaceChildren(box);
    });
  },
});

/* -------------------------------------------- card collection ----------- */

/** Lay cards out as a curved hand that spans the tile's full width WITHOUT
 *  clipping. Cards rotate around their bottom-centre, so the end cards' corners
 *  swing out — we size the card and side/vertical margins from the *rotated*
 *  bounding box (at the end-card angle) so those corners always stay on-tile.
 *  Uses layout px (client), which are transform-independent → correct under the
 *  world scaler. */
function applyFan(hand: HTMLElement, cards: HTMLElement[]): void {
  const n = cards.length;
  if (!n) return;
  const W = hand.clientWidth || 1;
  const H = hand.clientHeight || 1;
  const ASPECT = 5 / 7; // card width : height
  const fanDeg = Math.min(56, n * 10); // total spread; end cards at ±fanDeg/2
  const phiMax = ((fanDeg / 2) * Math.PI) / 180; // rad
  const sinM = Math.sin(phiMax) || 1e-3;
  const cosM = Math.cos(phiMax);
  const tanHalf = Math.tan(phiMax / 2);
  const HOVER = 0.06 * H; // reserve headroom for the hover lift so a raised card (and its ×) stays on-tile
  const sideGap = 0.04 * W;
  const topGap = 0.02 * H;
  const botGap = 0.03 * H;
  // Cards sit on a circular arc (centre highest, ends symmetrically lower) and
  // rotate radially. Shrink the card until the whole arc — corners, the raised
  // centre card, and the hover lift — fits inside the tile.
  let cardH = 0.8 * H;
  let cardW = cardH * ASPECT;
  let spreadX = 0;
  let arcDepth = 0;
  let baseBottom = botGap;
  for (let k = 0; k < 16; k++) {
    cardW = cardH * ASPECT;
    const ex = (cardW / 2) * cosM + cardH * sinM; // rotated horizontal half-extent
    spreadX = Math.max(0, W / 2 - ex - sideGap); // end-card centre offset (fills width)
    arcDepth = spreadX * tanHalf; // true circular-arc rise from ends to centre
    baseBottom = (cardW / 2) * sinM + botGap; // clear the rotated bottom corner
    const topReach = baseBottom + arcDepth + cardH + HOVER; // centre card, raised, hovered
    if (topReach <= H - topGap) break;
    cardH *= 0.94;
  }
  cards.forEach((c, i) => {
    const s = n > 1 ? (2 * i) / (n - 1) - 1 : 0; // -1 … 1
    const phi = phiMax * s;
    const x = n > 1 ? spreadX * (Math.sin(phi) / sinM) : 0; // px from tile centre
    const lift = n > 1 ? (arcDepth * (Math.cos(phi) - cosM)) / (1 - cosM || 1) : 0;
    c.style.height = `${((cardH / H) * 100).toFixed(2)}%`;
    c.style.left = `calc(50% + ${x.toFixed(1)}px)`;
    c.style.bottom = `${(((baseBottom + lift) / H) * 100).toFixed(2)}%`;
    c.style.setProperty("--card-angle", `${((phi * 180) / Math.PI).toFixed(2)}deg`);
    c.style.zIndex = String(i + 1);
  });
}

/** A collection of documents shown as a hand of cards (fan / row / grid). Drop
 *  Actors or Items onto it to add them; a card opens its sheet (if permitted).
 *  Card add/remove is dispatched as a bubbling `bivouac-card-op` event the host
 *  surface (world layer / DM screen) persists. */
const REORDER_TYPE = "application/x-bivouac-card"; // drag marker for in-hand reorder

/** Forgiving in-hand reorder: handled at the hand level so it works across the
 *  whole tile (gaps and overlaps alike). Continuously tracks the nearest card
 *  to the pointer and shows a before/after marker there; on drop, moves the
 *  dragged card to that spot. */
function attachHandReorder(
  hand: HTMLElement,
  cards: HTMLElement[],
  emit: (op: string, detail: Record<string, unknown>) => void,
): void {
  const clear = (): void =>
    cards.forEach((c) => c.classList.remove("bivouac-cards__card--before", "bivouac-cards__card--after"));
  const nearest = (clientX: number): { cid: string; after: boolean } | null => {
    let best: HTMLElement | null = null;
    let bestD = Infinity;
    let after = false;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const d = Math.abs(clientX - cx);
      if (d < bestD) {
        bestD = d;
        best = c;
        after = clientX > cx;
      }
    }
    return best?.dataset.cid ? { cid: best.dataset.cid, after } : null;
  };
  hand.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes(REORDER_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    const t = nearest(e.clientX);
    clear();
    if (t) {
      cards.find((c) => c.dataset.cid === t.cid)?.classList.add(
        t.after ? "bivouac-cards__card--after" : "bivouac-cards__card--before",
      );
      hand.dataset.rt = t.cid;
      hand.dataset.ra = t.after ? "1" : "0";
    }
  });
  hand.addEventListener("dragleave", clear);
  hand.addEventListener("drop", (e) => {
    const cid = e.dataTransfer?.getData(REORDER_TYPE);
    clear();
    if (!cid) return;
    e.preventDefault();
    e.stopPropagation();
    const targetCid = hand.dataset.rt;
    if (targetCid) emit("move", { cid, targetCid, after: hand.dataset.ra === "1" });
  });
}

registerWidgetType({
  type: "cards",
  label: "BIVOUAC.Widgets.Cards.Label",
  icon: "fa-solid fa-id-badge",
  defaultConfig: () => ({ cards: [], layout: "fan", art: "portrait", showNames: true, nameSize: 12, nameFont: "", showToAll: false }),
  renderBody(ctx) {
    const cfg = ctx.widget.config;
    const layout = ["fan", "row", "grid"].includes(String(cfg.layout)) ? String(cfg.layout) : "fan";
    const art = cfg.art === "token" ? "token" : "portrait";
    const showNames = cfg.showNames !== false;
    const nameSize = Number(cfg.nameSize) || 12;
    const nameFont = String(cfg.nameFont ?? "");
    const showToAll = cfg.showToAll === true; // reveal cards even to viewers who don't own the doc
    const control = cardsCanControl(cfg);
    // Whether to show the arrange affordances (reorder + remove). GMs manage via
    // edit mode; players have no edit mode, so they get them in normal play as
    // long as they have control permission for this collection.
    const manage = control && (ctx.editMode || !game.user?.isGM);
    const wrap = el("div", `bivouac-cards bivouac-cards--${layout}`);
    const emit = (op: string, detail: Record<string, unknown>): void => {
      wrap.dispatchEvent(new CustomEvent("bivouac-card-op", { bubbles: true, detail: { id: ctx.widget.id, op, ...detail } }));
    };

    // Drop Actors / Items onto the collection to add them (controllers only).
    // In-hand reorder drags carry REORDER_TYPE and are handled by the cards.
    wrap.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types.includes(REORDER_TYPE)) return;
      if (!control || !isDocDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      wrap.classList.add("bivouac-cards--dropok");
    });
    wrap.addEventListener("dragleave", () => wrap.classList.remove("bivouac-cards--dropok"));
    wrap.addEventListener("drop", (e) => {
      wrap.classList.remove("bivouac-cards--dropok");
      if (e.dataTransfer?.types.includes(REORDER_TYPE) || !control) return;
      const data = parseDrop(e);
      if (!data || (data.type !== "Actor" && data.type !== "Item")) return;
      e.preventDefault();
      e.stopPropagation();
      emit("add", { uuid: data.uuid }); // duplicates allowed — each add is a distinct card
    });

    // Normalise the collection ({ cid, uuid }); migrate any legacy config.uuids.
    const list: { cid: string; uuid: string }[] = Array.isArray(cfg.cards)
      ? (cfg.cards as { cid: string; uuid: string }[])
      : Array.isArray(cfg.uuids)
        ? (cfg.uuids as string[]).map((u) => ({ cid: u, uuid: u }))
        : [];
    if (!list.length) {
      wrap.appendChild(placeholder("fa-solid fa-id-badge", game.i18n.localize("BIVOUAC.Widgets.Cards.Empty")));
      return wrap;
    }
    const hand = el("div", "bivouac-cards__hand");
    wrap.appendChild(hand);
    void (async () => {
      const built: HTMLElement[] = [];
      // Controllers (and "show to all") see every card so they can arrange the
      // whole collection; otherwise a viewer only sees cards they can view.
      const seeAll = showToAll || control;
      for (const entry of list) {
        const doc = (await fromUuid(entry.uuid).catch(() => null)) as Record<string, unknown> | null;
        if (!doc || (!seeAll && !canView(doc))) continue;
        const card = el("div", "bivouac-cards__card");
        card.dataset.cid = entry.cid;
        const img = document.createElement("img");
        img.className = "bivouac-cards__art";
        img.draggable = false; // the card div owns the drag, not the image
        const token = (doc.prototypeToken as { texture?: { src?: string } } | undefined)?.texture?.src;
        img.src = (art === "token" ? token || (doc.img as string) : (doc.img as string)) || "icons/svg/mystery-man.svg";
        img.alt = String(doc.name ?? "");
        card.appendChild(img);
        if (showNames) {
          const nm = el("span", "bivouac-cards__name", String(doc.name ?? ""));
          nm.style.fontSize = `${nameSize}px`;
          if (nameFont) nm.style.fontFamily = `"${nameFont}", var(--font-primary, "Signika", sans-serif)`;
          card.appendChild(nm);
        }
        // Draggable in every mode: dragging a card onto the scene carries standard
        // Foundry document data, so it makes a token in normal play and (via our
        // dropCanvasData hook) a tile in edit mode. In edit mode it also reorders
        // within the hand (REORDER_TYPE marker).
        const docType = String(doc.documentName ?? (entry.uuid.includes("Item") ? "Item" : "Actor"));
        card.draggable = control; // arranging (reorder + drag-out) is gated per-collection
        card.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          e.dataTransfer?.setData("text/plain", JSON.stringify({ type: docType, uuid: entry.uuid }));
          if (control) e.dataTransfer?.setData(REORDER_TYPE, entry.cid);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
          // Custom drag image: a small clean card-art proxy follows the cursor,
          // instead of the browser's default (a big, transformed ghost of the card).
          const ghost = document.createElement("img");
          ghost.src = img.src;
          ghost.style.cssText =
            "position:fixed;left:-9999px;top:-9999px;width:64px;height:90px;object-fit:cover;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.5);";
          document.body.appendChild(ghost);
          try {
            e.dataTransfer?.setDragImage(ghost, 32, 45);
          } catch {
            /* older browsers — fall back to the default */
          }
          window.setTimeout(() => ghost.remove(), 0);
          card.classList.add("bivouac-cards__card--dragging");
        });
        card.addEventListener("dragend", () => card.classList.remove("bivouac-cards__card--dragging"));
        // Outside edit mode a click opens the sheet (drag still reorders / drags out).
        if (!ctx.editMode) {
          card.classList.add("bivouac-interactive");
          card.addEventListener("click", () => (doc.sheet as { render?: (b: boolean) => void })?.render?.(true));
        }
        if (manage) {
          const rm = el("button", "bivouac-cards__remove");
          rm.type = "button";
          rm.title = game.i18n.localize("BIVOUAC.Widgets.Cards.Remove");
          rm.textContent = "×";
          rm.addEventListener("click", (e) => {
            e.stopPropagation();
            emit("remove", { cid: entry.cid });
          });
          card.appendChild(rm);
        }
        built.push(card);
      }
      hand.replaceChildren(...built);
      if (layout === "fan") applyFan(hand, built);
      if (manage) attachHandReorder(hand, built, emit);
    })();
    return wrap;
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

/* ------------------------------------------- mini character sheet ------- */

/**
 * Mini Sheet tile: portrait + name + the active system's core stats, plus an
 * area where Items dragged off a character sheet are PINNED so they can be
 * rolled straight from the board.
 *
 * Two deliberate reuses rather than new machinery:
 *  • Stats come from `visibleStats()`, the same adapter-driven, setting-gated
 *    list the Cast Bar plates use — so a Daggerheart sheet shows Hit Points /
 *    Stress / Hope without this tile knowing anything about either system.
 *  • Pins are stored in `config.cards` and mutated through the SAME bubbling
 *    `bivouac-card-op` event the card collection uses. The host handlers in
 *    `world-layer.ts` / `dm-screen.ts` already validate permission and persist
 *    it, and they key off the event, not the tile type — so add / remove /
 *    reorder all work here with no new persistence path.
 */
registerWidgetType({
  type: "minisheet",
  label: "BIVOUAC.Widgets.MiniSheet.Label",
  icon: "fa-solid fa-id-card",
  defaultConfig: () => ({ uuid: "", cards: [] }),
  renderBody(ctx) {
    const cfg = ctx.widget.config;
    // Pinning is an arrangement action, so it takes the same gate as arranging a
    // card collection (per-tile `editRole`, else the global control role).
    const control = cardsCanControl(cfg);
    const manage = control && (ctx.editMode || !game.user?.isGM);
    const emit = (op: string, detail: Record<string, unknown>): void => {
      box.dispatchEvent(
        new CustomEvent("bivouac-card-op", { bubbles: true, detail: { id: ctx.widget.id, op, ...detail } }),
      );
    };
    const box = el("div", "bivouac-mini");

    return docBody(ctx, (doc, host) => {
      box.replaceChildren();

      // --- identity: portrait + name + stats ---------------------------------
      const head = el("div", "bivouac-mini__head");
      const img = document.createElement("img");
      img.className = "bivouac-mini__img";
      img.src = docImg(doc);
      img.alt = String(doc.name ?? "");
      head.appendChild(img);

      const ident = el("div", "bivouac-mini__ident");
      ident.appendChild(el("span", "bivouac-mini__name", String(doc.name ?? "")));

      const stats = el("div", "bivouac-mini__stats");
      for (const { stat, val } of visibleStats(doc)) {
        const row = el("div", `bivouac-mini__stat bivouac-plate__stat--${stat.key}`);
        if (val.reverse) row.classList.add("bivouac-mini__stat--reverse");
        row.innerHTML = `<i class="fa-solid ${stat.icon}"></i><span></span>`;
        row.querySelector("span")!.textContent = formatStat(val);
        row.dataset.tooltip = game.i18n.localize(stat.label);
        stats.appendChild(row);
      }
      if (stats.childElementCount) ident.appendChild(stats);
      head.appendChild(ident);

      // The portrait opens the full sheet — this tile is a readout, not an editor,
      // so anything it doesn't show is one click away.
      if (!ctx.editMode) {
        head.classList.add("bivouac-interactive");
        head.addEventListener("click", () => (doc.sheet as { render?: (b: boolean) => void })?.render?.(true));
      }
      box.appendChild(head);

      // --- pinned features ---------------------------------------------------
      const pins = el("div", "bivouac-mini__pins");
      const list: { cid: string; uuid: string }[] = Array.isArray(cfg.cards)
        ? (cfg.cards as { cid: string; uuid: string }[])
        : [];

      if (control) {
        // Drop an Item onto the tile to pin it. Actors are refused here: this
        // tile already has one, and dropping a character onto it almost certainly
        // means "show this character", which is the config's job.
        pins.addEventListener("dragover", (e) => {
          if (!isDocDrag(e)) return;
          e.preventDefault();
          e.stopPropagation(); // else the board would take it and make a new tile
          if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
          pins.classList.add("bivouac-mini__pins--dropok");
        });
        pins.addEventListener("dragleave", () => pins.classList.remove("bivouac-mini__pins--dropok"));
        pins.addEventListener("drop", (e) => {
          pins.classList.remove("bivouac-mini__pins--dropok");
          const data = parseDrop(e);
          if (!data || data.type !== "Item") return;
          e.preventDefault();
          e.stopPropagation();
          emit("add", { uuid: data.uuid });
        });
      }

      if (!list.length) {
        pins.appendChild(
          el("p", "bivouac-mini__empty", game.i18n.localize(control ? "BIVOUAC.MiniSheet.Empty" : "BIVOUAC.MiniSheet.EmptyPlayer")),
        );
      }

      for (const pin of list) {
        const btn = el("button", "bivouac-mini__pin");
        btn.type = "button";
        const icon = document.createElement("img");
        icon.className = "bivouac-mini__pin-img";
        btn.appendChild(icon);
        const label = el("span", "bivouac-mini__pin-name", "…");
        btn.appendChild(label);

        // Resolve async so a compendium item doesn't block the tile rendering.
        void (async () => {
          const item = (await fromUuid(pin.uuid).catch(() => null)) as Record<string, unknown> | null;
          if (!item) {
            btn.classList.add("bivouac-mini__pin--missing");
            label.textContent = game.i18n.localize("BIVOUAC.Doc.Missing");
            return;
          }
          icon.src = docImg(item);
          label.textContent = String(item.name ?? "");
          btn.dataset.tooltip = String(item.name ?? "");
          // Rolling is gated by FOUNDRY's permission on the item, not by our
          // arrange role: being allowed to rearrange someone's board is not the
          // same as being allowed to use their abilities.
          if (!canView(item)) {
            btn.disabled = true;
            return;
          }
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            // `use()` is the modern path (dnd5e, Daggerheart); `roll()` is the
            // older one. Neither exists on a plain Item, hence the fallback chain.
            const it = item as { use?: () => unknown; roll?: () => unknown };
            if (typeof it.use === "function") void it.use();
            else if (typeof it.roll === "function") void it.roll();
            else (item.sheet as { render?: (b: boolean) => void })?.render?.(true);
          });
        })();

        if (manage) {
          const x = el("button", "bivouac-mini__unpin");
          x.type = "button";
          x.innerHTML = `<i class="fa-solid fa-xmark"></i>`;
          x.title = game.i18n.localize("BIVOUAC.MiniSheet.Unpin");
          x.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            emit("remove", { cid: pin.cid });
          });
          btn.appendChild(x);
        }
        pins.appendChild(btn);
      }
      box.appendChild(pins);
      host.replaceChildren(box);
    });
  },
});
