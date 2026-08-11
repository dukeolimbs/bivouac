/** Bivouac — SVG helpers for the meter shapes (the dial and circle scale by
 *  viewBox, so they stay crisp at any tile size or map zoom without measuring
 *  anything). */

const SVG_NS = "http://www.w3.org/2000/svg";

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export function svgRoot(vbW: number, vbH: number): SVGSVGElement {
  return svgEl("svg", {
    class: "bivouac-meter__svg",
    viewBox: `0 0 ${vbW} ${vbH}`,
    preserveAspectRatio: "xMidYMid meet",
  });
}

export function svgText(x: number, y: number, size: number, anchor: string, cls: string, content: string): SVGTextElement {
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
export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

/** Path `d` for a circular arc sweeping clockwise (on screen) between angles. */
export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  const large = Math.abs(from - to) > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

/** Map client coords into an SVG's viewBox units. Derived from the element's
 *  bounding rect + the viewBox aspect (rather than getScreenCTM) so it stays
 *  correct under the board scaler's CSS transform. */
export function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number, vbW: number, vbH: number): { x: number; y: number } {
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return { x: 0, y: 0 };
  const s = Math.min(r.width / vbW, r.height / vbH); // preserveAspectRatio: meet
  return {
    x: (clientX - r.left - (r.width - vbW * s) / 2) / s,
    y: (clientY - r.top - (r.height - vbH * s) / 2) / s,
  };
}
