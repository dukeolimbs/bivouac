/** Bivouac — per-tile appearance: frame, background, text colour and the text
 *  outline. All of it works by writing CSS vars inline on a tile's root, so the
 *  look lives in `module.css` and this file only decides the values. Called from
 *  the shared style paths in both surfaces (world layer + DM screen). */

import {
  MODULE_ID,
  SETTINGS,
  TEXT_STROKE,
  type Widget,
  type WidgetBackground,
  type WidgetFrame,
} from "../constants";

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

/** How text is lifted off artwork: a hard outline (the default, and what shipped)
 *  or a soft outer halo, which reads cleaner over busy or light art and doesn't
 *  fight thin serifs. */
export type OutlineMode = "stroke" | "blur";

/** Blur-mode shaping, as multiples of the configured width. The width slider is a
 *  STROKE width, so reusing the number raw as a blur radius would look far softer
 *  than the same setting does as a stroke — these factors keep one number
 *  meaningful in both modes rather than silently changing what it means. Tuned so
 *  a mid-slider blur reads as about as "present" as a mid-slider stroke. */
const OUTLINE_BLUR = { blur: 1.5, ring: 0.35 } as const;

/** The world outline mode, for callers that don't have a per-tile override. */
export function textOutlineMode(): OutlineMode {
  return game.settings.get(MODULE_ID, SETTINGS.textOutlineMode) === "blur" ? "blur" : "stroke";
}

/** Write the text-stroke vars on an element. Switching it OFF has to null the
 *  COLOUR, not just the width: the outline is a ring of glyph copies (see the
 *  text-stroke block in module.css), and at width 0 those copies sit exactly
 *  behind the glyph, where they would still show through its antialiased edge
 *  pixels and subtly bolden the text. */
export function setTextStrokeVars(
  el: HTMLElement,
  on: boolean,
  width: number,
  mode: OutlineMode = "stroke",
): void {
  el.style.setProperty("--bivouac-text-stroke", on ? `${width}px` : "0px");
  if (!on) {
    el.style.setProperty("--bivouac-text-stroke-color", "transparent");
    return;
  }
  el.style.removeProperty("--bivouac-text-stroke-color"); // fall back to the themed default
  // A blur is the SAME ring with the copies softened and pulled in: one
  // declaration in the CSS drives both modes, rather than a second rendering
  // path. `ring` shrinks the offset (a hard ring's radius reads as a fat smudge
  // once blurred) and `blur` opens each copy up into a halo.
  const b = mode === "blur" ? OUTLINE_BLUR : null;
  el.style.setProperty("--bivouac-text-blur", b ? `${(width * b.blur).toFixed(2)}px` : "0px");
  el.style.setProperty("--bivouac-text-ring-scale", b ? String(b.ring) : "1");
  // Elements that compose their own drop shadow WITH the outline turn it off in
  // blur mode — two blurs stacked read as a smudge, which is exactly the failure
  // this mode exists to avoid.
  el.style.setProperty("--bivouac-text-shadow-a", b ? "0" : "");
}

/** The configured stroke width in px, clamped to the slider's bounds. */
export function textStrokeWidth(): number {
  const w = Number(game.settings.get(MODULE_ID, SETTINGS.textStrokeWidth) ?? TEXT_STROKE.default);
  if (!Number.isFinite(w)) return TEXT_STROKE.default;
  return Math.min(TEXT_STROKE.max, Math.max(TEXT_STROKE.min, w));
}

/** Apply a tile's text-outline override (`config.textStroke`). Four-state, and it
 *  can't be a boolean or even a tri-state any more:
 *   • `""`     — inherit the world setting (mode and width both);
 *   • `"off"`  — pin the width to 0 (and the colour to transparent) on this tile,
 *                switching off every outline rule inside it;
 *   • `"on"`   — force a hard STROKE at the configured width, and apply it at the
 *                tile root so it inherits into prose and enriched document HTML
 *                (which the default rules deliberately leave alone);
 *   • `"blur"` — the same, as a soft outer halo instead.
 *
 *  `"on"` deliberately keeps its old value rather than becoming `"stroke"`, so
 *  tiles saved before this existed keep the look they were given. */
export function applyTextStroke(el: HTMLElement, widget: Widget): void {
  const mode = String(widget.config.textStroke ?? "");
  const forced = mode === "on" || mode === "blur";
  el.classList.toggle("bivouac-stroke-on", forced);
  if (mode === "off") setTextStrokeVars(el, false, 0);
  else if (forced) setTextStrokeVars(el, true, textStrokeWidth(), mode === "blur" ? "blur" : "stroke");
  else {
    el.style.removeProperty("--bivouac-text-stroke");
    el.style.removeProperty("--bivouac-text-stroke-color");
    el.style.removeProperty("--bivouac-text-blur");
    el.style.removeProperty("--bivouac-text-ring-scale");
    el.style.removeProperty("--bivouac-text-shadow-a");
  }
}
