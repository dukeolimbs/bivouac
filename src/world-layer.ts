/** Bivouac — the world layer: a DOM surface over the canvas whose transform
 *  tracks the scene's pan/zoom, hosting widgets placed on scene grid squares. */

import { GRID, LOD, MODULE_ID, SETTINGS, type Widget, type WidgetCell, type WidgetType } from "./constants";
import { activeLandingScene, readLayout, writeLayout } from "./layout";
import { attachInteractions, createWidget, getWidgetType, type RenderContext } from "./widgets";
import { openWidgetConfig } from "./widget-config";

interface RenderedWidget {
  el: HTMLElement;
  sig: string;
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
    // Global listeners, installed once. Both no-op unless we're in edit mode
    // with a mounted board, so they're cheap when Bivouac isn't in use.
    document.addEventListener("keydown", (e) => this.#onKeyDown(e));
    document.addEventListener("pointerdown", (e) => this.#onGlobalPointerDown(e), true);
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

  #unmount(): void {
    this.#overlay?.remove();
    this.#overlay = null;
    this.#world = null;
    this.#rendered.clear();
  }

  /** Mirror the PIXI stage transform so world-coordinate children track the map. */
  syncTransform(): void {
    if (!this.#world || !canvas?.stage) return;
    const s = canvas.stage;
    const scale = s.scale.x;
    this.#world.style.transform =
      `translate(${s.position.x}px, ${s.position.y}px) scale(${scale}) ` +
      `translate(${-s.pivot.x}px, ${-s.pivot.y}px)`;
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
    if (!scene) return;

    const gs = this.#gridSize();
    const scale = canvas?.stage?.scale?.x ?? 1;
    const isGM = !!game.user?.isGM;
    this.#world.style.setProperty("--bivouac-grid", `${gs}px`);

    let widgets = readLayout(scene).widgets;
    if (!isGM) widgets = widgets.filter((w) => w.scope !== "dm"); // filter, don't just hide

    const webviewCount = widgets.filter((w) => w.type === "webview").length;
    const lodActive = webviewCount >= LOD.minWebviews && scale <= LOD.farScale;

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
        this.#position(existing.el, widget.cell, gs); // move only — no rebuild
        continue;
      }
      const el = this.#buildWidget(widget, { gs, isGM, lod });
      this.#position(el, widget.cell, gs);
      if (existing) existing.el.replaceWith(el);
      else this.#world.appendChild(el);
      this.#rendered.set(widget.id, { el, sig });
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

  #position(el: HTMLElement, cell: WidgetCell, gs: number): void {
    el.style.left = `${cell.gx * gs}px`;
    el.style.top = `${cell.gy * gs}px`;
    el.style.width = `${cell.gw * gs}px`;
    el.style.height = `${cell.gh * gs}px`;
  }

  #buildWidget(widget: Widget, extra: { gs: number; isGM: boolean; lod: boolean }): HTMLElement {
    const el = document.createElement("div");
    el.className = `bivouac-widget bivouac-chrome-${widget.chrome}`;
    el.dataset.id = widget.id;
    if (widget.scope === "dm") el.classList.add("bivouac-dm-scope");

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
        openWidgetConfig(current, (updated) => this.#saveConfigured(widget.id, updated));
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
    body.appendChild(def ? def.renderBody(ctx) : this.#unknown(widget.type));
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

  #unknown(type: string): HTMLElement {
    const box = document.createElement("div");
    box.className = "bivouac-placeholder";
    box.textContent = `Unknown widget: ${type}`;
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
    if (!widget || !rec) return;

    // Grabbing a widget selects it — but keep an existing multi-selection intact
    // when grabbing one of its members, so the whole group can be moved together.
    this.#selectForDrag(widgetId, event.shiftKey || event.ctrlKey || event.metaKey);

    event.preventDefault();
    event.stopPropagation();
    const gs = this.#gridSize();
    const scale = canvas?.stage?.scale?.x ?? 1;
    const maxCells = this.#maxCells();
    const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

    // A move on any member of a multi-selection drags the whole group; a resize
    // only ever affects the grabbed widget.
    const group = mode === "move" && this.#selected.has(widgetId) && this.#selected.size > 1;
    const ids = group ? [...this.#selected] : [widgetId];
    const dragees: { id: string; el: HTMLElement; cell: WidgetCell }[] = [];
    for (const id of ids) {
      const w = this.#readWidget(id);
      const r = this.#rendered.get(id);
      if (!w || !r) continue;
      dragees.push({ id, el: r.el, cell: { ...w.cell } });
      r.el.classList.add("bivouac-dragging");
    }

    const primary = rec.el;
    const start = { x: event.clientX, y: event.clientY };
    this.#dragging = true;
    primary.setPointerCapture(event.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / scale;
      const dy = (ev.clientY - start.y) / scale;
      if (mode === "move") {
        for (const d of dragees) {
          d.el.style.left = `${d.cell.gx * gs + dx}px`;
          d.el.style.top = `${d.cell.gy * gs + dy}px`;
        }
      } else {
        // Clamp live to [min, max] so the widget can't grow past the cap and
        // then snap back on release (the old surprise).
        const d = dragees[0];
        d.el.style.width = `${clamp(d.cell.gw * gs + dx, GRID.min * gs, maxCells * gs)}px`;
        d.el.style.height = `${clamp(d.cell.gh * gs + dy, GRID.min * gs, maxCells * gs)}px`;
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
          const gx = Math.max(0, Math.round(parseFloat(d.el.style.left) / gs));
          const gy = Math.max(0, Math.round(parseFloat(d.el.style.top) / gs));
          updates.set(d.id, { ...d.cell, gx, gy });
        }
      } else {
        const d = dragees[0];
        const gw = clamp(Math.round(parseFloat(d.el.style.width) / gs), GRID.min, maxCells);
        const gh = clamp(Math.round(parseFloat(d.el.style.height) / gs), GRID.min, maxCells);
        updates.set(d.id, { ...d.cell, gw, gh });
      }

      // Snap the elements to the grid immediately. A drag whose snapped cell
      // equals the current cell writes identical data → no updateScene → no
      // render, which would otherwise leave the element at its raw drag offset.
      for (const d of dragees) {
        const cell = updates.get(d.id);
        if (cell) this.#position(d.el, cell, gs);
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
    const layout = readLayout(scene);
    layout.widgets.push(widget);
    await writeLayout(scene, layout);
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

  /** Remove several widgets in a single layout write. Only a multi-widget
   *  delete asks to confirm — deleting a single widget is cheap to redo. */
  async deleteWidgets(ids: string[]): Promise<void> {
    const scene = activeLandingScene();
    if (!scene || ids.length === 0) return;

    if (ids.length > 1) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("BIVOUAC.Confirm.DeleteTitle") },
        content: `<p>${game.i18n.format("BIVOUAC.Confirm.DeleteBody", { count: ids.length })}</p>`,
        modal: true,
      });
      if (!ok) return;
    }

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
    if (!this.#editMode || !this.#world) return;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const view = canvas?.app?.view ?? canvas?.app?.canvas;
    const onEmptyCanvas = !!target && (target.id === "board" || target === view);
    if (!onEmptyCanvas) return;
    this.#beginMarquee(event);
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
