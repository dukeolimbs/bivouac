/** Bivouac — the world layer: a DOM surface over the canvas whose transform
 *  tracks the scene's pan/zoom, hosting widgets placed on scene grid squares. */

import { GRID, LOD, MODULE_ID, SETTINGS, type Widget, type WidgetCell, type WidgetType } from "./constants";
import { activeLandingScene, readLayout, writeLayout } from "./layout";
import {
  applyBackground,
  applyFrameStyle,
  attachInteractions,
  backgroundOf,
  createWidget,
  frameOf,
  getWidgetType,
  refsUuid,
  type RenderContext,
} from "./widgets";
import { openWidgetConfig } from "./widget-config";
import { normalizeDropData, widgetFromDrop } from "./drop";

/** The PIXI stage transform, sampled per frame to map world coords → screen. */
interface Stage {
  px: number;
  py: number;
  scale: number;
  ox: number;
  oy: number;
}

interface RenderedWidget {
  el: HTMLElement;
  sig: string;
  /** Last-known cell, so syncTransform can reposition without re-reading flags. */
  cell: WidgetCell;
}

class WorldLayer {
  #overlay: HTMLElement | null = null;
  #world: HTMLElement | null = null;
  #rendered = new Map<string, RenderedWidget>();
  #editMode = false;
  #lodTimer = 0;
  #dragging = false;
  #selected = new Set<string>();

  constructor() {
    // Global listeners, installed once. All no-op unless the board is mounted,
    // so they're cheap when Bivouac isn't in use.
    document.addEventListener("keydown", (e) => this.#onKeyDown(e));
    document.addEventListener("pointerdown", (e) => this.#onGlobalPointerDown(e), true);
    window.addEventListener("wheel", this.#onWheel, { capture: true, passive: false });
  }

  get editMode(): boolean {
    return this.#editMode;
  }

  /** Pixel size of one scene grid square. */
  #gridSize(): number {
    return canvas?.grid?.size || 100;
  }

  /** Max widget size in squares (GM-configurable; falls back to GRID.max). */
  #maxCells(): number {
    const v = Number(game.settings.get(MODULE_ID, SETTINGS.maxWidgetSize));
    return Number.isFinite(v) && v >= GRID.min ? v : GRID.max;
  }

  /** Sample the PIXI stage transform for world→screen mapping. */
  #stageParams(): Stage | null {
    const s = canvas?.stage;
    if (!s) return null;
    return { px: s.position.x, py: s.position.y, scale: s.scale.x, ox: s.pivot.x, oy: s.pivot.y };
  }

  /** Publish scale / grid metrics as CSS vars so widget CHROME stays at scale 1
   *  (crisp) while CONTENT and the grid guides still track zoom.
   *  `--bivouac-scale` scales notes; `--bivouac-webview-scale` scales the
   *  logical-resolution iframes; the grid vars draw the guides in screen space. */
  #applyStageVars(t: Stage, gs: number): void {
    const w = this.#world;
    if (!w) return;
    w.style.setProperty("--bivouac-scale", `${t.scale}`);
    w.style.setProperty("--bivouac-grid-screen", `${gs * t.scale}px`);
    w.style.setProperty("--bivouac-grid-x", `${t.px - t.scale * t.ox}px`);
    w.style.setProperty("--bivouac-grid-y", `${t.py - t.scale * t.oy}px`);
  }

  #readWidget(id: string): Widget | null {
    const scene = activeLandingScene();
    if (!scene) return null;
    return readLayout(scene).widgets.find((w) => w.id === id) ?? null;
  }

  /* ---------------------------------------- mount / lifecycle ---------- */

  refresh(): void {
    if (activeLandingScene()) {
      this.#mount();
      this.syncTransform();
      this.render("refresh");
    } else {
      this.#unmount();
    }
  }

  #mount(): void {
    if (this.#overlay) return;
    const iface = document.getElementById("interface");
    if (!iface) return;

    const overlay = document.createElement("div");
    overlay.id = "bivouac-overlay";
    overlay.classList.toggle("bivouac-edit", this.#editMode);

    const world = document.createElement("div");
    world.id = "bivouac-world";
    overlay.appendChild(world);
    iface.appendChild(overlay);

    this.#overlay = overlay;
    this.#world = world;
  }

  /** Handle a document dropped on the scene canvas (via the `dropCanvasData`
   *  hook). Only intercepts while EDITING a landing scene — so normal
   *  token/note drops still work in view mode. Returns false to prevent
   *  Foundry's default (e.g. creating a token) when we take the drop. */
  handleCanvasDrop(data: { x?: number; y?: number } & Record<string, unknown>): boolean | void {
    if (!game.user?.isGM || !this.#editMode || !activeLandingScene()) return;
    const doc = normalizeDropData(data);
    if (!doc) return;
    const gs = this.#gridSize();
    const gx = Math.round((data.x ?? 0) / gs) - Math.floor(GRID.defaultSize / 2);
    const gy = Math.round((data.y ?? 0) / gs) - Math.floor(GRID.defaultSize / 2);
    void (async () => {
      const widget = await widgetFromDrop(doc, gx, gy);
      if (!widget) return;
      await this.updateWidget(widget);
      this.#selectWidget(widget.id, false);
    })();
    return false; // we handled it — don't also create a token/note
  }

  /** Re-render (in place) only the tiles that reference `uuid` — called when the
   *  underlying document changes, so doc tiles stay live without rebuilding
   *  (and reloading) every tile. */
  refreshDocTiles(uuid: string): void {
    const scene = activeLandingScene();
    const t = this.#stageParams();
    if (!scene || !t || !this.#world) return;
    const gs = this.#gridSize();
    const isGM = !!game.user?.isGM;
    for (const w of readLayout(scene).widgets) {
      if (!refsUuid(w, uuid)) continue;
      const rec = this.#rendered.get(w.id);
      if (!rec) continue;
      const el = this.#buildWidget(w, { gs, isGM, lod: false });
      this.#position(el, w.cell, gs, t);
      rec.el.replaceWith(el);
      this.#rendered.set(w.id, { el, sig: rec.sig, cell: { ...w.cell } });
    }
    this.#applySelectionClasses();
  }

  #unmount(): void {
    this.#overlay?.remove();
    this.#overlay = null;
    this.#world = null;
    this.#rendered.clear();
  }

  /** Track the map. Widgets are positioned in SCREEN space (world→screen each
   *  frame) instead of living inside a CSS-scaled layer, so their chrome
   *  (borders/shadows/radii) renders at scale 1 and stays crisp at any zoom. */
  syncTransform(): void {
    const t = this.#stageParams();
    if (!this.#world || !t) return;
    const gs = this.#gridSize();
    this.#applyStageVars(t, gs);
    if (!this.#dragging) {
      for (const rec of this.#rendered.values()) this.#position(rec.el, rec.cell, gs, t);
    }
    this.scheduleLOD();
  }

  /* ---------------------------------------- edit mode ------------------ */

  setEditMode(on: boolean): void {
    this.#editMode = on;
    this.#overlay?.classList.toggle("bivouac-edit", on);
    if (!on) this.#selected.clear(); // no lingering selection outside edit mode
    this.render("edit-mode");
  }

  /* ---------------------------------------- rendering ------------------ */

  /** Reconciling render. Signature excludes position (gx/gy) so moving a widget
   *  only repositions it — iframes are preserved. It DOES include size (gw/gh),
   *  mode, and LOD, so those changes rebuild the affected widget. */
  render(_reason: string): void {
    if (!this.#world || this.#dragging) return;
    const scene = activeLandingScene();
    const t = this.#stageParams();
    if (!scene || !t) return;

    const gs = this.#gridSize();
    const isGM = !!game.user?.isGM;
    this.#applyStageVars(t, gs);

    let widgets = readLayout(scene).widgets;
    if (!isGM) widgets = widgets.filter((w) => w.scope !== "dm"); // filter, don't just hide

    const webviewCount = widgets.filter((w) => w.type === "webview").length;
    // How many web views may be live before LOD can kick in — a per-client
    // setting (falls back to the built-in default).
    const rawMin = Number(game.settings.get(MODULE_ID, SETTINGS.lodMinWebviews));
    const lodMin = Number.isFinite(rawMin) && rawMin > 0 ? rawMin : LOD.minWebviews;
    const lodActive = webviewCount >= lodMin && t.scale <= LOD.farScale;

    const seen = new Set<string>();
    for (const widget of widgets) {
      seen.add(widget.id);
      const lod = widget.type === "webview" && lodActive;
      const sig = JSON.stringify({
        t: widget.type,
        c: widget.config,
        title: widget.title,
        chrome: widget.chrome,
        scope: widget.scope,
        w: widget.cell.gw,
        h: widget.cell.gh,
        edit: this.#editMode,
        lod,
      });

      const existing = this.#rendered.get(widget.id);
      if (existing && existing.sig === sig) {
        existing.cell = { ...widget.cell };
        this.#position(existing.el, widget.cell, gs, t); // move only — no rebuild
        continue;
      }
      const el = this.#buildWidget(widget, { gs, isGM, lod });
      this.#position(el, widget.cell, gs, t);
      if (existing) existing.el.replaceWith(el);
      else this.#world.appendChild(el);
      this.#rendered.set(widget.id, { el, sig, cell: { ...widget.cell } });
    }

    for (const [id, rec] of this.#rendered) {
      if (!seen.has(id)) {
        rec.el.remove();
        this.#rendered.delete(id);
      }
    }

    // Reconciling rebuilds elements, and gone widgets can't stay selected.
    for (const id of [...this.#selected]) if (!seen.has(id)) this.#selected.delete(id);
    this.#applySelectionClasses();
  }

  /** Screen rect (px) for a cell, inset by GRID.gap on every side so adjacent
   *  widgets keep a gap. The gap is world px (gs × GRID.gap), so it scales with
   *  zoom. Shared by #position and the drag path, keeping both consistent. */
  #screenRect(cell: WidgetCell, gs: number, t: Stage): { left: number; top: number; width: number; height: number } {
    const g = gs * GRID.gap;
    return {
      left: t.px + t.scale * (cell.gx * gs + g - t.ox),
      top: t.py + t.scale * (cell.gy * gs + g - t.oy),
      width: Math.max(0, cell.gw * gs - 2 * g) * t.scale,
      height: Math.max(0, cell.gh * gs - 2 * g) * t.scale,
    };
  }

  /** Place a widget in SCREEN pixels via #screenRect. Size scales with zoom;
   *  the element's chrome does not. */
  #position(el: HTMLElement, cell: WidgetCell, gs: number, t: Stage): void {
    const r = this.#screenRect(cell, gs, t);
    el.style.left = `${r.left}px`;
    el.style.top = `${r.top}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
  }

  #buildWidget(widget: Widget, extra: { gs: number; isGM: boolean; lod: boolean }): HTMLElement {
    const el = document.createElement("div");
    el.className = "bivouac-widget";
    el.dataset.id = widget.id;
    if (widget.scope === "dm") el.classList.add("bivouac-dm-scope");
    this.#applyTileStyle(el, widget);

    // Click anywhere on a widget (except its buttons) to select it; the
    // header/resize drag path selects too (it stops propagation before this).
    if (this.#editMode) {
      el.addEventListener("pointerdown", (e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        this.#selectWidget(widget.id, e.shiftKey || e.ctrlKey || e.metaKey);
      });
    }

    const header = document.createElement("header");
    header.className = "bivouac-widget__header";
    const def = getWidgetType(widget.type);
    const title = document.createElement("span");
    title.className = "bivouac-widget__title";
    title.textContent = widget.title || (def ? game.i18n.localize(def.label) : widget.type);
    header.appendChild(title);

    if (this.#editMode) {
      header.appendChild(this.#iconButton("fa-solid fa-gear", "BIVOUAC.Edit.Configure", (e) => {
        e.stopPropagation();
        // Read the CURRENT widget by id: a move repositions the element without
        // rebuilding, so this closure's `widget` holds the stale build-time
        // cell. Editing from that copy is what made the widget jump back on
        // Save. Also re-read the live cell at save time in case it moved while
        // the dialog was open.
        const current = this.#readWidget(widget.id) ?? widget;
        openWidgetConfig(
          current,
          (updated) => this.#saveConfigured(widget.id, updated),
          (updated) => this.previewWidget(updated),
        );
      }));
      header.appendChild(this.#iconButton("fa-solid fa-clone", "BIVOUAC.Edit.Duplicate", (e) => {
        e.stopPropagation();
        void this.duplicateWidget(widget.id);
      }));
      header.appendChild(this.#iconButton("fa-solid fa-trash", "BIVOUAC.Edit.Delete", (e) => {
        e.stopPropagation();
        void this.deleteWidget(widget.id);
      }));
      header.addEventListener("pointerdown", (e) => this.#beginDrag(e, widget.id, "move"));
    }
    el.appendChild(header);

    const ctx: RenderContext = {
      widget,
      gridSize: extra.gs,
      editMode: this.#editMode,
      isGM: extra.isGM,
      lod: extra.lod,
    };
    const body = document.createElement("div");
    body.className = "bivouac-widget__body";
    // Content lives in a per-widget scaler: it renders at world resolution and
    // the scaler applies the zoom (via --bivouac-scale), reproducing the old
    // scaled-world behavior for content — while the widget FRAME around it stays
    // in screen space and crisp. (Content type does its own thing at scale 1.)
    const scaler = document.createElement("div");
    scaler.className = "bivouac-scaler";
    scaler.appendChild(def ? def.renderBody(ctx) : this.#unknown(widget.type));
    body.appendChild(scaler);
    el.appendChild(body);

    // Interactions are live only when NOT editing, so editing can click freely.
    // Attached per-widget, so multiple widgets can independently link to docs.
    if (!this.#editMode) attachInteractions(el, widget);

    if (this.#editMode) {
      const handle = document.createElement("div");
      handle.className = "bivouac-widget__resize";
      handle.addEventListener("pointerdown", (e) => this.#beginDrag(e, widget.id, "resize"));
      el.appendChild(handle);
    }
    return el;
  }

  /** Apply a tile's STYLE in place: frame/background classes + colour vars +
   *  (edit-mode) header title text. No rebuild — cheap, and never reloads a web
   *  view iframe. Used by the builder and by live config preview. */
  #applyTileStyle(el: HTMLElement, widget: Widget): void {
    el.classList.remove(
      "bivouac-frame-none", "bivouac-frame-subtle", "bivouac-frame-framed",
      "bivouac-bg-none", "bivouac-bg-solid", "bivouac-bg-frosted", "bivouac-bg-gradient", "bivouac-bg-image",
    );
    el.classList.add(`bivouac-frame-${frameOf(widget)}`, `bivouac-bg-${backgroundOf(widget)}`);
    applyFrameStyle(el, widget);
    applyBackground(el, widget);
    const titleEl = el.querySelector(".bivouac-widget__title");
    if (titleEl) {
      const def = getWidgetType(widget.type);
      titleEl.textContent = widget.title || (def ? game.i18n.localize(def.label) : widget.type);
    }
  }

  /** Live-preview a tile from its config dialog, in place and WITHOUT touching
   *  the layout: always the style (frame/background/colour/opacity/title); and
   *  for note/image tiles also the CONTENT (text/font/src). Web views are left
   *  alone so their iframe never reloads mid-edit — those commit on Save. */
  previewWidget(widget: Widget): void {
    const rec = this.#rendered.get(widget.id);
    if (!rec) return;
    this.#applyTileStyle(rec.el, widget);
    if (widget.type === "webview") return; // never re-render a web view live (iframe reload)
    const scaler = rec.el.querySelector(".bivouac-scaler");
    const def = getWidgetType(widget.type);
    if (!scaler || !def) return;
    const ctx: RenderContext = {
      widget,
      gridSize: this.#gridSize(),
      editMode: this.#editMode,
      isGM: !!game.user?.isGM,
      lod: false,
    };
    scaler.replaceChildren(def.renderBody(ctx));
  }

  #unknown(type: string): HTMLElement {
    const box = document.createElement("div");
    box.className = "bivouac-placeholder";
    box.textContent = game.i18n.format("BIVOUAC.Widgets.Unknown", { type });
    return box;
  }

  #iconButton(icon: string, titleKey: string, onClick: (e: PointerEvent) => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bivouac-widget__btn";
    btn.title = game.i18n.localize(titleKey);
    const i = document.createElement("i");
    i.className = icon;
    btn.appendChild(i);
    btn.addEventListener("click", (e) => onClick(e as unknown as PointerEvent));
    return btn;
  }

  /* ---------------------------------------- drag / resize -------------- */

  #beginDrag(event: PointerEvent, widgetId: string, mode: "move" | "resize"): void {
    if (!this.#editMode) return;
    if ((event.target as HTMLElement).closest("button")) return; // ignore button drags

    // Read the CURRENT widget so a prior resize/move isn't lost (no stale copy).
    const widget = this.#readWidget(widgetId);
    const rec = this.#rendered.get(widgetId);
    const t = this.#stageParams();
    if (!widget || !rec || !t) return;

    // Grabbing a widget selects it — but keep an existing multi-selection intact
    // when grabbing one of its members, so the whole group can be moved together.
    this.#selectForDrag(widgetId, event.shiftKey || event.ctrlKey || event.metaKey);

    event.preventDefault();
    event.stopPropagation();
    const gs = this.#gridSize();
    const scale = t.scale;
    const maxCells = this.#maxCells();
    const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

    // A move on any member of a multi-selection drags the whole group; a resize
    // only ever affects the grabbed widget. Capture each element's start rect in
    // SCREEN pixels, so drag deltas are plain screen offsets (the layer is no
    // longer scaled).
    const group = mode === "move" && this.#selected.has(widgetId) && this.#selected.size > 1;
    const ids = group ? [...this.#selected] : [widgetId];
    const dragees: {
      id: string;
      el: HTMLElement;
      cell: WidgetCell;
      sL: number;
      sT: number;
      sW: number;
      sH: number;
    }[] = [];
    for (const id of ids) {
      const w = this.#readWidget(id);
      const r = this.#rendered.get(id);
      if (!w || !r) continue;
      const cell = { ...w.cell };
      const sr = this.#screenRect(cell, gs, t);
      dragees.push({ id, el: r.el, cell, sL: sr.left, sT: sr.top, sW: sr.width, sH: sr.height });
      r.el.classList.add("bivouac-dragging");
    }

    const primary = rec.el;
    const start = { x: event.clientX, y: event.clientY };
    this.#dragging = true;
    primary.setPointerCapture(event.pointerId);

    // Widget rects are inset by the gap, so the min/max screen sizes are too.
    const g = gs * GRID.gap;
    const minPx = Math.max(0, GRID.min * gs - 2 * g) * scale;
    const maxPx = Math.max(0, maxCells * gs - 2 * g) * scale;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (mode === "move") {
        for (const d of dragees) {
          d.el.style.left = `${d.sL + dx}px`;
          d.el.style.top = `${d.sT + dy}px`;
        }
      } else {
        // Clamp live to [min, max] (screen px) so the widget can't grow past
        // the cap and then snap back on release (the old surprise).
        const d = dragees[0];
        d.el.style.width = `${clamp(d.sW + dx, minPx, maxPx)}px`;
        d.el.style.height = `${clamp(d.sH + dy, minPx, maxPx)}px`;
      }
    };

    const onUp = (ev: PointerEvent) => {
      primary.releasePointerCapture(ev.pointerId);
      primary.removeEventListener("pointermove", onMove);
      primary.removeEventListener("pointerup", onUp);
      for (const d of dragees) d.el.classList.remove("bivouac-dragging");
      this.#dragging = false;

      const updates = new Map<string, WidgetCell>();
      if (mode === "move") {
        for (const d of dragees) {
          // Screen → world → cell. The element's edge is inset by the gap `g`,
          // so subtract it before snapping to a cell.
          const worldLeft = (parseFloat(d.el.style.left) - t.px) / scale + t.ox - g;
          const worldTop = (parseFloat(d.el.style.top) - t.py) / scale + t.oy - g;
          const gx = Math.max(0, Math.round(worldLeft / gs));
          const gy = Math.max(0, Math.round(worldTop / gs));
          updates.set(d.id, { ...d.cell, gx, gy });
        }
      } else {
        // Element size is (cells × gs − 2g) × scale, so add back 2g to recover cells.
        const d = dragees[0];
        const gw = clamp(Math.round((parseFloat(d.el.style.width) / scale + 2 * g) / gs), GRID.min, maxCells);
        const gh = clamp(Math.round((parseFloat(d.el.style.height) / scale + 2 * g) / gs), GRID.min, maxCells);
        updates.set(d.id, { ...d.cell, gw, gh });
      }

      // Snap elements to the grid immediately (screen space) and keep each
      // rendered record's cell in sync — so a no-op write (snapped == current)
      // still leaves them aligned, and syncTransform repositions correctly.
      for (const d of dragees) {
        const cell = updates.get(d.id);
        if (!cell) continue;
        this.#position(d.el, cell, gs, t);
        const rr = this.#rendered.get(d.id);
        if (rr) rr.cell = cell;
      }
      void this.#applyCellUpdates(updates);
    };

    primary.addEventListener("pointermove", onMove);
    primary.addEventListener("pointerup", onUp);
  }

  /* ---------------------------------------- mutations ------------------ */

  async addWidget(type: WidgetType): Promise<void> {
    const scene = activeLandingScene();
    if (!scene) return;
    const gs = this.#gridSize();
    const center = canvas.canvasCoordinatesFromClient({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const gx = Math.max(0, Math.round(center.x / gs) - Math.floor(GRID.defaultSize / 2));
    const gy = Math.max(0, Math.round(center.y / gs) - Math.floor(GRID.defaultSize / 2));
    const widget = createWidget(type, gx, gy);
    // Configure first, then commit on Save (#saveConfigured → updateWidget
    // inserts the not-yet-present widget). So adding is a SINGLE undoable step
    // and cancelling the dialog leaves no empty widget behind.
    openWidgetConfig(widget, (updated) => this.#saveConfigured(widget.id, updated));
  }

  async updateWidget(widget: Widget): Promise<void> {
    const scene = activeLandingScene();
    if (!scene) return;
    const layout = readLayout(scene);
    const idx = layout.widgets.findIndex((w) => w.id === widget.id);
    if (idx === -1) layout.widgets.push(widget);
    else layout.widgets[idx] = widget;
    await writeLayout(scene, layout);
  }

  /** Persist a widget edited via the config form, always keeping whatever cell
   *  it currently has in the layout — position/size are owned by drag/resize,
   *  never the config dialog, so a move during editing is never clobbered. */
  #saveConfigured(id: string, updated: Widget): void {
    const live = this.#readWidget(id);
    void this.updateWidget(live ? { ...updated, cell: live.cell } : updated);
  }

  /** Clone a widget with a fresh id, offset one full width to the right so the
   *  copy lands flush beside the original (no overlap), and select the copy. */
  async duplicateWidget(id: string): Promise<void> {
    const scene = activeLandingScene();
    if (!scene) return;
    const src = this.#readWidget(id);
    if (!src) return;
    const clone: Widget = foundry.utils.deepClone(src);
    clone.id = foundry.utils.randomID();
    clone.cell = { ...src.cell, gx: src.cell.gx + src.cell.gw };
    const layout = readLayout(scene);
    layout.widgets.push(clone);
    await writeLayout(scene, layout);
    this.#selectWidget(clone.id, false);
  }

  async deleteWidget(id: string): Promise<void> {
    return this.deleteWidgets([id]);
  }

  /** Remove several widgets in a single layout write. No confirm — Ctrl+Z
   *  undoes a mistaken delete. */
  async deleteWidgets(ids: string[]): Promise<void> {
    const scene = activeLandingScene();
    if (!scene || ids.length === 0) return;
    const kill = new Set(ids);
    const layout = readLayout(scene);
    const before = layout.widgets.length;
    layout.widgets = layout.widgets.filter((w) => !kill.has(w.id));
    for (const id of ids) this.#selected.delete(id);
    if (layout.widgets.length !== before) await writeLayout(scene, layout);
  }

  /** Commit a batch of cell changes (from a single- or group-drag) in one write. */
  async #applyCellUpdates(updates: Map<string, WidgetCell>): Promise<void> {
    const scene = activeLandingScene();
    if (!scene || updates.size === 0) return;
    const layout = readLayout(scene);
    let changed = false;
    for (const w of layout.widgets) {
      const cell = updates.get(w.id);
      if (cell) {
        w.cell = cell;
        changed = true;
      }
    }
    if (changed) await writeLayout(scene, layout);
  }

  /* ---------------------------------------- selection ----------------- */

  #selectWidget(id: string, additive: boolean): void {
    if (additive) {
      if (this.#selected.has(id)) this.#selected.delete(id);
      else this.#selected.add(id);
    } else {
      this.#selected = new Set([id]);
    }
    this.#applySelectionClasses();
  }

  /** Like #selectWidget, but a plain grab of an already-selected widget keeps
   *  the current (possibly multi-) selection so a group drag can start. */
  #selectForDrag(id: string, additive: boolean): void {
    if (additive) {
      if (this.#selected.has(id)) this.#selected.delete(id);
      else this.#selected.add(id);
      this.#applySelectionClasses();
    } else if (!this.#selected.has(id)) {
      this.#selectWidget(id, false);
    }
  }

  #applySelectionClasses(): void {
    for (const [id, rec] of this.#rendered) {
      rec.el.classList.toggle("bivouac-selected", this.#selected.has(id));
    }
  }

  /** Ids of widgets whose world-space rect intersects the box between two
   *  client-space points. Players never see dm-scope widgets, so skip them. */
  #widgetsInBox(a: { x: number; y: number }, b: { x: number; y: number }): string[] {
    const scene = activeLandingScene();
    if (!scene || !canvas) return [];
    const pa = canvas.canvasCoordinatesFromClient(a);
    const pb = canvas.canvasCoordinatesFromClient(b);
    const rx0 = Math.min(pa.x, pb.x);
    const ry0 = Math.min(pa.y, pb.y);
    const rx1 = Math.max(pa.x, pb.x);
    const ry1 = Math.max(pa.y, pb.y);
    const gs = this.#gridSize();
    const isGM = !!game.user?.isGM;
    let widgets = readLayout(scene).widgets;
    if (!isGM) widgets = widgets.filter((w) => w.scope !== "dm");
    const out: string[] = [];
    for (const w of widgets) {
      const wx0 = w.cell.gx * gs;
      const wy0 = w.cell.gy * gs;
      const wx1 = (w.cell.gx + w.cell.gw) * gs;
      const wy1 = (w.cell.gy + w.cell.gh) * gs;
      if (!(wx1 < rx0 || wx0 > rx1 || wy1 < ry0 || wy0 > ry1)) out.push(w.id);
    }
    return out;
  }

  /* ---------------------------------------- marquee ------------------- */

  /** Left-drag on the *empty* canvas (not on a widget or UI) draws a selection
   *  box. Bound in the capture phase so we can pre-empt Foundry's own drag
   *  without a surface overlay that would eat panning / zoom. */
  #onGlobalPointerDown(event: PointerEvent): void {
    if (!this.#world) return;
    // Right-drag pans the canvas even when it starts on a tile (tiles otherwise
    // capture the gesture, leaving no empty canvas to grab on a full board).
    if (event.button === 2) {
      this.#maybeBeginRightPan(event);
      return;
    }
    if (event.button !== 0 || !this.#editMode) return;
    const target = event.target as HTMLElement | null;
    const view = canvas?.app?.view ?? canvas?.app?.canvas;
    const onEmptyCanvas = !!target && (target.id === "board" || target === view);
    if (!onEmptyCanvas) return;
    this.#beginMarquee(event);
  }

  /* ---------------------------------------- pan / zoom over tiles ------ */

  /** Right-drag that starts on a tile drives a canvas pan ourselves (Foundry's
   *  own right-drag pan never fires because the tile captured the pointer).
   *  On empty canvas we do nothing and let Foundry pan natively. */
  #maybeBeginRightPan(event: PointerEvent): void {
    const target = event.target;
    const stage = canvas?.stage;
    if (!this.#overlay || !stage || !(target instanceof HTMLElement) || !target.closest(".bivouac-widget")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const scale = stage.scale.x || 1;
    const startCx = stage.pivot.x;
    const startCy = stage.pivot.y;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      canvas.pan({ x: startCx - dx / scale, y: startCy - dy / scale });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      // Swallow the context menu that follows a right-release after a drag.
      if (moved) {
        const kill = (e: Event) => e.preventDefault();
        window.addEventListener("contextmenu", kill, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("contextmenu", kill, true), 0);
      }
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
  }

  /** Wheel over a tile that consumes scroll (a note tall enough to scroll)
   *  scrolls that content instead of zooming the map; over any other tile we
   *  zoom the map ourselves (toward the cursor). **Ctrl/⌘ + wheel always zooms**
   *  the map, overriding content scroll. Over empty canvas we don't interfere —
   *  Foundry zooms natively. (Cross-origin web views capture their own wheel
   *  events, so those never reach here — the iframe scrolls itself.) */
  #onWheel = (event: WheelEvent): void => {
    if (!this.#overlay) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.closest(".bivouac-widget")) return; // empty canvas / UI → native zoom

    if (!(event.ctrlKey || event.metaKey)) {
      if (target.closest(".bivouac-webview")) {
        event.stopPropagation(); // let the web view scroll; block map zoom
        return;
      }
      const note = target.closest(".bivouac-note");
      if (note instanceof HTMLElement && note.scrollHeight - note.clientHeight > 1) {
        event.stopPropagation(); // let the note scroll
        return;
      }
    }

    // Zoom the map ourselves, anchored at the cursor.
    event.preventDefault();
    event.stopPropagation();
    this.#zoomAt(event.deltaY, event.clientX, event.clientY);
  };

  /** Zoom the canvas toward a client point (keeps the world point under the
   *  cursor fixed), matching Foundry's own wheel-zoom feel. */
  #zoomAt(deltaY: number, clientX: number, clientY: number): void {
    const stage = canvas?.stage;
    const view = canvas?.app?.view ?? canvas?.app?.canvas;
    if (!stage || !(view instanceof HTMLElement || view instanceof HTMLCanvasElement)) return;
    const cur = stage.scale.x || 1;
    const next = Math.max(0.05, Math.min(3, cur * (deltaY < 0 ? 1.1 : 1 / 1.1)));
    if (Math.abs(next - cur) < 1e-4) return;
    const p = canvas.canvasCoordinatesFromClient({ x: clientX, y: clientY });
    const r = view.getBoundingClientRect();
    canvas.pan({
      x: p.x - (clientX - (r.left + r.width / 2)) / next,
      y: p.y - (clientY - (r.top + r.height / 2)) / next,
      scale: next,
    });
  }

  /** Pan/zoom the canvas to frame all tiles (toolbar "Fit"). */
  fitToTiles(): void {
    const scene = activeLandingScene();
    if (!scene || !canvas?.stage) return;
    const widgets = readLayout(scene).widgets;
    if (!widgets.length) return;
    const gs = this.#gridSize();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const w of widgets) {
      minX = Math.min(minX, w.cell.gx * gs);
      minY = Math.min(minY, w.cell.gy * gs);
      maxX = Math.max(maxX, (w.cell.gx + w.cell.gw) * gs);
      maxY = Math.max(maxY, (w.cell.gy + w.cell.gh) * gs);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (w <= 0 || h <= 0) return;
    const pad = 1.15; // leave a margin (also absorbs the sidebar's viewport bite)
    const scale = Math.max(0.05, Math.min(3, Math.min(window.innerWidth / (w * pad), window.innerHeight / (h * pad))));
    canvas.animatePan({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, scale });
  }

  #beginMarquee(event: PointerEvent): void {
    const overlay = this.#overlay;
    if (!overlay) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = overlay.getBoundingClientRect();
    const startClient = { x: event.clientX, y: event.clientY };
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const base = additive ? new Set(this.#selected) : new Set<string>();

    const marquee = document.createElement("div");
    marquee.className = "bivouac-marquee";
    overlay.appendChild(marquee);
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      const cx = ev.clientX - rect.left;
      const cy = ev.clientY - rect.top;
      const w = Math.abs(cx - sx);
      const h = Math.abs(cy - sy);
      if (w > 3 || h > 3) moved = true;
      marquee.style.left = `${Math.min(sx, cx)}px`;
      marquee.style.top = `${Math.min(sy, cy)}px`;
      marquee.style.width = `${w}px`;
      marquee.style.height = `${h}px`;

      this.#selected = new Set(base);
      for (const id of this.#widgetsInBox(startClient, { x: ev.clientX, y: ev.clientY })) {
        this.#selected.add(id);
      }
      this.#applySelectionClasses();
    };

    const onUp = (ev: PointerEvent) => {
      ev.stopPropagation();
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      marquee.remove();
      // A bare click on empty space clears the selection (unless adding).
      if (!moved && !additive) {
        this.#selected.clear();
        this.#applySelectionClasses();
      }
    };

    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
  }

  /* ---------------------------------------- keyboard ------------------ */

  #onKeyDown(event: KeyboardEvent): void {
    if (!this.#editMode || !this.#overlay) return;
    if (event.key !== "Delete") return;
    if (this.#selected.size === 0) return;
    const t = event.target as HTMLElement | null;
    const tag = t?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
    event.preventDefault();
    event.stopPropagation();
    void this.deleteWidgets([...this.#selected]);
  }

  /* ---------------------------------------- LOD ------------------------ */

  /** Debounced re-evaluation after pan/zoom settles (LOD depends on zoom). */
  scheduleLOD(): void {
    window.clearTimeout(this.#lodTimer);
    this.#lodTimer = window.setTimeout(() => this.render("lod"), 150);
  }
}

export const worldLayer = new WorldLayer();
