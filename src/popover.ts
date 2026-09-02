/**
 * Bivouac — the small floating panels that hang off a Cast Bar plate.
 *
 * Two things need one: the condition palette and the plate menu. They share
 * every piece of their mechanics and none of their content, so the mechanics
 * live here and each caller builds its own body.
 *
 * Why a floating panel and not something nested in the plate. A plate is roughly
 * 150×200px, it is clipped by `overflow: hidden` and by the strip's own overflow,
 * and it is rebuilt on almost every state change — including the rebuild that
 * acting on the plate itself triggers. Anything parented to it would be cut off
 * at the border, or destroyed mid-use. So a panel is mounted on `#interface` and
 * positioned `fixed` against the plate's rect: outside the clip, and it survives
 * its plate being replaced underneath it.
 *
 * ONE panel exists at a time. There are two bars and up to a dozen plates, and a
 * second panel opening while one is up is never what was meant.
 *
 * Three behaviours that are easy to get subtly wrong, hence sharing them:
 *
 *  • **Re-triggering closes.** Opening with the `key` that is already open is a
 *    toggle-off, so one control both opens and closes. The plate controls are a
 *    hover surface, and a panel that can only be dismissed by clicking elsewhere
 *    gets in the way of reaching the next plate.
 *  • **The trigger is exempt from outside-dismiss.** `pointerdown` fires BEFORE
 *    `click` and `contextmenu`, so without an exemption a second press on the
 *    same control would dismiss the panel here and then immediately reopen it —
 *    the toggle would never appear to work.
 *  • **Repaint, don't rebuild.** State shown in a panel can change from
 *    somewhere else entirely (the Token HUD, a macro, another GM) while it sits
 *    open. Callers register repaint callbacks and the Cast Bar's `refresh()`
 *    fires them, so a panel restates itself at the same moment the plate does.
 */

/** How far a panel keeps from its anchor and from the viewport edge, in px. */
const PAD = 8;

let panel: HTMLElement | null = null;
let cleanup: (() => void) | null = null;
let repaints: (() => void)[] = [];

export interface PopoverSpec {
  /** Identity. Re-opening with the key already open closes instead. Include the
   *  bar id as well as the plate id — plate ids are unique, but the key also has
   *  to distinguish two DIFFERENT panels on the same plate (palette vs menu). */
  key: string;
  /** The element to position against — normally the plate, not the control. */
  anchor: HTMLElement;
  /** Root class, for styling. `bivouac-pop` is always applied as well. */
  className: string;
  /** Optional heading, usually the character's name. */
  title?: string;
  /** Fill in the body. `onRepaint` registers a callback that `repaintPopover()`
   *  re-runs; register one per element whose look depends on live state. */
  build(body: HTMLElement, onRepaint: (fn: () => void) => void): void;
  /** Selector for controls that must NOT count as an outside press. */
  exempt?: string;
}

/** Close whatever is open. Safe to call when nothing is. */
export function closePopover(): void {
  cleanup?.();
  cleanup = null;
  repaints = [];
  panel?.remove();
  panel = null;
}

/** Re-run every registered repaint of the open panel. */
export function repaintPopover(): void {
  for (const r of repaints) r();
}

/** The open panel's key, or null. Lets a caller ask "is mine already up?". */
export function popoverKey(): string | null {
  return panel?.dataset.popKey ?? null;
}

/** Open a panel, or close it if `spec.key` is the one already open. */
export function openPopover(spec: PopoverSpec): void {
  const already = popoverKey() === spec.key;
  closePopover();
  if (already) return;

  const box = document.createElement("div");
  box.className = `bivouac-pop ${spec.className}`.trim();
  box.dataset.popKey = spec.key;

  if (spec.title) {
    const h = document.createElement("p");
    h.className = "bivouac-pop__title";
    h.textContent = spec.title;
    box.appendChild(h);
  }

  const body = document.createElement("div");
  body.className = "bivouac-pop__body";
  box.appendChild(body);

  spec.build(body, (fn) => {
    repaints.push(fn);
    fn();
  });

  (document.getElementById("interface") ?? document.body).appendChild(box);
  panel = box;
  position(box, spec.anchor);

  // `pointerdown` in the CAPTURE phase, so dismissal lands before the plate's own
  // click handler — which would otherwise open a character sheet behind the panel
  // on the way out.
  const onDown = (ev: Event): void => {
    const t = ev.target as Element | null;
    if (box.contains(t)) return;
    if (spec.exempt && t?.closest?.(spec.exempt)) return;
    closePopover();
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") closePopover();
  };
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  cleanup = (): void => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
  };
}

/** Place a panel beside its anchor, kept whole inside the viewport. Above by
 *  preference — a plate's controls are along its top edge, so a panel below would
 *  sit under the pointer's path to them. */
function position(box: HTMLElement, anchor: HTMLElement): void {
  const a = anchor.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const above = a.top - b.height - PAD;
  const top = above >= PAD ? above : a.bottom + PAD;
  const left = a.left + a.width / 2 - b.width / 2;
  box.style.top = `${clamp(top, b.height, window.innerHeight)}px`;
  box.style.left = `${clamp(left, b.width, window.innerWidth)}px`;
}

function clamp(v: number, size: number, limit: number): number {
  return Math.max(PAD, Math.min(v, limit - size - PAD));
}
