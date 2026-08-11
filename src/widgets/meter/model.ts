/** Bivouac — the meter's numbers.
 *
 *  Everything here is pure: config in, sanitised state and clamped values out. No
 *  DOM, no Foundry, no events — so the clamping, stepping and range rules can be
 *  reasoned about (and exercised) without a browser or a running Foundry. The
 *  drawing lives in `./shapes.ts`, the gestures in `./input.ts`. */

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
export function fmtNum(value: number): string {
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
export function fraction(value: number, m: MeterState): number {
  return m.max > m.min ? Math.min(1, Math.max(0, (value - m.min) / (m.max - m.min))) : 0;
}

/** Clicking node *i* fills up to it; clicking the topmost filled node again
 *  empties it — so a pool/clock can be stepped both ways with one gesture. */
export function pipTarget(index: number, m: MeterState): number {
  return index + 1 === m.value ? index : index + 1;
}

/**
 * How every meter shape asks for a new value.
 *
 * **The return value means "the value actually moved."** The tile's `commit`
 * snaps the request with `snapMeter` and compares it to the current value; when
 * they match — a drag that ended where it started, or a tick clamped at min/max —
 * it writes nothing and emits no event, and returns `false`.
 *
 * That distinction is load-bearing for `attachTick`, which uses it to tell a tick
 * that landed from one that was refused: a refused tick bumps rather than pulsing,
 * so hitting the ceiling looks different from success. Callers that don't care may
 * ignore it, but the type says `boolean` everywhere on purpose — declaring it
 * `void` at the call site (which is assignable, so it type-checks) hides a
 * meaningful result and invites the next person to drop the `return`.
 */
export type MeterCommit = (value: number) => boolean;
