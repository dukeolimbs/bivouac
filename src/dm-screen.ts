/** Bivouac — the DM screen: a GM-only, right-docked drawer that stacks widgets.
 *  Layout persists per-GM on the User document. Cards can be drag-reordered. */

import { attachInteractions, createWidget, getWidgetType, type RenderContext } from "./widgets";
import { readDMLayout, writeDMLayout } from "./layout";
import { openWidgetConfig, pickWidgetType } from "./widget-config";
import type { Widget, WidgetType } from "./constants";

class DMScreen {
  #el: HTMLElement | null = null;
  #open = false;
  #dragId: string | null = null;

  get isOpen(): boolean {
    return this.#open;
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
    if (this.#open) this.render();
    // Re-render the scene controls so the toolbar toggle's highlight matches
    // the drawer state — Foundry only clears it for clicks on the toggle
    // itself, not when we close from the drawer's own ✕ button.
    ui.controls?.render();
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
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("BIVOUAC.Confirm.DeleteTitle") },
      content: `<p>${game.i18n.format("BIVOUAC.Confirm.DeleteBody", { count: 1 })}</p>`,
      modal: true,
    });
    if (!ok) return;
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
