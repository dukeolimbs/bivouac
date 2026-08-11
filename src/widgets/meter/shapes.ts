/** Bivouac — the five meter shapes. Each takes a sanitised `MeterState`, whether
 *  it is `live` (adjustable), and a `commit`, and returns its element. They read
 *  the model and never write it. */

import { el } from "../dom";
import { arcPath, polar, svgEl, svgPoint, svgRoot, svgText } from "../svg";
import { attachScrub, attachTick } from "./input";
import { fmtNum, fraction, pipTarget, snapMeter, type MeterCommit, type MeterState } from "./model";

/** Gauge — bar: a rounded track with a proportional fill and the number. */
export function meterBar(m: MeterState, live: boolean, commit: MeterCommit): HTMLElement {
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

export function meterDial(m: MeterState, live: boolean, commit: MeterCommit): SVGSVGElement {
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

export function meterCircle(m: MeterState, live: boolean, commit: MeterCommit): HTMLElement {
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
  if (m.icon) {
    const iconEl = el("i", `bivouac-meter__icon ${m.icon}`);
    // The centre overlay spans the whole ring box and stays click-through, or it
    // would swallow every segment click; only the glyph itself takes the pointer
    // (see `.bivouac-meter__icon` in the CSS). The icon had no behaviour before,
    // so tick-up replaces nothing.
    if (live) attachTick(iconEl, m, commit);
    centre.appendChild(iconEl);
  }
  if (m.showValue) centre.appendChild(el("span", "bivouac-meter__num", `${fmtNum(m.value)}/${n}`));
  if (m.icon && m.showValue) centre.classList.add("bivouac-meter__centre--both");
  if (centre.childElementCount) box.appendChild(centre);
  return box;
}

/** Sliding scale: min at one end, max at the other, a draggable handle between
 *  them carrying the current number. */
export function meterSlider(m: MeterState, live: boolean, commit: MeterCommit): HTMLElement {
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
    const t = fraction(v, m);
    fill.style.width = `${(t * 100).toFixed(2)}%`;
    // Publish the position as a 0..1 NUMBER rather than setting `left` directly:
    // the handle and its value badge both have to be inset by their own width at
    // the ends so they stay on the track (a badge centred on a handle at max ran
    // off the tile and was clipped by `.bivouac-widget__body`'s overflow, so "100"
    // read as "10"). Only CSS knows those widths — the badge's changes with the
    // digit count and the font-size setting — so the arithmetic belongs there.
    track.style.setProperty("--bivouac-meter-pos", t.toFixed(4));
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
export function meterPool(m: MeterState, live: boolean, commit: MeterCommit): HTMLElement {
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
