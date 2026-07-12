/** Bivouac — the DM screen: a GM-only, right-docked drawer that stacks widgets.
 *  Layout persists per-GM on the User document. Cards can be drag-reordered. */

import { attachInteractions, createWidget, getWidgetType, type RenderContext } from "./widgets";
import { readDMLayout, writeDMLayout } from "./layout";
import { openWidgetConfig, pickWidgetType } from "./widget-config";
import { MODULE_ID, SETTINGS, type Widget, type WidgetType } from "./constants";

/** Drag-resize bounds for the drawer, in px (upper bounds also capped at 90vw /
 *  90vh). Width applies to left/right docks; height to top/bottom docks. */
const DRAWER_MIN = 280;
const DRAWER_MAX = 900;
const DRAWER_MIN_H = 160;
const DRAWER_MAX_H = 800;

const DOCK_MODES = ["beside", "over", "left", "top", "bottom"] as const;
type DockMode = (typeof DOCK_MODES)[number];

class DMScreen {
  #el: HTMLElement | null = null;
  #tab: HTMLElement | null = null;
  #editBtn: HTMLButtonElement | null = null;
  #open = false;
  #editMode = false;
  #dock: DockMode = "beside";
  #dragId: string | null = null;
  #sidebarRO: ResizeObserver | null = null;
  #sidebarMO: MutationObserver | null = null;
  #syncFrames = 0;
  #syncRunning = false;

  get isOpen(): boolean {
    return this.#open;
  }

  /** Mount the persistent, GM-only toggle tab. It lives outside the
   *  scene-controls group (so opening the DM screen never forces edit mode),
   *  sits just left of the right-hand UI column (inset via
   *  `--bivouac-dmtab-inset`) and above other elements. Also wires Esc-to-close
   *  while the drawer is open. */
  mountControl(): void {
    if (!game.user?.isGM || this.#tab) return;
    const iface = document.getElementById("interface") ?? document.body;
    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = "bivouac-dmscreen-tab";
    tab.className = "bivouac-dmscreen-tab";
    tab.title = game.i18n.localize("BIVOUAC.Controls.DMScreen");
    tab.setAttribute("aria-pressed", String(this.#open));
    tab.innerHTML = `<i class="fa-solid fa-chalkboard-user"></i>`;
    tab.addEventListener("click", () => this.toggle());
    iface.appendChild(tab);
    this.#tab = tab;

    this.#trackSidebar();
    this.applyDrawerSize();
    this.applyDock();
    window.addEventListener("resize", () => this.applyDrawerSize());
  }

  /** Which physical edge the drawer docks to. beside/over are both right-edge. */
  #dockSide(): "right" | "left" | "top" | "bottom" {
    return this.#dock === "left" || this.#dock === "top" || this.#dock === "bottom" ? this.#dock : "right";
  }

  /** Read the dock-mode setting and re-anchor the drawer (which edge it emerges
   *  from). Called on ready and whenever the setting changes (from the Foundry
   *  settings menu or the header gear). */
  applyDock(): void {
    const m = game.settings.get(MODULE_ID, SETTINGS.dmDock);
    this.#dock = (DOCK_MODES as readonly string[]).includes(m) ? (m as DockMode) : "beside";
    this.#applyDockClass();
    this.#syncTab();
  }

  #applyDockClass(): void {
    if (!this.#el) return;
    this.#el.classList.remove("bivouac-dock-right", "bivouac-dock-left", "bivouac-dock-top", "bivouac-dock-bottom");
    this.#el.classList.add(`bivouac-dock-${this.#dockSide()}`);
  }

  /* ------------------------------------------------ drawer width -------- */

  /** Push the persisted drawer width + height into their CSS vars, clamped to
   *  the resize bounds (and never past 90vw / 90vh). Width drives left/right
   *  docks; height drives top/bottom. */
  applyDrawerSize(): void {
    const savedW = Number(game.settings.get(MODULE_ID, SETTINGS.dmDrawerWidth) ?? 380);
    const savedH = Number(game.settings.get(MODULE_ID, SETTINGS.dmDrawerHeight) ?? 320);
    const w = Math.min(Math.min(DRAWER_MAX, window.innerWidth * 0.9), Math.max(DRAWER_MIN, Number.isFinite(savedW) ? savedW : 380));
    const h = Math.min(Math.min(DRAWER_MAX_H, window.innerHeight * 0.9), Math.max(DRAWER_MIN_H, Number.isFinite(savedH) ? savedH : 320));
    const root = document.documentElement.style;
    root.setProperty("--bivouac-drawer-w", `${Math.round(w)}px`);
    root.setProperty("--bivouac-drawer-h", `${Math.round(h)}px`);
  }

  /** Drag the drawer's inner (left) edge to resize; persist on release.
   *  Pointer capture keeps the drag alive over iframe content. */
  #startResize(e: PointerEvent, handle: HTMLElement): void {
    if (e.button !== 0) return;
    const el = this.#el;
    if (!el) return;
    e.preventDefault();
    const side = this.#dockSide();
    const vertical = side === "top" || side === "bottom";
    // The drawer's ANCHORED edge is fixed during the resize; the size is the gap
    // from that edge to the pointer.
    const rect = el.getBoundingClientRect();
    const maxW = Math.min(DRAWER_MAX, window.innerWidth * 0.9);
    const maxH = Math.min(DRAWER_MAX_H, window.innerHeight * 0.9);
    let width = rect.width;
    let height = rect.height;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("bivouac-resizing-drawer");
    document.body.style.cursor = vertical ? "ns-resize" : "ew-resize";
    const onMove = (ev: PointerEvent): void => {
      if (side === "right") width = Math.min(maxW, Math.max(DRAWER_MIN, rect.right - ev.clientX));
      else if (side === "left") width = Math.min(maxW, Math.max(DRAWER_MIN, ev.clientX - rect.left));
      else if (side === "top") height = Math.min(maxH, Math.max(DRAWER_MIN_H, ev.clientY - rect.top));
      else height = Math.min(maxH, Math.max(DRAWER_MIN_H, rect.bottom - ev.clientY));
      document.documentElement.style.setProperty(
        vertical ? "--bivouac-drawer-h" : "--bivouac-drawer-w",
        `${Math.round(vertical ? height : width)}px`,
      );
    };
    const onUp = (ev: PointerEvent): void => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      document.body.classList.remove("bivouac-resizing-drawer");
      document.body.style.cursor = "";
      void game.settings.set(
        MODULE_ID,
        vertical ? SETTINGS.dmDrawerHeight : SETTINGS.dmDrawerWidth,
        Math.round(vertical ? height : width),
      );
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  /* -------------------------------------------- sidebar tracking -------- */

  #sidebarEl(): HTMLElement | null {
    const el = document.getElementById("sidebar");
    if (el) return el;
    return ui.sidebar?.element instanceof HTMLElement ? ui.sidebar.element : null;
  }

  /** Reposition the tab now — e.g. after the padding setting changes. */
  refreshTab(): void {
    if (this.#tab) this.#scheduleSync();
  }

  #tabPad(): number {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--bivouac-dmtab-pad");
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 16;
  }

  /** Park the tab `--bivouac-dmtab-pad` px to the left of the sidebar's *live*
   *  left edge, so it stays just clear of the sidebar whatever its current
   *  width. Measured directly each call — no cached baseline — and clamped so
   *  it can never slide off-screen. (Clearing extra neighbours like a party-HUD
   *  is done by widening the pad for now; auto-avoidance is a backlog item.) */
  #syncTab = (): void => {
    const el = this.#sidebarEl();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return; // not laid out (e.g. mid-transition) — keep last position
    // Tab: park it `--bivouac-dmtab-pad` px left of the sidebar's live left edge.
    // Floor at 0 so negative padding can slide the tab right to the screen edge
    // (flush at most), without ever pushing it off-screen.
    if (this.#tab) {
      const inset = Math.max(0, window.innerWidth - rect.left + this.#tabPad());
      document.documentElement.style.setProperty("--bivouac-dmtab-inset", `${Math.round(inset)}px`);
    }
    // Right-dock offset: only "beside" tracks the sidebar's left edge (sits
    // beside it, never covering chat/dice). "over" and the non-right docks pin
    // to the viewport edge (0) — those dock classes ignore this var anyway.
    const drawerRight = this.#dock === "beside" ? Math.max(0, window.innerWidth - rect.left) : 0;
    document.documentElement.style.setProperty("--bivouac-drawer-right", `${Math.round(drawerRight)}px`);
  };

  /** Re-sync each frame for a short window so the tab follows the sidebar's
   *  expand/collapse animation to its settled position. Re-triggering extends
   *  the window rather than stacking loops. */
  #scheduleSync = (): void => {
    this.#syncFrames = 25;
    if (this.#syncRunning) return;
    this.#syncRunning = true;
    const step = (): void => {
      this.#syncTab();
      if (--this.#syncFrames > 0) requestAnimationFrame(step);
      else this.#syncRunning = false;
    };
    requestAnimationFrame(step);
  };

  #trackSidebar(): void {
    const el = this.#sidebarEl();
    if (el) {
      // Width-based expand/collapse.
      if ("ResizeObserver" in window) {
        this.#sidebarRO = new ResizeObserver(this.#scheduleSync);
        this.#sidebarRO.observe(el);
      }
      // Class/style toggles (covers collapses that animate via transform, which
      // a ResizeObserver wouldn't see).
      this.#sidebarMO = new MutationObserver(this.#scheduleSync);
      this.#sidebarMO.observe(el, { attributes: true, attributeFilter: ["class", "style"] });
    }
    Hooks.on("collapseSidebar", this.#scheduleSync);
    window.addEventListener("resize", this.#scheduleSync);
    this.#scheduleSync();
    window.setTimeout(this.#scheduleSync, 500); // after initial layout settles
  }

  toggle(force?: boolean): void {
    if (!game.user?.isGM) return;
    const next = force ?? !this.#open;
    if (next === this.#open && this.#el) return;
    this.#open = next;
    const firstMount = !this.#el;
    this.#mount();
    // On first mount the element is inserted already closed (translateX(100%))
    // and opened in the same frame, so the browser never paints the closed
    // state and the slide-in is skipped. Force a reflow to commit that
    // baseline before flipping to open, so the transition runs the first time.
    if (firstMount) void this.#el?.offsetWidth;
    this.#el?.classList.toggle("bivouac-drawer--open", this.#open);
    // Sync our own toggle tab's highlight (we own it directly, unlike the old
    // toolbar toggle). The drawer slides over the stationary tab when open.
    this.#tab?.classList.toggle("bivouac-dmscreen-tab--open", this.#open);
    this.#tab?.setAttribute("aria-pressed", String(this.#open));
    if (this.#open) this.render();
  }

  #mount(): void {
    if (this.#el) return;
    const iface = document.getElementById("interface") ?? document.body;

    const drawer = document.createElement("aside");
    drawer.id = "bivouac-dmscreen";
    drawer.className = "bivouac-drawer";

    // Inner-edge drag handle to resize the drawer width.
    const handle = document.createElement("div");
    handle.className = "bivouac-drawer__resize";
    handle.title = game.i18n.localize("BIVOUAC.DMScreen.Resize");
    handle.addEventListener("pointerdown", (e) => this.#startResize(e, handle));
    drawer.appendChild(handle);

    const header = document.createElement("header");
    header.className = "bivouac-drawer__header";
    const title = document.createElement("span");
    title.className = "bivouac-drawer__title";
    title.innerHTML = `<i class="fa-solid fa-chalkboard-user"></i> ${game.i18n.localize("BIVOUAC.DMScreen.Title")}`;
    header.appendChild(title);
    // Edit toggle — shows/hides per-card chrome (grip · gear · trash) and enables
    // drag-to-arrange. Independent of the landing-board edit mode.
    this.#editBtn = this.#toolButton("fa-solid fa-pen-to-square", "BIVOUAC.DMScreen.Edit", () => this.#toggleEdit());
    this.#editBtn.setAttribute("aria-pressed", String(this.#editMode));
    header.appendChild(this.#editBtn);
    header.appendChild(this.#toolButton("fa-solid fa-plus", "BIVOUAC.Edit.Add", async () => {
      const type = await pickWidgetType();
      if (type) await this.#add(type);
    }));
    header.appendChild(this.#toolButton("fa-solid fa-gear", "BIVOUAC.DMScreen.Settings", () => void this.#openSettings()));
    header.appendChild(this.#toolButton("fa-solid fa-xmark", "BIVOUAC.DMScreen.Close", () => this.toggle(false)));
    drawer.appendChild(header);

    const body = document.createElement("div");
    body.className = "bivouac-drawer__body";
    drawer.appendChild(body);

    iface.appendChild(drawer);
    this.#el = drawer;
    this.#applyDockClass(); // position it at the configured edge before it opens
  }

  #toggleEdit(): void {
    this.#editMode = !this.#editMode;
    this.#editBtn?.classList.toggle("bivouac-drawer__btn--active", this.#editMode);
    this.#editBtn?.setAttribute("aria-pressed", String(this.#editMode));
    this.render();
  }

  /** Quick DM-screen settings from the header gear. Currently the dock mode
   *  (beside the sidebar vs over it); writes the same client setting that the
   *  Foundry settings menu exposes, so both stay in sync. */
  async #openSettings(): Promise<void> {
    const loc = (k: string): string => game.i18n.localize(k);
    const cur = this.#dock;
    const labels: Record<DockMode, string> = {
      beside: "BIVOUAC.Settings.DmDock.Beside",
      over: "BIVOUAC.Settings.DmDock.Over",
      left: "BIVOUAC.Settings.DmDock.Left",
      top: "BIVOUAC.Settings.DmDock.Top",
      bottom: "BIVOUAC.Settings.DmDock.Bottom",
    };
    const opts = DOCK_MODES.map(
      (v) => `<option value="${v}"${cur === v ? " selected" : ""}>${loc(labels[v])}</option>`,
    ).join("");
    const content =
      `<div class="bivouac-config standard-form">` +
      `<div class="form-group"><label>${loc("BIVOUAC.Settings.DmDock.Name")}</label>` +
      `<div class="form-fields"><select name="dock">${opts}</select></div></div>` +
      `<p class="bivouac-config__hint">${loc("BIVOUAC.Settings.DmDock.Hint")}</p></div>`;
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: loc("BIVOUAC.DMScreen.Settings"), icon: "fa-solid fa-gear" },
      position: { width: 420 },
      content,
      ok: {
        label: loc("BIVOUAC.Edit.Save"),
        icon: "fa-solid fa-check",
        callback: (_event: Event, button: { form: HTMLFormElement }) => String(new FormData(button.form).get("dock") ?? ""),
      },
      rejectClose: false,
    });
    if ((DOCK_MODES as readonly string[]).includes(result)) await game.settings.set(MODULE_ID, SETTINGS.dmDock, result);
  }

  render(): void {
    if (!this.#el) return;
    this.#el.classList.toggle("bivouac-drawer--editing", this.#editMode);
    const body = this.#el.querySelector<HTMLElement>(".bivouac-drawer__body");
    if (!body) return;
    body.replaceChildren();

    const rows = this.#currentRows();
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "bivouac-drawer__empty";
      empty.textContent = game.i18n.localize("BIVOUAC.DMScreen.Empty");
      body.appendChild(empty);
      return;
    }
    for (const row of rows) {
      const rowEl = document.createElement("div");
      rowEl.className = "bivouac-drawer__row";
      for (const widget of row) rowEl.appendChild(this.#renderWidget(widget));
      body.appendChild(rowEl);
    }
  }

  #renderWidget(widget: Widget): HTMLElement {
    const edit = this.#editMode;
    const el = document.createElement("div");
    el.className = `bivouac-card bivouac-chrome-${widget.chrome}`;
    el.dataset.id = widget.id;

    // Chrome (grip · title · gear · trash) only in edit mode — a clean board at play.
    if (edit) {
      const header = document.createElement("header");
      header.className = "bivouac-card__header";

      // Only the grip starts a drag, so iframe content stays usable.
      const grip = document.createElement("span");
      grip.className = "bivouac-card__grip";
      grip.draggable = true;
      grip.title = game.i18n.localize("BIVOUAC.DMScreen.Reorder");
      grip.innerHTML = `<i class="fa-solid fa-grip-vertical"></i>`;
      grip.addEventListener("dragstart", (e) => {
        this.#dragId = widget.id;
        el.classList.add("bivouac-card--dragging");
        // Let dragover reach the cards under the pointer instead of being eaten
        // by iframe content (webview cards).
        document.body.classList.add("bivouac-dnd-active");
        e.dataTransfer?.setData("text/plain", widget.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });
      grip.addEventListener("dragend", () => {
        el.classList.remove("bivouac-card--dragging");
        document.body.classList.remove("bivouac-dnd-active");
        this.#clearDropMarks();
      });
      header.appendChild(grip);

      const def = getWidgetType(widget.type);
      const title = document.createElement("span");
      title.className = "bivouac-card__title";
      title.textContent = widget.title || (def ? game.i18n.localize(def.label) : widget.type);
      header.appendChild(title);
      header.appendChild(this.#toolButton("fa-solid fa-gear", "BIVOUAC.Edit.Configure", () =>
        openWidgetConfig(widget, (u) => void this.#update(u)),
      ));
      header.appendChild(this.#toolButton("fa-solid fa-trash", "BIVOUAC.Edit.Delete", () => void this.#delete(widget.id)));
      el.appendChild(header);

      // Four-zone drop: left/right joins the target's row (max 3) — a bar on the
      // card edge; top/bottom makes a new row — a full-width line across the row
      // (drawn on the row element, so it spans the whole horizontal axis).
      el.addEventListener("dragover", (e) => {
        if (!this.#dragId) return;
        e.preventDefault();
        const zone = this.#zoneFor(e, el, widget.id);
        this.#clearDropMarks();
        const mark = zone === "left" || zone === "right" ? el : el.parentElement;
        mark?.classList.add(`bivouac-drop-${zone}`);
        el.dataset.dropZone = zone;
      });
      el.addEventListener("dragleave", () => this.#clearDropMarks());
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        const zone = el.dataset.dropZone ?? "bottom";
        this.#clearDropMarks();
        if (this.#dragId) void this.#drop(this.#dragId, widget.id, zone);
      });
    }

    const def = getWidgetType(widget.type);
    const bodyBox = document.createElement("div");
    bodyBox.className = "bivouac-card__body";
    const ctx: RenderContext = {
      widget,
      gridSize: canvas?.grid?.size ?? 100,
      editMode: false,
      isGM: true,
      lod: false,
      fillContainer: true,
    };
    bodyBox.appendChild(def ? def.renderBody(ctx) : document.createTextNode(widget.type));
    attachInteractions(bodyBox, widget);
    el.appendChild(bodyBox);
    return el;
  }

  /* ------------------------------------------------ row grid ----------- */

  /** Group DM widgets into ordered rows (up to 3 wide) using `cell.gy` (row)
   *  and `cell.gx` (position within the row). */
  #currentRows(): Widget[][] {
    const byRow = new Map<number, Widget[]>();
    for (const w of readDMLayout().widgets) {
      const r = Number(w.cell?.gy ?? 0);
      const bucket = byRow.get(r);
      if (bucket) bucket.push(w);
      else byRow.set(r, [w]);
    }
    return [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, ws]) => ws.sort((a, b) => Number(a.cell?.gx ?? 0) - Number(b.cell?.gx ?? 0)));
  }

  /** Renumber `cell.gx`/`cell.gy` from row/column position, persist, re-render. */
  async #applyRows(rows: Widget[][]): Promise<void> {
    const widgets: Widget[] = [];
    rows.forEach((row, y) =>
      row.forEach((w, x) => {
        w.cell = { ...w.cell, gx: x, gy: y };
        widgets.push(w);
      }),
    );
    await writeDMLayout({ widgets });
    this.render();
  }

  /** Can the dragged tile join the target's row horizontally? True if it's
   *  already in that row (a reorder) or the row has room (< 3). */
  #rowJoinable(targetId: string): boolean {
    // Never offer a left/right (join) drop onto the dragged tile's OWN card —
    // inserting a tile beside where it already sits is a no-op and could corrupt
    // the row. Self-drops are top/bottom only (extract into a new row).
    if (targetId === this.#dragId) return false;
    const row = this.#currentRows().find((r) => r.some((w) => w.id === targetId));
    if (!row) return false;
    return row.some((w) => w.id === this.#dragId) || row.length < 3;
  }

  /** Remove every drop indicator across the drawer (cards + rows) — robust to
   *  dragover/dragleave ordering as the pointer crosses tiles. */
  #clearDropMarks(): void {
    this.#el
      ?.querySelectorAll(".bivouac-drop-left, .bivouac-drop-right, .bivouac-drop-top, .bivouac-drop-bottom")
      .forEach((n) =>
        n.classList.remove("bivouac-drop-left", "bivouac-drop-right", "bivouac-drop-top", "bivouac-drop-bottom"),
      );
  }

  #zoneFor(e: DragEvent, el: HTMLElement, targetId: string): "left" | "right" | "top" | "bottom" {
    const rect = el.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    if (this.#rowJoinable(targetId)) {
      if (fx < 0.28) return "left";
      if (fx > 0.72) return "right";
    }
    return fy < 0.5 ? "top" : "bottom";
  }

  #toolButton(icon: string, titleKey: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bivouac-drawer__btn";
    btn.title = game.i18n.localize(titleKey);
    const i = document.createElement("i");
    i.className = icon;
    btn.appendChild(i);
    btn.addEventListener("click", onClick);
    return btn;
  }

  async #add(type: WidgetType): Promise<void> {
    // A new tile lands as its own full-width row at the bottom; drag it beside
    // another tile to share a row.
    const rows = this.#currentRows();
    const widget = createWidget(type, 0, rows.length);
    rows.push([widget]);
    await this.#applyRows(rows);
    openWidgetConfig(widget, (u) => void this.#update(u));
  }

  async #update(widget: Widget): Promise<void> {
    const layout = readDMLayout();
    const idx = layout.widgets.findIndex((w) => w.id === widget.id);
    if (idx === -1) layout.widgets.push(widget);
    else layout.widgets[idx] = widget;
    await writeDMLayout(layout);
    this.render();
  }

  async #delete(id: string): Promise<void> {
    // Single-card delete — no confirm (matches the landing board's per-widget
    // delete). Drop the tile, then recompact rows so gaps close up.
    const rows = this.#currentRows()
      .map((row) => row.filter((w) => w.id !== id))
      .filter((row) => row.length);
    await this.#applyRows(rows);
  }

  /** Move a dragged tile relative to a target: left/right into the target's
   *  row (max 3 wide), top/bottom into a new row above/below. */
  async #drop(dragId: string, targetId: string, zone: string): Promise<void> {
    this.#dragId = null;

    // Self-drop: dropping a tile onto its own card. Only top/bottom is meaningful
    // — extract it into a new full-width row directly above/below its current
    // row. Left/right of yourself is a no-op (guarded here too). If the tile is
    // already alone in its row, top/bottom is a no-op as well.
    if (dragId === targetId) {
      if (zone !== "top" && zone !== "bottom") return;
      const rows = this.#currentRows();
      let si = -1;
      let sj = -1;
      rows.forEach((row, i) =>
        row.forEach((w, j) => {
          if (w.id === dragId) {
            si = i;
            sj = j;
          }
        }),
      );
      if (si < 0) return;
      const [self] = rows[si].splice(sj, 1);
      if (!self || rows[si].length === 0) return; // was alone → already its own row
      rows.splice(zone === "top" ? si : si + 1, 0, [self]);
      await this.#applyRows(rows);
      return;
    }

    // Pull the dragged tile out of its current row (dropping any row it empties).
    let dragged: Widget | undefined;
    const rows = this.#currentRows()
      .map((row) =>
        row.filter((w) => {
          if (w.id === dragId) {
            dragged = w;
            return false;
          }
          return true;
        }),
      )
      .filter((row) => row.length);
    if (!dragged) return;

    // Locate the target after removal.
    let ti = -1;
    let tj = -1;
    rows.forEach((row, i) =>
      row.forEach((w, j) => {
        if (w.id === targetId) {
          ti = i;
          tj = j;
        }
      }),
    );
    if (ti < 0) {
      rows.push([dragged]); // target vanished — append as a new row
    } else if ((zone === "left" || zone === "right") && rows[ti].length < 3) {
      rows[ti].splice(zone === "left" ? tj : tj + 1, 0, dragged);
    } else if (zone === "top") {
      rows.splice(ti, 0, [dragged]);
    } else {
      rows.splice(ti + 1, 0, [dragged]); // bottom, or a full row → new row below
    }
    await this.#applyRows(rows);
  }
}

export const dmScreen = new DMScreen();
