/** Bivouac — the meter's gestures: drag along a track, or click/right-click a
 *  target to tick. Both take a `commit` the caller supplies, so nothing here
 *  knows how a value is persisted. */

import { snapMeter, type MeterCommit, type MeterState } from "./model";

/** Click or drag along a horizontal track to set the value. The whole gesture
 *  previews locally and commits ONCE on release, so a drag is a single layout
 *  write rather than one per pointermove. Rects and clientX are both screen
 *  space, so this is correct under the world scaler's transform. */
export function attachScrub(
  track: HTMLElement,
  m: MeterState,
  preview: (value: number) => void,
  commit: MeterCommit,
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

/** Left-click ticks the value up by the meter's own step, right-click ticks it
 *  down. Wired to targets you can actually hit mid-session — the ring's centre
 *  icon and the meter's name — rather than a precise point on the gauge, which is
 *  fiddly and easy to overshoot by several.
 *
 *  Uses the CONFIGURED step, not 1: a meter that runs 0–1000 in tens would need a
 *  hundred clicks otherwise. `commit` clamps at the ends and reports whether the
 *  value actually moved, so a refused tick can bump instead of silently looking
 *  like a tick that landed. */
export function attachTick(target: HTMLElement, m: MeterState, commit: MeterCommit): void {
  target.classList.add("bivouac-meter__tick");
  const tick = (dir: number, e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    if (commit(m.value + dir * m.step)) return;
    // Already at min/max. Restart the animation explicitly — without the reflow
    // a second refused click on an element that still carries the class does
    // nothing at all, which is the exact ambiguity this is here to remove.
    target.classList.remove("bivouac-meter__tick--bump");
    void target.offsetWidth;
    target.classList.add("bivouac-meter__tick--bump");
  };
  target.addEventListener("click", (e) => tick(1, e));
  // The context menu has to be suppressed or Foundry's/the browser's opens over
  // the board on every tick down.
  target.addEventListener("contextmenu", (e) => tick(-1, e));
}
