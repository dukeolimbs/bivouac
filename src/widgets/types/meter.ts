/** Bivouac — the meter tile: one number, drawn as a gauge (bar or dial), a
 *  segmented circle, a sliding scale, or a pool of tokens. The value lives in
 *  `config.value` and adjustments are dispatched as a bubbling `bivouac-meter-set`
 *  event that the host surface (world layer / DM screen) persists.
 *
 *  The arithmetic is in `../meter/model.ts`, the gestures in `../meter/input.ts`
 *  and the drawing in `../meter/shapes.ts`; this file is the wiring between them
 *  and the tile registry. */

import { cardsCanControl } from "../../constants";
import { el } from "../dom";
import { fontStack } from "../fonts";
import { attachTick } from "../meter/input";
import { fmtNum, readMeter, snapMeter, type MeterCommit } from "../meter/model";
import { meterBar, meterCircle, meterDial, meterPool, meterSlider } from "../meter/shapes";
import { registerWidgetType } from "../registry";

/** The value each meter tile was last RENDERED with, so a repaint can tell a real
 *  value change from an unrelated one and only pulse for the former. Both surfaces
 *  rebuild a tile on any layout write, so "did this render change the number?" is
 *  the only reliable trigger — pulsing on the click instead would animate a tick
 *  that was clamped away, and restart on every unrelated write. Keyed by widget
 *  id; a deleted tile leaves one stale number, which costs nothing. */
const meterLastValue = new Map<string, number>();

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
    /** The one implementation of `MeterCommit` (see `meter/model.ts` for what the
     *  return value means): true when the value actually moved, false when
     *  `snapMeter` clamped the request to the value we already had — in which
     *  case nothing is written and no event is emitted. */
    const commit: MeterCommit = (value) => {
      const next = snapMeter(value, m);
      if (next === m.value) return false;
      wrap.dispatchEvent(
        new CustomEvent("bivouac-meter-set", { bubbles: true, detail: { id: ctx.widget.id, value: next } }),
      );
      return true;
    };

    // Pulse when the NUMBER changed, not when a click happened — see
    // `meterLastValue`. The class is set before the element is mounted, so the
    // animation plays on insertion; it's dropped on `animationend` (which bubbles
    // up from the body) so a later repaint can't replay it.
    const prev = meterLastValue.get(ctx.widget.id);
    meterLastValue.set(ctx.widget.id, m.value);
    if (prev !== undefined && prev !== m.value) {
      wrap.classList.add(m.value > prev ? "bivouac-meter--up" : "bivouac-meter--down");
      wrap.addEventListener(
        "animationend",
        () => wrap.classList.remove("bivouac-meter--up", "bivouac-meter--down"),
        { once: true },
      );
    }

    if (m.label) {
      const labelEl = el("span", "bivouac-meter__label", m.label);
      // A custom Google Font name (loaded on demand) beats the dropdown pick,
      // exactly as the note tile's font fields work.
      const stack = fontStack(m.labelFont, m.labelFontCustom);
      if (stack) labelEl.style.fontFamily = stack;
      // The name is a tick target for every meter style. Only when `live`, which
      // already excludes edit mode (where a click on the label belongs to
      // selecting and dragging the tile) and anyone the tile's role gate refuses —
      // so on a tile you can't adjust, clicking the name still does nothing.
      if (live) attachTick(labelEl, m, commit);
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
