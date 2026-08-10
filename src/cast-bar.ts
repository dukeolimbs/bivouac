/** Bivouac — the Cast Bar: a dedicated, docked strip of character "Plates" for
 *  narrative encounters (who's in the scene, who's speaking). Its own tool, not
 *  part of the Widget/Tile system. Roster + speaker + visibility persist per
 *  Scene (broadcast to all players); dock edge / tab position / size are per
 *  client. See docs/cast-bar-design-spec.md. */

import {
  FLAGS,
  MODULE_ID,
  SETTINGS,
  CAST_DBLCLICK,
  canControl,
  plateAspect,
  type CastBarData,
  type Plate,
} from "./constants";
import { readCastBar, writeCastBar } from "./layout";
import { canView, docImg } from "./widgets";
import { isDocDrag, parseDrop } from "./drop";
import { worldLayer } from "./world-layer";

const DOCKS = ["bottom", "top", "left", "right"] as const;
type Dock = (typeof DOCKS)[number];

/** Plate-size bounds, in px (also capped at 60vh/60vw). SIZE_MIN is low so a 25%
 *  quick-scale of a small base size is still honoured. */
const SIZE_MIN = 24;
const SIZE_MAX = 520;

/** How close (ms) two plate clicks must be to count as a double — and, being the
 *  same number, how long a single click's speaker write waits so a double can
 *  pre-empt it (single = set speaker; double = open sheet — they share the plate
 *  body). Per client; see `CAST_DBLCLICK` for why we don't use native
 *  `dblclick`. */
function castDoubleClickMs(): number {
  const v = Number(game.settings.get(MODULE_ID, SETTINGS.castDoubleClickMs) ?? CAST_DBLCLICK.default);
  if (!Number.isFinite(v)) return CAST_DBLCLICK.default;
  return Math.min(CAST_DBLCLICK.max, Math.max(CAST_DBLCLICK.min, v));
}

/** The Actor stats the Cast Bar can overlay, in display order — icons + colours
 *  mirror Monk's Tokenbar. Each is gated by its own GM setting. */
const STATS: {
  key: "ac" | "pp" | "hp" | "inv";
  icon: string;
  setting: string;
}[] = [
  { key: "hp", icon: "fa-heart", setting: SETTINGS.castStatHP },
  { key: "ac", icon: "fa-shield-halved", setting: SETTINGS.castStatAC },
  { key: "pp", icon: "fa-eye", setting: SETTINGS.castStatPP },
  { key: "inv", icon: "fa-mask", setting: SETTINGS.castStatInv },
];

/** Raise My Hand (`raise-my-hand`) is socket-only with no readable roster, so we
 *  track raises/lowers ourselves from its channel (`{type:RAISE|LOWER, playerID}`).
 *  `game.socket.emit` doesn't echo to the sender, so a client's OWN hand is read
 *  from the module's in-memory `game.handRaiser.isRaised` instead. */
const raisedHands = new Set<string>();

/** Fold a raise-my-hand socket message into the tracked set (wired in module.ts).
 *  Handles both the original module's raw `{type:RAISE|LOWER, playerID}` and the
 *  socketlib-based raise-my-hand-plus envelope `{handlerName, args:[userId]}`
 *  (createHandPopout/appendPlayerListIcon = up, close/remove/lower = down). */
export function onRaiseHandMessage(msg: unknown): void {
  const m = msg as {
    type?: unknown;
    playerID?: string;
    handlerName?: string;
    args?: unknown[];
  } | null;
  if (!m) return;
  if (typeof m.playerID === "string") {
    if (m.type === "RAISE") raisedHands.add(m.playerID);
    else if (m.type === "LOWER") raisedHands.delete(m.playerID);
  } else if (typeof m.handlerName === "string") {
    const h = m.handlerName;
    if (/clear/i.test(h)) raisedHands.clear();
    else {
      const uid = Array.isArray(m.args) ? m.args[0] : undefined;
      if (typeof uid === "string") {
        if (/create|append|raise|show|open/i.test(h)) raisedHands.add(uid);
        else if (/close|remove|lower|hide/i.test(h)) raisedHands.delete(uid);
      }
    }
  }
}

/** User ids whose hand is currently raised (socket-tracked + own hand + the
 *  players-list ✋ marker for hands raised before we connected) + a generic
 *  truthy-"hand"-flag fallback for other raised-hand modules. */
function raisedHandUserIds(): Set<string> {
  const out = new Set<string>(raisedHands);
  if (game.handRaiser?.isRaised && game.user?.id) out.add(game.user.id);
  // Players-list marker: raise-my-hand-plus uses ".raise-my-hand-indicator"; the
  // original module used ".raised-hand". Read both.
  document
    .querySelectorAll(".raise-my-hand-indicator, .raised-hand")
    .forEach((span) => {
      const uid = (span.closest("[data-user-id]") as HTMLElement | null)
        ?.dataset.userId;
      if (uid) out.add(uid);
    });
  const users = (game.users?.contents ?? []) as {
    id?: string;
    flags?: Record<string, Record<string, unknown>>;
  }[];
  for (const u of users) {
    for (const [mod, data] of Object.entries(u.flags ?? {})) {
      if (!data || !game.modules?.get?.(mod)?.active) continue;
      if (Object.entries(data).some(([k, v]) => v && /hand/i.test(k))) {
        if (u.id) out.add(u.id);
        break;
      }
    }
  }
  return out;
}

/** Read the dnd5e stat values off an actor (null when absent / a non-dnd5e system,
 *  so that stat row is simply skipped). */
function readStats(
  doc: Record<string, unknown> | null,
): Record<string, number | null> {
  const sys = (doc?.system ?? {}) as {
    attributes?: { ac?: { value?: unknown }; hp?: { value?: unknown } };
    skills?: { prc?: { passive?: unknown }; inv?: { passive?: unknown } };
  };
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    ac: num(sys.attributes?.ac?.value),
    pp: num(sys.skills?.prc?.passive),
    hp: num(sys.attributes?.hp?.value),
    inv: num(sys.skills?.inv?.passive),
  };
}

/** Per-instance wiring so multiple Cast Bars (e.g. party + NPCs) can coexist: each
 *  has its own scene flag, dock/size/tab settings, and DOM ids. CSS vars are scoped
 *  to the instance's own elements (not the document root), so they don't clash. */
interface CastBarConfig {
  flag: string;
  dockSetting: string;
  tabPosSetting: string;
  tabPadSetting: string;
  sizeSetting: string;
  /** Per-bar quick scale multiplier (hover +/-), applied on top of the size. */
  scaleSetting: string;
  elId: string;
  tabId: string;
  /** If true, a dock value outside DOCKS (e.g. "off") disables the bar entirely. */
  optional: boolean;
}

/** The plate actions a keybinding can fire — the same set as the hover control
 *  bar, so the keys are an accelerator for buttons that already exist. */
export type PlateAction = "speaker" | "name" | "exited" | "hidden" | "stats" | "remove";

/** What the pointer is currently over. Keybindings for "the hovered plate" only
 *  make sense against live pointer state, and this has to be module-level because
 *  there are two bar instances and the bindings are registered once.
 *
 *  Held as ids rather than instances, so nothing here can pin a stale object:
 *  both are resolved on use, and a plate id that has since gone simply no-ops
 *  (every action re-reads the roster). */
let hoveredPlate: { barId: string; plateId: string } | null = null;
let hoveredBarId: string | null = null;

function barById(id: string | null): CastBar | null {
  return castBars.find((b) => b.id === id) ?? null;
}

/** Fire a plate action on whatever the pointer is over. Returns whether it acted,
 *  so the keybinding can consume the key ONLY when it did something — otherwise
 *  the key falls through to Foundry (or another module) untouched. */
export function castPlateAction(action: PlateAction): boolean {
  const bar = hoveredPlate ? barById(hoveredPlate.barId) : null;
  if (!bar || !hoveredPlate || !canControl()) return false;
  void bar.plateAction(hoveredPlate.plateId, action);
  return true;
}

/** Show/hide the Cast Bar: the hovered bar if the pointer is over one, otherwise
 *  every enabled bar (so the key still works with the pointer anywhere). */
export function castToggleVisible(): boolean {
  if (!canControl()) return false;
  const hovered = barById(hoveredBarId);
  const bars = hovered ? [hovered] : castBars.filter((b) => b.enabled);
  if (!bars.length) return false;
  bars.forEach((b) => void b.toggleVisible());
  return true;
}

/** Quick-scale bounds + step for the hover +/- control (× the base Actor size). */
const SCALE_MIN = 0.25;
const SCALE_MAX = 1.5;
const SCALE_STEP = 0.1;

/** Extra horizontal inset (px) for the vertical docks, ON TOP of the base edge
 *  clearance (left → scene-controls toolbar, right → sidebar). Tweak to taste. */
const LEFT_DOCK_PAD = -35; // left bar's gap from the scene-controls toolbar
const RIGHT_DOCK_PAD = 0; // right bar's gap from the sidebar

class CastBar {
  #el: HTMLElement | null = null;
  #strip: HTMLElement | null = null;
  #tab: HTMLButtonElement | null = null;
  #closeBtn: HTMLButtonElement | null = null;
  #dock: Dock = "bottom";
  /** Plate id being drag-reordered, or null. */
  #dragId: string | null = null;
  #clickTimer: number | null = null;
  /** Last plate click, for our own double-click detection (see castDoubleClickMs). */
  #lastClick: { id: string; at: number } | null = null;
  #fitFrames = 0;
  #fitting = false;
  #cfg: CastBarConfig;
  #enabled = true;

  constructor(cfg: CastBarConfig) {
    this.#cfg = cfg;
  }

  /* ------------------------------------------------ mount --------------- */

  /** Build the surface (for everyone) and, for controllers, the toggle tab.
   *  Idempotent — safe to call once on `ready`. */
  mount(): void {
    const iface = document.getElementById("interface") ?? document.body;

    if (!this.#el) {
      const bar = document.createElement("aside");
      bar.id = this.#cfg.elId;
      bar.className = "bivouac-castbar";
      // Which bar the pointer is over, so a bar-level keybinding can target the
      // one being looked at when two are running.
      bar.addEventListener("pointerenter", () => {
        hoveredBarId = this.id;
      });
      bar.addEventListener("pointerleave", () => {
        if (hoveredBarId === this.id) hoveredBarId = null;
        // Also clear the plate: a plate that was re-rendered (a speaker change
        // rebuilds them) never fires its own pointerleave, because the element
        // the pointer was over no longer exists. Leaving the bar is the reliable
        // moment to know nothing is hovered. `pointerleave` doesn't fire when
        // moving BETWEEN plates inside the bar, so this can't clear a live hover.
        if (hoveredPlate?.barId === this.id) hoveredPlate = null;
      });

      const strip = document.createElement("div");
      strip.className = "bivouac-castbar__strip";
      // Drop an Actor/Item onto the bar → add a Plate. Only in Bivouac Edit Mode
      // (the campground control group active), matching how board tiles are added.
      // Skipped while an internal reorder is in flight (it has its own handling).
      strip.addEventListener("dragover", (e) => {
        if (
          this.#dragId ||
          !canControl() ||
          !worldLayer.editMode ||
          !isDocDrag(e)
        )
          return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      });
      strip.addEventListener("drop", (e) => {
        if (!this.#dragId) void this.#onDrop(e);
      });
      bar.appendChild(strip);
      this.#strip = strip;

      // Controllers get a close button on the bar itself (the toggle tab fades
      // while the bar is open, so it can't double as the closer).
      if (canControl()) {
        const close = document.createElement("button");
        close.type = "button";
        close.className = "bivouac-castbar__close";
        close.title = game.i18n.localize("BIVOUAC.CastBar.Close");
        close.innerHTML = `<i class="fa-solid fa-eye"></i>`;
        // Toggle (not just hide) so it also works to un-hide while editing.
        close.addEventListener("click", () => void this.toggleVisible());
        bar.appendChild(close);
        this.#closeBtn = close;
      }

      // Client-side quick scale (all users): +/- buttons revealed on hover.
      const scaleBox = document.createElement("div");
      scaleBox.className = "bivouac-castbar__scale";
      const scaleBtn = (
        icon: string,
        titleKey: string,
        delta: number,
      ): void => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "bivouac-castbar__scalebtn";
        b.title = game.i18n.localize(titleKey);
        b.innerHTML = `<i class="fa-solid ${icon}"></i>`;
        b.addEventListener("click", () => void this.#nudgeScale(delta));
        scaleBox.appendChild(b);
      };
      scaleBtn("fa-minus", "BIVOUAC.CastBar.ScaleDown", -SCALE_STEP);
      scaleBtn("fa-plus", "BIVOUAC.CastBar.ScaleUp", SCALE_STEP);
      bar.appendChild(scaleBox);

      iface.appendChild(bar);
      this.#el = bar;
      window.addEventListener("resize", () => this.applySize());
      // The available width changes when the sidebar collapses/expands → refit
      // across the animation so it tracks to the settled position.
      Hooks.on("collapseSidebar", this.#scheduleFit);
    }

    if (canControl() && !this.#tab) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.id = this.#cfg.tabId;
      tab.className = "bivouac-castbar-tab bivouac-casttab-bottom"; // edge fixed by applyDock()
      tab.title = game.i18n.localize("BIVOUAC.CastBar.Toggle");
      tab.innerHTML = `<i class="fa-solid fa-masks-theater"></i>`;
      tab.addEventListener("click", () => void this.toggleVisible());
      iface.appendChild(tab);
      this.#tab = tab;
    }

    this.applyDock();
    this.applySize();
    this.applyTabPos();
    this.refresh();
    // Foundry's sidebar / controls may still be settling on first world load, so
    // re-measure across the next frames (and once more after the cold-start delay).
    this.#scheduleFit();
    window.setTimeout(this.#scheduleFit, 500);
  }

  /* ------------------------------------------------ dock / size --------- */

  applyDock(): void {
    const m = String(
      game.settings.get(MODULE_ID, this.#cfg.dockSetting) ?? "bottom",
    );
    const valid = (DOCKS as readonly string[]).includes(m);
    // Optional (secondary) bars are disabled when their dock is "off" / invalid.
    this.#enabled = valid || !this.#cfg.optional;
    if (this.#el) this.#el.style.display = this.#enabled ? "" : "none";
    if (this.#tab) this.#tab.style.display = this.#enabled ? "" : "none";
    if (!this.#enabled) return;
    this.#dock = valid ? (m as Dock) : "bottom";
    const set = (elm: HTMLElement | null, prefix: string): void => {
      if (!elm) return;
      DOCKS.forEach((d) => elm.classList.remove(`${prefix}-${d}`));
      elm.classList.add(`${prefix}-${this.#dock}`);
    };
    set(this.#el, "bivouac-castdock");
    set(this.#tab, "bivouac-casttab");
  }

  #vertical(): boolean {
    return this.#dock === "left" || this.#dock === "right";
  }

  applySize(): void {
    const el = this.#el;
    if (!el) return;
    const base = Number(
      game.settings.get(MODULE_ID, this.#cfg.sizeSetting) ?? 200,
    );
    const scale = Number(
      game.settings.get(MODULE_ID, this.#cfg.scaleSetting) ?? 1,
    );
    const wanted =
      (Number.isFinite(base) ? base : 200) *
      (Number.isFinite(scale) ? scale : 1);
    const cap = Math.min(
      SIZE_MAX,
      (this.#vertical() ? window.innerWidth : window.innerHeight) * 0.6,
    );
    const size = Math.min(cap, Math.max(SIZE_MIN, wanted));
    // Scoped to this bar's element (not :root) so two bars don't clobber each other.
    el.style.setProperty("--bivouac-castbar-size", `${Math.round(size)}px`);
    // Plate shape. Published as a number (a valid `<ratio>`) so the CSS and the
    // fit maths below are driven by the same value.
    el.style.setProperty("--bivouac-plate-aspect", String(plateAspect()));
    this.#fit();
  }

  /** Nudge this bar's client scale by ±one step, clamped, and re-apply. */
  async #nudgeScale(delta: number): Promise<void> {
    const cur = Number(
      game.settings.get(MODULE_ID, this.#cfg.scaleSetting) ?? 1,
    );
    const raw = (Number.isFinite(cur) ? cur : 1) + delta;
    const next = Math.min(
      SCALE_MAX,
      Math.max(SCALE_MIN, Math.round(raw / SCALE_STEP) * SCALE_STEP),
    );
    await game.settings.set(MODULE_ID, this.#cfg.scaleSetting, next); // onChange → applySize
  }

  applyTabPos(): void {
    const pos = Number(
      game.settings.get(MODULE_ID, this.#cfg.tabPosSetting) ?? 50,
    );
    this.#tab?.style.setProperty(
      "--bivouac-casttab-pos",
      `${Number.isFinite(pos) ? pos : 50}%`,
    );
    this.#syncTab();
  }

  /** Recompute the fit/position for ~20 frames, so the bar settles into place as
   *  Foundry's UI finishes laying out (first world load) or animates (sidebar
   *  collapse) — a one-shot measure can land before the sidebar/controls settle. */
  #scheduleFit = (): void => {
    this.#fitFrames = 20;
    if (this.#fitting) return;
    this.#fitting = true;
    const step = (): void => {
      this.#fit();
      if (--this.#fitFrames > 0) requestAnimationFrame(step);
      else this.#fitting = false;
    };
    requestAnimationFrame(step);
  };

  /** Scale the plates down so the whole cast fits the available space (clear of
   *  Foundry's side UI) instead of overlapping it or running off-screen. Sets the
   *  effective plate size on `--bivouac-castbar-fit`; the CSS falls back to the
   *  full `--bivouac-castbar-size` when no shrink is needed. */
  #fit(): void {
    const el = this.#el;
    const strip = this.#strip;
    if (!el || !strip || !this.#enabled) return;
    this.#syncTab();
    const count = strip.querySelectorAll(".bivouac-plate").length;
    if (!count) {
      el.style.removeProperty("--bivouac-castbar-fit");
      return;
    }
    const gap =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--bivouac-gap",
        ),
      ) || 8;
    const size =
      parseFloat(
        getComputedStyle(el).getPropertyValue("--bivouac-castbar-size"),
      ) || 180;
    const stripCS = getComputedStyle(strip);
    const vertical = this.#vertical();
    const pad = vertical
      ? parseFloat(stripCS.paddingTop) + parseFloat(stripCS.paddingBottom)
      : parseFloat(stripCS.paddingLeft) + parseFloat(stripCS.paddingRight);
    // Per-plate footprint along the strip per 1px of plate size. The driven axis
    // is the height on a horizontal strip and the width on a vertical one, so
    // with an aspect of width÷height a plate takes `aspect × size` along a
    // horizontal strip and `size ÷ aspect` along a vertical one. This must track
    // the CSS `aspect-ratio`, or auto-shrink miscalculates and the plates overlap
    // the sidebar or run off-screen — hence both reading `plateAspect()`.
    const aspect = plateAspect();
    const per = vertical ? 1 / aspect : aspect;
    // …plus the plate's border, which `aspect-ratio` does NOT include: the
    // ratio applies to the content box, so each plate is `per × size` of content
    // with the border on top. Measured, not assumed — a 200px plate lays out at
    // 204px. Left out, the strip's footprint is underestimated by `border × count`
    // (4px a plate as it stands), which is invisible with three plates and pushes
    // a large cast into the sidebar. Read from a live plate rather than hard-coded,
    // so it can't drift from the CSS.
    const first = strip.querySelector(".bivouac-plate");
    const plateCS = first ? getComputedStyle(first) : null;
    const border = plateCS
      ? vertical
        ? parseFloat(plateCS.borderTopWidth) + parseFloat(plateCS.borderBottomWidth)
        : parseFloat(plateCS.borderLeftWidth) + parseFloat(plateCS.borderRightWidth)
      : 0;
    const avail = this.#placeAndBand(el);
    const maxSize = (avail - (count - 1) * gap - pad - count * border) / (count * per);
    // Auto-shrink to fit, but never below 80px UNLESS the chosen size is already
    // smaller (a deliberate quick-scale down) — then honour it.
    const floor = Math.min(80, size);
    const fit = Math.max(floor, Math.min(size, maxSize));
    el.style.setProperty("--bivouac-castbar-fit", `${Math.floor(fit)}px`);
  }

  /** Position the bar with a dock-specific inset that clears the adjacent Foundry
   *  UI (top→nav · bottom→macro hotbar · left→scene controls · right→sidebar), and
   *  re-centre it along its main axis within the free band. Returns the main-axis
   *  extent (px) for the fit calc. All measured from THIS client's own window —
   *  nothing shared/persisted, so larger monitors keep full-size plates. */
  #placeAndBand(el: HTMLElement): number {
    const gapUI = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dock = this.#dock;
    el.style.removeProperty("top");
    el.style.removeProperty("bottom");
    el.style.removeProperty("left");
    el.style.removeProperty("right");

    if (dock === "left" || dock === "right") {
      // Vertical strip: centre in the viewport, and cap the column height so it
      // clears the top nav and the macro hotbar (measured) symmetrically about
      // that centre. Left/right bars carry +30px extra padding on every side
      // (both the vertical top/bottom clearance and the horizontal edge inset).
      const center = vh / 2;
      const topClear = 90; // 60 + 30 vertical padding
      const bottom = this.#hotbarTop() - gapUI - 70; // 40 + 30 vertical padding
      el.style.top = `${Math.round(center)}px`; // translateY(-50%) → viewport-centred
      // Horizontal inset per dock — the LEFT_DOCK_PAD / RIGHT_DOCK_PAD knobs above.
      if (dock === "left")
        el.style.left = `${Math.round(this.#controlsRight() + gapUI + LEFT_DOCK_PAD)}px`;
      else
        el.style.right = `${Math.round(vw - this.#sidebarLeft() + gapUI + RIGHT_DOCK_PAD)}px`;
      return Math.max(200, 2 * Math.min(center - topClear, bottom - center));
    }

    // Horizontal strip: band along x, between the scene controls and the sidebar.
    const start = this.#controlsRight() + gapUI;
    const end = this.#sidebarLeft() - gapUI;
    el.style.left = `${Math.round((start + end) / 2)}px`;
    // Top keeps its CSS inset (clears the nav); bottom rises above the hotbar.
    if (dock === "bottom")
      el.style.bottom = `${Math.round(vh - this.#hotbarTop() + gapUI)}px`;
    return Math.max(200, end - start);
  }

  /** Park the right-dock toggle tab just left of the sidebar's live edge (the same
   *  method the DM-screen tab uses), so a hidden right-docked bar's re-open button
   *  never sits under the sidebar. */
  #syncTab(): void {
    if (!this.#tab) return;
    const pad = Number(
      game.settings.get(MODULE_ID, this.#cfg.tabPadSetting) ?? -33,
    );
    const inset = Math.max(
      0,
      window.innerWidth -
        this.#sidebarLeft() +
        (Number.isFinite(pad) ? pad : -33),
    );
    this.#tab.style.setProperty(
      "--bivouac-casttab-inset",
      `${Math.round(inset)}px`,
    );
  }

  /** Live-preview the tab position/padding from explicit values (Settings window
   *  drag), without persisting. Close-settings re-applies the saved values. */
  previewTab(posPct: number, padPx: number): void {
    const tab = this.#tab;
    if (!tab) return;
    if (Number.isFinite(posPct))
      tab.style.setProperty("--bivouac-casttab-pos", `${posPct}%`);
    if (Number.isFinite(padPx)) {
      const inset = Math.max(
        0,
        window.innerWidth - this.#sidebarLeft() + padPx,
      );
      tab.style.setProperty(
        "--bivouac-casttab-inset",
        `${Math.round(inset)}px`,
      );
    }
  }

  /** Left edge of the right-hand sidebar (collapses/expands, so measured). */
  #sidebarLeft(): number {
    const el =
      document.getElementById("sidebar") ??
      (ui.sidebar?.element instanceof HTMLElement
        ? ui.sidebar.element
        : null) ??
      (document.querySelector("#ui-right") as HTMLElement | null);
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 ? r.left : window.innerWidth;
  }

  /** Right edge of the (thin) left scene-controls toolbar. */
  #controlsRight(): number {
    const el =
      (document.querySelector("#scene-controls") as HTMLElement | null) ??
      (document.getElementById("controls") as HTMLElement | null);
    const r = el?.getBoundingClientRect();
    // Guard against matching a wide wrapper — the toolbar itself is narrow.
    return r && r.width > 0 && r.width < 200 ? r.right : 60;
  }

  /** Top edge of the macro hotbar (so a bottom / side dock clears it). */
  #hotbarTop(): number {
    const el =
      document.getElementById("hotbar") ??
      (document.querySelector("#ui-bottom") as HTMLElement | null);
    const r = el?.getBoundingClientRect();
    return r && r.height > 0 ? r.top : window.innerHeight;
  }

  /* ------------------------------------------------ state I/O ----------- */

  #read(): CastBarData {
    return readCastBar(canvas?.scene ?? null, this.#cfg.flag);
  }

  /** Write to the current scene. The `updateScene` broadcast re-renders every
   *  client (including us), so callers don't render directly. */
  async #write(data: CastBarData): Promise<void> {
    const scene = canvas?.scene;
    if (!scene) return;
    await writeCastBar(scene, this.#cfg.flag, data);
  }

  async #setVisible(v: boolean): Promise<void> {
    if (!canControl()) return;
    const d = this.#read();
    d.visible = v;
    await this.#write(d);
  }

  async #onDrop(event: DragEvent): Promise<void> {
    if (!canControl() || !worldLayer.editMode) return;
    const data = parseDrop(event);
    if (!data || (data.type !== "Actor" && data.type !== "Item")) return;
    event.preventDefault();
    event.stopPropagation();
    // Choose the image FIRST — the plate isn't created/shown until Profile/Token
    // is chosen, or (Custom) a file is actually picked. Cancelling anywhere adds
    // nothing.
    const choice = await this.#pickImageSource();
    if (!choice) return;
    let art: "profile" | "token" = "profile";
    let img: string | undefined;
    if (choice === "custom") {
      img = await this.#pickFile();
      if (!img) return; // file picker closed without a selection → don't add
    } else {
      art = choice; // "profile" | "token"
    }
    // Names start HIDDEN on first add, but the choice is remembered per-actor
    // (see #toggleName) — so re-adding an actor whose name was revealed keeps it
    // revealed rather than defaulting to hidden again.
    const doc = (await fromUuid(data.uuid).catch(() => null)) as {
      getFlag?: (m: string, k: string) => unknown;
    } | null;
    const remembered = doc?.getFlag?.(MODULE_ID, FLAGS.castNameHidden);
    const nameHidden = typeof remembered === "boolean" ? remembered : true;
    const d = this.#read();
    d.plates.push({
      id: foundry.utils.randomID(),
      uuid: data.uuid,
      art,
      img,
      exited: false,
      hidden: false,
      nameHidden,
    });
    d.visible = true; // dropping a character shows the bar
    await this.#write(d);
  }

  /** Ask which image to use for a dropped actor. Returns the choice or null. */
  async #pickImageSource(): Promise<"profile" | "token" | "custom" | null> {
    const loc = (k: string): string => game.i18n.localize(k);
    const result = await foundry.applications.api.DialogV2.wait({
      window: {
        title: loc("BIVOUAC.CastBar.ImageTitle"),
        icon: "fa-solid fa-image",
      },
      content: `<p class="bivouac-pick-hint">${loc("BIVOUAC.CastBar.ImagePrompt")}</p>`,
      buttons: [
        {
          action: "profile",
          label: loc("BIVOUAC.CastBar.ImageProfile"),
          icon: "fa-solid fa-user",
          default: true,
        },
        {
          action: "token",
          label: loc("BIVOUAC.CastBar.ImageToken"),
          icon: "fa-solid fa-chess-pawn",
        },
        {
          action: "custom",
          label: loc("BIVOUAC.CastBar.ImageCustom"),
          icon: "fa-solid fa-folder-open",
        },
      ],
      rejectClose: false,
    }).catch(() => null);
    return result === "profile" || result === "token" || result === "custom"
      ? result
      : null;
  }

  /** Open Foundry's file picker and resolve with the chosen image path — or
   *  `undefined` if it's closed without a selection (so the drop is abandoned).
   *  Wrapping the instance's `close()` catches cancel without relying on a hook
   *  name; a selection resolves first via the callback, so the close is a no-op. */
  #pickFile(): Promise<string | undefined> {
    return new Promise((resolve) => {
      const FP = (foundry.applications?.apps?.FilePicker?.implementation ??
        (globalThis as { FilePicker?: unknown }).FilePicker) as
        | (new (o: unknown) => {
            render: (b: boolean) => void;
            close: (o?: unknown) => Promise<unknown>;
          })
        | undefined;
      if (!FP) {
        resolve(undefined);
        return;
      }
      let done = false;
      const finish = (v: string | undefined): void => {
        if (!done) {
          done = true;
          resolve(v);
        }
      };
      const picker = new FP({
        type: "image",
        callback: (path: string) => finish(path),
      });
      const close = picker.close.bind(picker);
      picker.close = (opts?: unknown): Promise<unknown> => {
        finish(undefined);
        return close(opts);
      };
      picker.render(true);
    });
  }

  /** This bar's element id — also its identity in the hover tracking above. */
  get id(): string {
    return this.#cfg.elId;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** Show/hide this bar for everyone (the tab, the × and the keybinding all
   *  land here). Public so `castToggleVisible` can reach it. */
  async toggleVisible(): Promise<void> {
    await this.#setVisible(!this.#read().visible);
  }

  /** Apply one of the hover-control actions to a plate by id. A single public
   *  entry point rather than a wrapper per action, so the keybindings in
   *  `module.ts` can reach the private mutators without the class growing a
   *  method for each. Every one of these is permission-gated inside. */
  async plateAction(id: string, action: PlateAction): Promise<void> {
    switch (action) {
      case "speaker":
        return this.#setSpeaker(id);
      case "name":
        return this.#toggleName(id);
      case "remove":
        return this.#remove(id);
      case "exited":
        return this.#mutate(id, (p) => (p.exited = !p.exited));
      case "hidden":
        return this.#mutate(id, (p) => (p.hidden = !p.hidden));
      case "stats":
        return this.#mutate(id, (p) => (p.stats = !p.stats));
    }
  }

  async #remove(id: string): Promise<void> {
    if (!canControl()) return;
    const d = this.#read();
    d.plates = d.plates.filter((p) => p.id !== id);
    if (d.speakerId === id) d.speakerId = null;
    await this.#write(d);
  }

  async #setSpeaker(id: string): Promise<void> {
    if (!canControl()) return;
    const d = this.#read();
    d.speakerId = d.speakerId === id ? null : id; // click the speaker again to clear
    await this.#write(d);
  }

  /** Apply a mutation to one plate and persist. */
  async #mutate(id: string, fn: (p: Plate) => void): Promise<void> {
    if (!canControl()) return;
    const d = this.#read();
    const p = d.plates.find((x) => x.id === id);
    if (!p) return;
    fn(p);
    await this.#write(d);
  }

  /** Toggle a plate's name visibility, and remember the choice on the actor so
   *  future adds of the same actor reuse it (per-actor default). */
  async #toggleName(id: string): Promise<void> {
    if (!canControl()) return;
    const d = this.#read();
    const p = d.plates.find((x) => x.id === id);
    if (!p) return;
    p.nameHidden = !p.nameHidden;
    await this.#write(d);
    const doc = (await fromUuid(p.uuid).catch(() => null)) as {
      setFlag?: (m: string, k: string, v: unknown) => Promise<unknown>;
    } | null;
    // Best-effort — a non-owner can't persist the actor's default; the plate
    // state still applied above.
    try {
      await doc?.setFlag?.(MODULE_ID, FLAGS.castNameHidden, p.nameHidden);
    } catch {
      /* no permission to write the actor flag */
    }
  }

  async #reorder(
    dragId: string,
    targetId: string,
    after: boolean,
  ): Promise<void> {
    if (!canControl() || dragId === targetId) return;
    const d = this.#read();
    const from = d.plates.findIndex((p) => p.id === dragId);
    if (from < 0) return;
    const [moved] = d.plates.splice(from, 1);
    const ti = d.plates.findIndex((p) => p.id === targetId);
    if (ti < 0) d.plates.push(moved);
    else d.plates.splice(ti + (after ? 1 : 0), 0, moved);
    await this.#write(d);
  }

  /* ------------------------------------------------ render -------------- */

  /** Re-read the current scene's Cast Bar and reflect it. Called on mount, scene
   *  change, and the `updateScene` broadcast. */
  refresh(): void {
    if (!this.#el || !this.#enabled) return;
    const d = this.#read();
    const controller = canControl();
    // "Editing" = a controller with Bivouac Edit Mode on (campground group active).
    const editing = controller && !!worldLayer.editMode;
    // The set this viewer may see: controllers see all; players never see hidden.
    const plates = controller ? d.plates : d.plates.filter((p) => !p.hidden);
    // Optionally hide entirely while a combat is running (edit mode overrides, so
    // the GM can still arrange it mid-combat).
    const inCombatHide =
      !!game.settings.get(MODULE_ID, SETTINGS.castHideInCombat) &&
      !!game.combat?.started;
    // Show the floating plates when the GM has them visible (and there's a plate
    // this viewer may see); a controller also sees the drop-zone whenever editing.
    const show = editing || (!inCombatHide && d.visible && plates.length > 0);
    this.#el.classList.toggle("bivouac-castbar--open", show);
    this.#el.classList.toggle("bivouac-castbar--editable", controller); // hover controls
    this.#el.classList.toggle("bivouac-castbar--editing", editing); // drop-zone chrome
    // While editing, a hidden bar still shows (so you can arrange it) but is dimmed,
    // so the hide button gives clear feedback without removing the drop-zone.
    this.#el.classList.toggle("bivouac-castbar--dimmed", editing && !d.visible);
    // Hide the toggle tab too during combat-hide — it can't open the bar then.
    if (this.#tab)
      this.#tab.style.display = inCombatHide && !editing ? "none" : "";
    this.#tab?.classList.toggle("bivouac-castbar-tab--open", show);
    this.#tab?.setAttribute("aria-pressed", String(d.visible));
    // The eye button reflects (and toggles) the current player-visibility.
    if (this.#closeBtn) {
      const icon = this.#closeBtn.querySelector("i");
      if (icon)
        icon.className = d.visible
          ? "fa-solid fa-eye"
          : "fa-solid fa-eye-slash";
      this.#closeBtn.title = game.i18n.localize(
        d.visible ? "BIVOUAC.CastBar.Close" : "BIVOUAC.CastBar.Reveal",
      );
    }
    // Always (re)build from the permitted set, so a player's DOM never contains a
    // hidden plate. NOTE: the plate *data* still lives in the scene flag Foundry
    // broadcasts to all clients — a determined player could read it there. True
    // send-side filtering needs a GM socket relay (documented follow-up).
    this.#render(d, controller, plates, editing);
  }

  /** Re-render if any plate references the changed document (live actor art/name). */
  refreshActor(uuid: string): void {
    if (this.#read().plates.some((p) => p.uuid === uuid)) this.refresh();
  }

  #render(
    d: CastBarData,
    controller: boolean,
    plates: Plate[],
    editing: boolean,
  ): void {
    const strip = this.#strip;
    if (!strip) return;
    strip.replaceChildren();
    if (!plates.length) {
      // Only in edit mode do we show a prompt (the drop zone) — otherwise the
      // empty area stays invisible.
      if (editing) {
        const empty = document.createElement("p");
        empty.className = "bivouac-castbar__empty";
        empty.textContent = game.i18n.localize("BIVOUAC.CastBar.Empty");
        strip.appendChild(empty);
      }
      this.#fit();
      return;
    }
    for (const p of plates)
      strip.appendChild(this.#renderPlate(p, d, controller));
    this.#fit(); // scale plates down if the cast would exceed the available width
  }

  /** Overlay the Actor's enabled stats (AC / passive perception / HP / passive
   *  investigation) on a plate, if the plate has stats toggled on. Only stats the
   *  GM has enabled and that resolve to a value are shown. */
  #renderStats(
    el: HTMLElement,
    plate: Plate,
    doc: Record<string, unknown> | null,
  ): void {
    el.querySelector(".bivouac-plate__stats")?.remove();
    if (!plate.stats || !doc) return;
    const vals = readStats(doc);
    const rows = STATS.filter(
      (s) => !!game.settings.get(MODULE_ID, s.setting) && vals[s.key] != null,
    );
    if (!rows.length) return;
    const box = document.createElement("div");
    box.className = "bivouac-plate__stats";
    for (const s of rows) {
      const row = document.createElement("div");
      row.className = `bivouac-plate__stat bivouac-plate__stat--${s.key}`;
      row.innerHTML = `<i class="fa-solid ${s.icon}"></i><span>${vals[s.key]}</span>`;
      box.appendChild(row);
    }
    el.appendChild(box);
  }

  /** Show a raised-hand badge (top-right) when a player who OWNS this actor has
   *  their hand up (via an active raised-hand module). */
  /** Whether a NON-GM user who OWNS this actor currently has their hand raised. */
  #handUp(doc: Record<string, unknown> | null): boolean {
    if (!doc) return false;
    const raised = raisedHandUserIds();
    if (!raised.size) return false;
    const ownership =
      (doc.ownership as Record<string, number> | undefined) ?? {};
    const OWNER = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    const test = (
      doc as { testUserPermission?: (u: unknown, p: string) => boolean }
    ).testUserPermission;
    return [...raised].some((uid) => {
      const user = game.users?.get?.(uid);
      if (!user || user.isGM) return false;
      return test
        ? !!test.call(doc, user, "OWNER")
        : (ownership[uid] ?? 0) >= OWNER;
    });
  }

  /** Add/remove the hand overlay ONLY on a real state change, so frequent updates
   *  don't restart the wave animation or churn the DOM. */
  #renderHand(el: HTMLElement, doc: Record<string, unknown> | null): void {
    const up = this.#handUp(doc);
    const existing = el.querySelector(".bivouac-plate__hand");
    if (up && !existing) {
      const hand = document.createElement("div");
      hand.className = "bivouac-plate__hand";
      hand.innerHTML = `<i class="fa-solid fa-hand"></i>`;
      el.appendChild(hand);
    } else if (!up && existing) {
      existing.remove();
    }
  }

  /** Update just the hand overlays in place (no plate rebuild) — used for
   *  raise/lower so nothing flashes and the wave animation keeps running. */
  refreshHands(): void {
    this.#strip
      ?.querySelectorAll<HTMLElement>(".bivouac-plate")
      .forEach((el) => {
        const uuid = el.dataset.uuid;
        const doc = uuid
          ? (fromUuidSync(uuid) as Record<string, unknown> | null)
          : null;
        this.#renderHand(el, doc);
      });
  }

  /** Toggle the speaker highlight in the DOM without a full re-render — used for
   *  instant, optimistic feedback on click (and to revert on double-click). */
  #applySpeakerHighlight(id: string | null): void {
    this.#strip
      ?.querySelectorAll<HTMLElement>(".bivouac-plate")
      .forEach((n) => {
        n.classList.toggle("bivouac-plate--speaker", n.dataset.id === id);
      });
  }

  #renderPlate(plate: Plate, d: CastBarData, controller: boolean): HTMLElement {
    const el = document.createElement("div");
    el.className = "bivouac-plate";
    el.dataset.id = plate.id;
    el.dataset.uuid = plate.uuid; // for targeted hand updates without a full re-render
    if (d.speakerId === plate.id) el.classList.add("bivouac-plate--speaker");
    if (plate.exited) el.classList.add("bivouac-plate--exited");
    if (plate.hidden) el.classList.add("bivouac-plate--hidden"); // controllers only reach here

    const img = document.createElement("img");
    img.className = "bivouac-plate__img";
    el.appendChild(img);

    const name = document.createElement("span");
    name.className = "bivouac-plate__name";
    el.appendChild(name);

    // Fill in art + name from the document; keep a handle so dblclick can open
    // the sheet.
    let doc: Record<string, unknown> | null = null;
    const fill = (resolved: Record<string, unknown> | null): void => {
      doc = resolved;
      if (!doc) {
        el.classList.add("bivouac-plate--missing");
        name.textContent = game.i18n.localize("BIVOUAC.CastBar.Missing");
        return;
      }
      const token = (
        doc.prototypeToken as { texture?: { src?: string } } | undefined
      )?.texture?.src;
      img.src =
        plate.img || (plate.art === "token" && token ? token : docImg(doc));
      img.alt = String(doc.name ?? "");
      if (plate.nameHidden && !controller) {
        name.textContent = "?";
        name.classList.add("bivouac-plate__name--q");
      } else {
        name.textContent = String(doc.name ?? "");
        if (plate.nameHidden) name.classList.add("bivouac-plate__name--hidden"); // greyed, GM view
      }
      if (canView(doc)) el.classList.add("bivouac-plate--interactive");
      this.#renderStats(el, plate, doc);
      this.#renderHand(el, doc);
    };
    // World docs (sidebar actors) resolve synchronously → no placeholder flash on
    // re-render. Compendium / not-yet-loaded docs fall back to async.
    const sync = fromUuidSync(plate.uuid) as { documentName?: string } | null;
    if (sync && sync.documentName) {
      fill(sync as Record<string, unknown>);
    } else {
      img.src = "icons/svg/mystery-man.svg";
      void fromUuid(plate.uuid)
        .then((r) => fill((r as Record<string, unknown> | null) ?? null))
        .catch(() => fill(null));
    }

    // Track which plate the pointer is over, so the keybindings have a target.
    el.addEventListener("pointerenter", () => {
      hoveredPlate = { barId: this.id, plateId: plate.id };
    });
    el.addEventListener("pointerleave", () => {
      if (hoveredPlate?.plateId === plate.id) hoveredPlate = null;
    });

    // Clicks on a plate: one toggles the speaker (controllers), two open the
    // sheet (anyone who may view it).
    //
    // We count the clicks OURSELVES rather than listening for `dblclick`. What
    // the browser calls a double-click is decided by the OS (~500ms on Windows)
    // and is neither readable nor settable from JS — so a deliberate second click
    // to switch Speaking Mode back off was being swallowed as a double-click,
    // which opened a sheet nobody asked for AND cancelled the speaker change.
    // With our own (shorter, configurable) window, a considered re-click reads as
    // two singles and only a genuinely quick double opens the sheet.
    el.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      // The controls always have their own handlers; the name only has one for
      // controllers, so for a player the name is just part of the plate.
      if (target.closest(".bivouac-plate__controls")) return;
      if (controller && target.closest(".bivouac-plate__name")) return;

      const dblWindow = castDoubleClickMs();
      const now = Date.now();
      const isDouble = this.#lastClick?.id === plate.id && now - this.#lastClick.at <= dblWindow;

      if (isDouble) {
        this.#lastClick = null; // so a third click starts a fresh pair
        // Drop the pending speaker write and put the highlight back where the
        // scene says it is — the second click meant "open this", not "toggle".
        if (this.#clickTimer) {
          window.clearTimeout(this.#clickTimer);
          this.#clickTimer = null;
          this.#applySpeakerHighlight(d.speakerId);
        }
        if (doc && canView(doc)) (doc.sheet as { render?: (b: boolean) => void })?.render?.(true);
        return;
      }

      this.#lastClick = { id: plate.id, at: now };
      if (!controller) return; // players get the sheet on a double, nothing on a single

      // Toggle the speaker. The highlight moves IMMEDIATELY (optimistic) so it
      // feels instant, while the write waits out the double-click window — the
      // two delays are the same number for exactly this reason.
      //
      // Any timer still pending here belongs to a DIFFERENT plate (a second click
      // on this one was handled as a double above), so it's stale — the speaker is
      // single-valued and the user has moved on. Drop it and let this click win,
      // rather than ignoring the click, which is what the old fixed-delay code did
      // and which would only feel deader the longer the window is set.
      if (this.#clickTimer) {
        window.clearTimeout(this.#clickTimer);
        this.#clickTimer = null;
      }
      const makeSpeaker = !el.classList.contains("bivouac-plate--speaker");
      this.#applySpeakerHighlight(makeSpeaker ? plate.id : null);
      this.#clickTimer = window.setTimeout(() => {
        this.#clickTimer = null;
        void this.#setSpeaker(plate.id);
      }, dblWindow);
    });

    if (controller) {
      // Click the name → toggle whether players see it (they get "?").
      name.classList.add("bivouac-plate__name--editable");
      name.title = game.i18n.localize("BIVOUAC.CastBar.NameToggle");
      name.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.#toggleName(plate.id);
      });
      // Hover hint: a "?" badge over the name makes it obvious that clicking hides
      // it (CSS reveals it on name hover, only while the name is currently shown).
      const hint = document.createElement("span");
      hint.className = "bivouac-plate__namehint";
      hint.textContent = "?";
      hint.setAttribute("aria-hidden", "true");
      el.appendChild(hint);
      el.appendChild(this.#controls(plate, el));
      this.#wireReorderTarget(el, plate.id);
    }

    return el;
  }

  /** GM hover controls: reorder grip · exit · hide · remove. */
  #controls(plate: Plate, el: HTMLElement): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "bivouac-plate__controls";

    const grip = document.createElement("span");
    grip.className = "bivouac-plate__grip";
    grip.draggable = true;
    grip.title = game.i18n.localize("BIVOUAC.CastBar.Reorder");
    grip.innerHTML = `<i class="fa-solid fa-grip"></i>`;
    grip.addEventListener("dragstart", (e) => {
      this.#dragId = plate.id;
      el.classList.add("bivouac-plate--dragging");
      e.dataTransfer?.setData("text/plain", plate.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    grip.addEventListener("dragend", () => {
      this.#dragId = null;
      el.classList.remove("bivouac-plate--dragging");
      this.#clearDropMarks();
    });
    bar.appendChild(grip);

    const btn = (
      icon: string,
      titleKey: string,
      cls: string,
      on: () => void,
    ): void => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `bivouac-plate__ctrl ${cls}`.trim();
      b.title = game.i18n.localize(titleKey);
      b.innerHTML = `<i class="fa-solid ${icon}"></i>`;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        on();
      });
      bar.appendChild(b);
    };

    btn(
      plate.exited
        ? "fa-arrow-right-to-bracket"
        : "fa-arrow-right-from-bracket",
      plate.exited ? "BIVOUAC.CastBar.Enter" : "BIVOUAC.CastBar.Exit",
      "",
      () => void this.#mutate(plate.id, (p) => (p.exited = !p.exited)),
    );
    btn(
      plate.hidden ? "fa-eye" : "fa-eye-slash",
      plate.hidden ? "BIVOUAC.CastBar.Show" : "BIVOUAC.CastBar.Hide",
      "",
      () => void this.#mutate(plate.id, (p) => (p.hidden = !p.hidden)),
    );
    btn(
      "fa-heart-pulse",
      plate.stats ? "BIVOUAC.CastBar.StatsHide" : "BIVOUAC.CastBar.StatsShow",
      plate.stats ? "bivouac-plate__ctrl--active" : "",
      () => void this.#mutate(plate.id, (p) => (p.stats = !p.stats)),
    );
    btn(
      "fa-xmark",
      "BIVOUAC.CastBar.Remove",
      "bivouac-plate__ctrl--danger",
      () => void this.#remove(plate.id),
    );
    return bar;
  }

  /** Make a plate a drop target for reordering: before/after by which half the
   *  pointer is over (along the bar's main axis). */
  #wireReorderTarget(el: HTMLElement, targetId: string): void {
    el.addEventListener("dragover", (e) => {
      if (!this.#dragId) return; // external doc drops fall through to the strip
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const after = this.#vertical()
        ? e.clientY - rect.top > rect.height / 2
        : e.clientX - rect.left > rect.width / 2;
      this.#clearDropMarks();
      el.classList.add(
        after ? "bivouac-plate--drop-after" : "bivouac-plate--drop-before",
      );
      el.dataset.after = String(after);
    });
    el.addEventListener("dragleave", () => this.#clearDropMarks());
    el.addEventListener("drop", (e) => {
      if (!this.#dragId) return;
      e.preventDefault();
      const dragId = this.#dragId;
      const after = el.dataset.after === "true";
      this.#dragId = null;
      this.#clearDropMarks();
      void this.#reorder(dragId, targetId, after);
    });
  }

  #clearDropMarks(): void {
    this.#el
      ?.querySelectorAll(
        ".bivouac-plate--drop-before, .bivouac-plate--drop-after",
      )
      .forEach((n) =>
        n.classList.remove(
          "bivouac-plate--drop-before",
          "bivouac-plate--drop-after",
        ),
      );
  }
}

/** Primary Cast Bar — always on, per-client dock (default right). */
export const castBar = new CastBar({
  flag: FLAGS.castBar,
  dockSetting: SETTINGS.castBarDock,
  tabPosSetting: SETTINGS.castBarTabPos,
  tabPadSetting: SETTINGS.castBarTabPad,
  sizeSetting: SETTINGS.castBarSize,
  scaleSetting: SETTINGS.castBarScale,
  elId: "bivouac-castbar",
  tabId: "bivouac-castbar-tab",
  optional: false,
});

/** Optional second Cast Bar (e.g. NPCs vs party) — its own scene roster + a world
 *  "off/edge" dock; it shares the primary's size / tab-position / tab-padding. */
export const castBar2 = new CastBar({
  flag: FLAGS.castBar2,
  dockSetting: SETTINGS.castBar2Dock,
  tabPosSetting: SETTINGS.castBarTabPos,
  tabPadSetting: SETTINGS.castBarTabPad,
  sizeSetting: SETTINGS.castBarSize,
  scaleSetting: SETTINGS.castBar2Scale,
  elId: "bivouac-castbar-2",
  tabId: "bivouac-castbar-tab-2",
  optional: true,
});

/** Both bars, for mount/refresh fan-out. */
export const castBars = [castBar, castBar2];
