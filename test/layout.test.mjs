/**
 * Does a plate's chrome fit its plate, at every size tier and every plate shape?
 *
 * Mirrors the CSS geometry (CSS can't be executed here), so these must match
 * module.css and cast-bar.ts:
 *   --bivouac-ctrl-sz     clamp(16px, fit * 0.11, 22px)
 *   --bivouac-ctrl-h      ctrl-sz + 6
 *   --bivouac-name-line   clamp(10px, fit * 0.085, 17px)
 *   --bivouac-name-h      lines * 1.15 * name-line + 10   (lines = 1 at min)
 *   --bivouac-overlay-max 100% - ctrl-h - name-h - 4px
 *   controls              padding 3px, gap 2px, nowrap
 *   grip                  padding 0 3px, icon = ctrl-sz * 0.5
 *   stats / conds         max-width 46%, max-height overlay-max
 *   stat row              clamp(9px, fit*0.072, 14px) * 1.1, gap 1, padding 6
 *   cond icon             clamp(10px, fit*0.1, 22px), gap 2, WRAPS into columns
 *   insp star             INSIDE the name banner, so it adds no height at all
 *   plate                 height = fit, width = fit * aspect
 *   tier                  on min(width, height)
 */
const SHAPES = { portrait: 3 / 4, tarot: 2 / 3, square: 1, wide: 4 / 3 };
const BAR_PAD = 3 * 2;
const GAP = 2;

const ctrlSize = (fit) => Math.min(22, Math.max(16, fit * 0.11));
const ctrlH = (fit) => ctrlSize(fit) + 6;
const gripWidth = (fit) => ctrlSize(fit) * 0.5 + 6;

/** Buttons the ladder leaves per tier, excluding the grip:
 *  full = exit, combat, conds, menu; compact = exit, combat, menu;
 *  min = menu. */
const BUTTONS = { full: 4, compact: 3, min: 1, none: 0 };
const STAT_CAP = { full: 4, compact: 1, min: 0, none: 0 };
const COND_CAP = { full: 6, compact: 3, min: 0, none: 0 };
/* The inspiration star is NOT modelled, and that is the point of where it sits:
   it leads the name INSIDE the banner, whose height is already counted below, so
   it takes no column, no band and no tier of its own. It was briefly a badge in
   the bottom-left corner, which did have to be counted here — the sizes 83/84/85
   and 129/130/131/140 below were added to catch it at the two tier floors and are
   worth keeping for whatever lands in that column next. */

const TIER_MIN_W = { full: 110, compact: 78, min: 40 };
const TIER_MIN_H = { full: 130, compact: 84, min: 46 };
function tierFor(w, h) {
  for (const t of ["full", "compact", "min"])
    if (w >= TIER_MIN_W[t] && h >= TIER_MIN_H[t]) return t;
  return "none";
}

let fails = 0;
// 129/130 and 131 straddle the `full` tier floor on height, which is where the
// left column (stats + the inspiration badge) is at its tightest against the
// plate — the badge appears there and nowhere smaller.
const FITS = [
  24, 30, 40, 50, 60, 67, 68, 80, 83, 84, 85, 90, 100, 119, 120, 121, 129, 130, 131, 140, 150,
  180, 200, 260, 340, 520,
];

console.log("HORIZONTAL — the control bar against the plate width\n");
console.log("fit    shape      width   tier      needs   avail   verdict");
console.log("-".repeat(62));
for (const fit of FITS) {
  for (const [shape, aspect] of Object.entries(SHAPES)) {
    const width = fit * aspect;
    const tier = tierFor(width, fit);
    const n = BUTTONS[tier];
    const needs = n ? gripWidth(fit) + n * ctrlSize(fit) + n * GAP : 0;
    const avail = width - BAR_PAD;
    const ok = needs === 0 || needs <= avail;
    if (!ok) fails++;
    console.log(
      `${String(fit).padEnd(6)} ${shape.padEnd(10)} ${width.toFixed(0).padStart(5)}   ${tier.padEnd(8)} ${needs.toFixed(0).padStart(6)}  ${avail.toFixed(0).padStart(6)}   ${ok ? "fits" : "OVERFLOWS"}`,
    );
  }
}

console.log("\n\nVERTICAL — overlays (shifted clear of the hover bar) + name banner\n");
console.log(
  "fit   shape      tier      statsH  cols  condsH  condsW/max  nameH   used/fit   verdict",
);
console.log("-".repeat(88));
for (const fit of FITS) {
  for (const [shape, aspect] of Object.entries(SHAPES)) {
    const width = fit * aspect;
    const tier = tierFor(width, fit);
    const widthMax = 0.46 * width;

    const nameLine = Math.min(17, Math.max(10, fit * 0.085));
    const nameH = tier === "none" ? 0 : (tier === "min" ? 1 : 2) * 1.15 * nameLine + 10;
    const boxMax = fit - ctrlH(fit) - nameH - 4; // --bivouac-overlay-max

    const sc = STAT_CAP[tier];
    const rowH = Math.min(14, Math.max(9, fit * 0.072)) * 1.1;
    const statsWant = sc ? sc * rowH + (sc - 1) + 6 : 0;
    const statsH = Math.min(statsWant, Math.max(0, boxMax)); // clipped by max-height

    const cc = COND_CAP[tier];
    const icon = Math.min(22, Math.max(10, fit * 0.1));
    const perCol = Math.max(1, Math.floor((Math.max(0, boxMax) + 2) / (icon + 2)));
    const shown = Math.min(cc, perCol);
    const cols = cc ? Math.ceil(cc / perCol) : 0;
    const condsH = cc ? shown * icon + (shown - 1) * 2 : 0;
    const condsW = cols ? cols * icon + (cols - 1) * 2 : 0;

    // At tier `none` the bar, both columns and the banner are all display:none.
    const used = tier === "none" ? 0 : 4 + ctrlH(fit) + Math.max(statsH, condsH) + nameH;
    const hOk = used <= fit + 0.5;
    const wOk = condsW <= widthMax + 0.5;
    if (!hOk || !wOk) fails++;
    console.log(
      `${String(fit).padEnd(5)} ${shape.padEnd(10)} ${tier.padEnd(9)} ${statsH.toFixed(0).padStart(6)} ${String(cols).padStart(5)} ${condsH.toFixed(0).padStart(7)} ${(condsW.toFixed(0) + "/" + widthMax.toFixed(0)).padStart(11)} ${nameH.toFixed(0).padStart(6)} ${(used.toFixed(0) + "/" + fit).padStart(10)}   ${hOk ? (wOk ? "fits" : "TOO WIDE") : "TOO TALL"}`,
    );
  }
}

console.log(
  `\n${fails === 0 ? "PASS - nothing overflows at any tested size or shape" : `FAIL - ${fails} overflow(s)`}`,
);
if (fails) process.exitCode = 1;

/* ------------------------------------------------- condition palette ------ */
// Mirrors .bivouac-cond-picker + openConditionPalette():
//   --cond-size 30, --cond-gap 4, cols = clamp(3, ceil(sqrt(n * 1.6)), 8)
//   grid max-height = 8 * (size + gap);  .bivouac-pop max-width = min(340px, 90vw)
//   .bivouac-pop padding 8px each side; title ~20px
const SZ = 30, GP = 4, POP_PAD = 16, TITLE = 20, POP_MAX_W = 340;
const colsFor = (n) => Math.min(n, Math.max(3, Math.min(8, Math.ceil(Math.sqrt(n * 1.6)))));

console.log("\n\nCONDITION PALETTE — column count and panel size by effect count\n");
console.log(" n    cols  rows  vis  panel w   panel h   verdict");
console.log("-".repeat(56));
let palFails = 0;
for (const n of [1, 3, 6, 8, 12, 15, 20, 24, 28, 32, 40, 60, 80, 120]) {
  const cols = colsFor(n);
  const rows = Math.ceil(n / cols);
  const visRows = Math.min(rows, 8);
  const w = cols * SZ + (cols - 1) * GP + POP_PAD;
  const h = visRows * SZ + (visRows - 1) * GP + POP_PAD + TITLE;
  // Must fit the panel's own max-width, and must never be a single stripe.
  const wOk = w <= POP_MAX_W;
  const notStripe = n <= 1 || cols > 1;
  // Anything past 8 rows has to scroll rather than grow without bound.
  const scrolls = rows > 8;
  if (!wOk || !notStripe) { palFails++; fails++; }
  console.log(
    ` ${String(n).padEnd(4)} ${String(cols).padStart(4)} ${String(rows).padStart(5)} ${String(visRows).padStart(4)} ${(w + "px").padStart(8)} ${(h + "px").padStart(9)}   ${
      !wOk ? "TOO WIDE" : !notStripe ? "STRIPE" : scrolls ? "fits (scrolls)" : "fits"
    }`,
  );
}
console.log(
  `\n${palFails === 0 ? "PASS - palette never a single stripe, never wider than the panel" : `FAIL - ${palFails} palette problem(s)`}`,
);
