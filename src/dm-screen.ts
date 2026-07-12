/** Bivouac — the DM screen: a GM-only, right-docked drawer that stacks widgets.
 *  Layout persists per-GM on the User document. Cards can be drag-reordered. */

import { attachInteractions, createWidget, getWidgetType, type RenderContext } from "./widgets";
import { readDMLayout, writeDMLayout } from "./layout";
import { openWidgetConfig, pickWidgetType } from "./widget-config";
import type { Widget, WidgetType } from "./constants";

class DMScreen {
  #el: HTMLElement | null = null;
  #tab: HTMLElement | null = null;
  #open = false;
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
    if (!el || !this.#tab) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return; // not laid out (e.g. mid-transition) — keep last position
    // Floor at 0 so negative padding can slide the tab right to the screen edge
    // (flush at most), without ever pushing it off-screen.
    const inset = Math.max(0, window.innerWidth - rect.left + this.#tabPad());
    document.documentElement.style.setProperty("--bivouac-dmtab-inset", `${Math.round(inset)}px`);
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

    const header = document.createElement("header");
    header.className = "bivouac-drawer__header";
    const title = document.createElement("span");
    title.className = "bivouac-drawer__title";
    title.innerHTML = `<i class="fa-solid fa-chalkboard-user"></i> ${game.i18n.localize("BIVOUAC.DMScreen.Title")}`;
    header.appendChild(title);
    header.appendChild(this.#toolButton("fa-solid fa-plus", "BIVOUAC.Edit.Add", async () => {
      const type = await pickWidgetType();
      if (type) await this.#add(type);
    }));
    header.appendChild(this.#toolButton("fa-solid fa-xmark", "BIVOUAC.DMScreen.Close", () => this.toggle(false)));
    drawer.appendChild(header);

    const body = document.createElement("div");
    body.className = "bivouac-drawer__body";
    drawer.appendChild(body);

    iface.appendChild(drawer);
    this.#el = drawer;
  }

  render(): void {
    if (!this.#el) return;
    const body = this.#el.querySelector<HTMLElement>(".bivouac-drawer__body");
    if (!body) return;
    body.replaceChildren();

    const widgets = readDMLayout().widgets;
    if (!widgets.length) {
      const empty = document.createElement("p");
      empty.className = "bivouac-drawer__empty";
      empty.textContent = game.i18n.localize("BIVOUAC.DMScreen.Empty");
      body.appendChild(empty);
      return;
    }
    for (const widget of widgets) body.appendChild(this.#renderWidget(widget));
  }

  #renderWidget(widget: Widget): HTMLElement {
    const el = document.createElement("div");
    el.className = `bivouac-card bivouac-chrome-${widget.chrome}`;
    el.dataset.id = widget.id;

    const header = document.createElement("header");
    header.className = "bivouac-card__header";

    // Drag handle — only the grip starts a reorder, so iframe content stays usable.
    const grip = document.createElement("span");
    grip.className = "bivouac-card__grip";
    grip.draggable = true;
    grip.title = game.i18n.localize("BIVOUAC.DMScreen.Reorder");
    grip.innerHTML = `<i class="fa-solid fa-grip-vertical"></i>`;
    grip.addEventListener("dragstart", (e) => {
      this.#dragId = widget.id;
      el.classList.add("bivouac-card--dragging");
      e.dataTransfer?.setData("text/plain", widget.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    grip.addEventListener("dragend", () => el.classList.remove("bivouac-card--dragging"));
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

    // Drop target behavior on the whole card.
    el.addEventListener("dragover", (e) => {
      if (!this.#dragId || this.#dragId === widget.id) return;
      e.preventDefault();
      const after = e.clientY - el.getBoundingClientRect().top > el.offsetHeight / 2;
      el.classList.toggle("bivouac-drop-after", after);
      el.classList.toggle("bivouac-drop-before", !after);
    });
    el.addEventListener("dragleave", () => el.classList.remove("bivouac-drop-after", "bivouac-drop-before"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const after = el.classList.contains("bivouac-drop-after");
      el.classList.remove("bivouac-drop-after", "bivouac-drop-before");
      if (this.#dragId) void this.#reorder(this.#dragId, widget.id, after);
    });

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
    const widget = createWidget(type, 0, 0);
    const layout = readDMLayout();
    layout.widgets.push(widget);
    await writeDMLayout(layout);
    this.render();
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
    // Single-card delete — no confirm (matches the landing board's per-widget delete).
    const layout = readDMLayout();
    layout.widgets = layout.widgets.filter((w) => w.id !== id);
    await writeDMLayout(layout);
    this.render();
  }

  async #reorder(dragId: string, targetId: string, after: boolean): Promise<void> {
    if (dragId === targetId) return;
    const layout = readDMLayout();
    const from = layout.widgets.findIndex((w) => w.id === dragId);
    if (from < 0) return;
    const [moved] = layout.widgets.splice(from, 1);
    const to = layout.widgets.findIndex((w) => w.id === targetId);
    if (to < 0) layout.widgets.push(moved);
    else layout.widgets.splice(after ? to + 1 : to, 0, moved);
    this.#dragId = null;
    await writeDMLayout(layout);
    this.render();
  }
}

export const dmScreen = new DMScreen();
