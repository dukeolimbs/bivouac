/** Bivouac — widget type registry and renderers (webview / image / note). */

import {
  GRID,
  MODULE_ID,
  cardsCanControl,
  type Widget,
  type WidgetBackground,
  type WidgetFrame,
  type WidgetInteraction,
  type WidgetType,
} from "./constants";
import { isDocDrag, parseDrop } from "./drop";

export interface RenderContext {
  widget: Widget;
  /** Pixel size of one scene grid square (for consistent web-view scaling). */
  gridSize: number;
  editMode: boolean;
  isGM: boolean;
  /** Show a lightweight placeholder instead of live content (LOD). */
  lod: boolean;
  /** Fill the container 1:1 rather than using world-space scaling (DM screen). */
  fillContainer?: boolean;
}

export interface WidgetTypeDef {
  type: WidgetType;
  label: string;
  icon: string;
  /** Build the widget's body content (the frame/chrome is added by the caller). */
  renderBody(ctx: RenderContext): HTMLElement;
  /** Default config for a freshly-created widget of this type. */
  defaultConfig(): Record<string, unknown>;
}

const registry = new Map<WidgetType, WidgetTypeDef>();

export function registerWidgetType(def: WidgetTypeDef): void {
  registry.set(def.type, def);
}

export function getWidgetType(type: WidgetType): WidgetTypeDef | undefined {
  return registry.get(type);
}

export function widgetTypes(): WidgetTypeDef[] {
  return [...registry.values()];
}

/* -------------------------------------------- helpers ------------------- */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Run a widget interaction against Foundry documents, honoring the user's permissions. */
export async function runInteraction(interaction: WidgetInteraction): Promise<void> {
  if (interaction.action === "none" || !interaction.uuid) return;
  const doc = await fromUuid(interaction.uuid);
  if (!doc) {
    ui.notifications?.warn(`${MODULE_ID}: linked document not found.`);
    return;
  }
  switch (interaction.action) {
    case "openSheet":
    case "openJournal":
      doc.sheet?.render(true);
      break;
    case "runMacro":
      doc.execute?.();
      break;
  }
}

/** Wire a widget's interactions onto a node. Each widget instance gets its own
 *  handlers, so any number of widgets can independently link to documents. */
export function attachInteractions(node: HTMLElement, widget: Widget): void {
  if (!widget.interactions?.length) return;
  node.classList.add("bivouac-interactive");
  for (const interaction of widget.interactions) {
    node.addEventListener(interaction.trigger, (event) => {
      event.stopPropagation();
      void runInteraction(interaction);
    });
  }
}

/** Convert `#rrggbb` + alpha (0–1) to an `rgba()` string. */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return `rgba(217, 139, 58, ${alpha})`; // fallback = accent orange
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

/** Resolve a tile's frame (border) style — `config.frame`, falling back to the
 *  legacy `chrome` for layouts saved before the frame/background split. */
export function frameOf(widget: Widget): WidgetFrame {
  const f = widget.config.frame;
  if (f === "none" || f === "subtle" || f === "framed") return f;
  return widget.chrome === "none" ? "none" : widget.chrome === "framed" ? "framed" : "subtle";
}

/** Resolve a tile's background (fill) style — `config.background`, falling back
 *  to the legacy `chrome` (none → none; subtle/framed → frosted). */
export function backgroundOf(widget: Widget): WidgetBackground {
  const b = widget.config.background;
  if (b === "none" || b === "solid" || b === "frosted" || b === "gradient" || b === "image") return b;
  return widget.chrome === "none" ? "none" : "frosted";
}

/** Apply a tile's frame colour/opacity to its EDGE (border + framed top accent)
 *  only — not the fill. Overrides the border CSS vars inline; defaults to the
 *  accent orange at 0.4 when unset. */
export function applyFrameStyle(el: HTMLElement, widget: Widget): void {
  const color = typeof widget.config.frameColor === "string" ? widget.config.frameColor : "#d98b3a";
  const raw = Number(widget.config.frameOpacity);
  const opacity = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.4;
  const edge = hexToRgba(color, opacity);
  el.style.setProperty("--bivouac-panel-border", edge);
  el.style.setProperty("--bivouac-frame-border", edge);
  el.style.setProperty("--bivouac-frame-accent", color);
}

/** Apply a tile's background colour/opacity to the fill CSS vars inline. Used by
 *  the Solid / Frosted / Gradient styles (`--bivouac-bg-fill` / `-fill2`) and the
 *  Image style (`--bivouac-bg-image` + `--bivouac-bg-opacity`). Defaults to the
 *  dark panel at 0.4. */
export function applyBackground(el: HTMLElement, widget: Widget): void {
  const raw = Number(widget.config.bgOpacity);
  const opacity = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.4;
  const c1 = typeof widget.config.bgColor === "string" ? widget.config.bgColor : "#101219";
  const c2 = typeof widget.config.bgColor2 === "string" ? widget.config.bgColor2 : c1;
  el.style.setProperty("--bivouac-bg-fill", hexToRgba(c1, opacity));
  el.style.setProperty("--bivouac-bg-fill2", hexToRgba(c2, opacity));
  // Image fill: raw opacity (applied to the image layer) + the image URL.
  el.style.setProperty("--bivouac-bg-opacity", String(opacity));
  const img = typeof widget.config.bgImage === "string" ? widget.config.bgImage.trim() : "";
  el.style.setProperty("--bivouac-bg-image", img ? `url("${img.replace(/"/g, "%22")}")` : "none");
}

/** Apply an optional per-tile text colour (`config.textColor`, a #rrggbb) via the
 *  `--bivouac-text-color` var that text tiles inherit. Empty → theme default. */
export function applyTextColor(el: HTMLElement, widget: Widget): void {
  const c = typeof widget.config.textColor === "string" ? widget.config.textColor : "";
  if (/^#[0-9a-fA-F]{6}$/.test(c)) el.style.setProperty("--bivouac-text-color", c);
  else el.style.removeProperty("--bivouac-text-color");
}

function placeholder(icon: string, label: string): HTMLElement {
  const box = el("div", "bivouac-placeholder");
  box.appendChild(el("i", `bivouac-placeholder__icon ${icon}`));
  box.appendChild(el("span", "bivouac-placeholder__label", label));
  return box;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Enrich note HTML with Foundry's text enrichers (document @UUID links, inline
 *  [[/roll]]s, content links, etc.) and swap the result into the box. Clickable
 *  links/rolls work via Foundry's global delegated handlers on the document.
 *  Async, so the caller shows the raw HTML first; falls back to it on error. */
async function enrichNote(box: HTMLElement, html: string): Promise<void> {
  const TE = (foundry.applications?.ux?.TextEditor?.implementation ??
    foundry.applications?.ux?.TextEditor ??
    (globalThis as { TextEditor?: unknown }).TextEditor) as
    | { enrichHTML?: (h: string, o?: object) => Promise<string> }
    | undefined;
  if (!TE?.enrichHTML) return;
  try {
    box.innerHTML = await TE.enrichHTML(html, { secrets: !!game.user?.isGM });
  } catch {
    /* keep the raw-HTML fallback the caller already set */
  }
}

/* -------------------------------------------- webview ------------------- */

registerWidgetType({
  type: "webview",
  label: "BIVOUAC.Widgets.Webview.Label",
  icon: "fa-solid fa-globe",
  defaultConfig: () => ({ url: "" }),
  renderBody(ctx) {
    const url = String(ctx.widget.config.url ?? "").trim();
    if (!url) return placeholder("fa-solid fa-globe", game.i18n.localize("BIVOUAC.Widgets.Webview.Empty"));

    // LOD: a graceful, quiet card — only shown when the board is busy and
    // zoomed way out (decided by the caller). No dev-looking chrome.
    if (ctx.lod && !ctx.editMode) {
      const box = el("div", "bivouac-webview__lod");
      box.appendChild(el("i", "bivouac-webview__lod-icon fa-solid fa-globe"));
      box.appendChild(el("span", "bivouac-webview__lod-host", hostOf(url)));
      return box;
    }

    const wrap = el("div", "bivouac-webview");
    const frame = document.createElement("iframe");
    frame.className = "bivouac-webview__frame";
    frame.src = url;
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("loading", "lazy");

    // Content zoom (config.zoom, default 1) as a *browser-style* zoom that always
    // fills the whole tile. The iframe is sized to (100/zoom)% and scaled by
    // `zoom`, so its painted size is exactly 100% of the container at EVERY zoom
    // (higher zoom → smaller CSS viewport → content bigger; lower → larger
    // viewport → more of the page). Percentage-based, so it fills regardless of
    // the tile's aspect or pixel size — at zoom = 1 it is a plain 100% with no
    // overflow at all. Identical for the landing board (inside the world-px
    // .bivouac-scaler) and DM cards (inside the card body).
    //
    // Clipping is DEFERRED to the screen-space body (.bivouac-widget__body /
    // .bivouac-card): those sit ABOVE the scaler + iframe transforms, so the
    // oversized iframe is clipped AFTER its transform. The immediate .bivouac-
    // webview must NOT clip, or it crops the logical iframe *before* the scale()
    // (that cropped the tile to half width — the bug this fixes).
    //
    // LegendKeeper-safe: the iframe's viewport (a % of the constant-size scaler)
    // and its own transform are CONSTANT per config; the per-frame map zoom rides
    // the .bivouac-scaler ANCESTOR. LK only ever broke on a *per-frame-changing*
    // iframe transform.
    const zoom = Number(ctx.widget.config.zoom) || 1;
    frame.style.transformOrigin = "0 0";
    frame.style.width = `${100 / zoom}%`;
    frame.style.height = `${100 / zoom}%`;
    frame.style.transform = `scale(${zoom})`;
    wrap.appendChild(frame);

    // Pop-out fallback for sites that refuse embedding.
    const popout = el("button", "bivouac-webview__popout");
    popout.type = "button";
    popout.title = game.i18n.localize("BIVOUAC.Widgets.Webview.Popout");
    popout.appendChild(el("i", "fa-solid fa-arrow-up-right-from-square"));
    popout.addEventListener("click", (e) => {
      e.stopPropagation();
      window.open(url, "_blank", "noopener");
    });
    wrap.appendChild(popout);
    return wrap;
  },
});

/* -------------------------------------------- image --------------------- */

registerWidgetType({
  type: "image",
  label: "BIVOUAC.Widgets.Image.Label",
  icon: "fa-solid fa-image",
  defaultConfig: () => ({ src: "", fit: "cover" }),
  renderBody(ctx) {
    const src = String(ctx.widget.config.src ?? "").trim();
    if (!src) return placeholder("fa-solid fa-image", game.i18n.localize("BIVOUAC.Widgets.Image.Empty"));

    const wrap = el("div", "bivouac-image");
    const img = document.createElement("img");
    img.className = "bivouac-image__img";
    img.src = src;
    img.style.objectFit = String(ctx.widget.config.fit ?? "cover");
    img.alt = ctx.widget.title ?? "";
    wrap.appendChild(img);
    return wrap;
  },
});

/* -------------------------------------------- fonts --------------------- */

/** Font families Foundry already knows about (core + any the GM added via
 *  "Manage Fonts", which is where Google Fonts get registered natively). Used to
 *  populate the note font dropdown. Defensive across Foundry versions. */
export function availableFonts(): string[] {
  const g = globalThis as { foundry?: unknown; FontConfig?: unknown; CONFIG?: { fontDefinitions?: object } };
  const out = new Set<string>();
  try {
    const fc =
      (g.foundry as { applications?: { settings?: { menus?: { FontConfig?: { getAvailableFonts?: () => string[] } } } } })
        ?.applications?.settings?.menus?.FontConfig ??
      (g.FontConfig as { getAvailableFonts?: () => string[] } | undefined);
    const list = fc?.getAvailableFonts?.();
    if (Array.isArray(list)) list.forEach((f) => out.add(String(f)));
  } catch {
    /* older/newer API — fall back below */
  }
  try {
    const defs = g.CONFIG?.fontDefinitions;
    if (defs) Object.keys(defs).forEach((f) => out.add(f));
  } catch {
    /* ignore */
  }
  if (out.size === 0) ["Signika", "Arial", "Times New Roman", "Courier New"].forEach((f) => out.add(f));
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** Lazily inject a Google Fonts stylesheet for a custom family name (once per
 *  family). Only used for the note's "custom font" field — dropdown fonts are
 *  already loaded by Foundry. */
const loadedGoogleFonts = new Set<string>();
function ensureGoogleFont(family: string): void {
  const name = family.trim();
  if (!name) return;
  const key = name.toLowerCase();
  if (loadedGoogleFonts.has(key)) return;
  loadedGoogleFonts.add(key);
  const id = `bivouac-font-${key.replace(/[^a-z0-9]+/g, "-")}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@400;600;700&display=swap`;
  document.head.appendChild(link);
}

/* -------------------------------------------- note ---------------------- */

registerWidgetType({
  type: "note",
  label: "BIVOUAC.Widgets.Note.Label",
  icon: "fa-solid fa-scroll",
  defaultConfig: () => ({ html: "" }),
  renderBody(ctx) {
    const html = String(ctx.widget.config.html ?? "").trim();
    if (!html) return placeholder("fa-solid fa-scroll", game.i18n.localize("BIVOUAC.Widgets.Note.Empty"));
    const box = el("div", "bivouac-note");
    // Fills its container (the .bivouac-scaler for landing tiles, or the card
    // for DM screen); zoom scaling is handled by that ancestor. On the landing
    // board the font scales with the tile size (cqmin) × this per-tile multiplier.
    box.style.setProperty("--bivouac-note-scale", String(Number(ctx.widget.config.textScale) || 1));
    // Per-note font: a custom Google Font name (loaded from the CDN) overrides
    // the dropdown pick (a font Foundry already has). Empty → tile default.
    const fontCustom = String(ctx.widget.config.fontCustom ?? "").trim();
    const family = fontCustom || String(ctx.widget.config.font ?? "").trim();
    if (family) {
      if (fontCustom) ensureGoogleFont(fontCustom);
      box.style.fontFamily = `"${family}", var(--font-primary, "Signika", sans-serif)`;
    }
    // Show the raw HTML immediately, then enrich (document links, inline rolls,
    // etc.) asynchronously and swap it in.
    box.innerHTML = html;
    void enrichNote(box, html);
    return box;
  },
});

/* -------------------------------------------- document tiles ------------ */

/** Does this widget reference the given document UUID (for targeted refresh)? */
export function refsUuid(widget: Widget, uuid: string): boolean {
  if (widget.config?.uuid === uuid) return true;
  const many = widget.config?.uuids;
  if (Array.isArray(many) && many.includes(uuid)) return true;
  const cards = widget.config?.cards;
  return Array.isArray(cards) && cards.some((c) => (c as { uuid?: string })?.uuid === uuid);
}

/** Apply a card-collection op (add / remove / move) to a widget config, returning
 *  the new config (or null if it's a no-op). Cards are `{ cid, uuid }` so the same
 *  document can appear multiple times and each instance is addressed by `cid`.
 *  Shared by the world layer and DM screen. */
export function applyCardOp(
  config: Record<string, unknown>,
  detail: { op?: string; uuid?: string; cid?: string; targetCid?: string; after?: boolean },
): Record<string, unknown> | null {
  const list: { cid: string; uuid: string }[] = Array.isArray(config.cards)
    ? (config.cards as { cid: string; uuid: string }[]).map((c) => ({ cid: c.cid, uuid: c.uuid }))
    : Array.isArray(config.uuids)
      ? (config.uuids as string[]).map((u) => ({ cid: u, uuid: u })) // legacy migration
      : [];
  const { op, uuid, cid, targetCid, after } = detail;
  if (op === "add" && uuid) {
    list.push({ cid: foundry.utils.randomID(), uuid });
  } else if (op === "remove" && cid) {
    const i = list.findIndex((c) => c.cid === cid);
    if (i < 0) return null;
    list.splice(i, 1);
  } else if (op === "move" && cid) {
    const from = list.findIndex((c) => c.cid === cid);
    if (from < 0) return null;
    const [moved] = list.splice(from, 1);
    const ti = targetCid ? list.findIndex((c) => c.cid === targetCid) : -1;
    if (ti < 0) list.push(moved);
    else list.splice(ti + (after ? 1 : 0), 0, moved);
  } else {
    return null;
  }
  const next = { ...config, cards: list };
  delete (next as { uuids?: unknown }).uuids;
  return next;
}

/** Can the current user at least see this document? Doc tiles render a quiet
 *  "restricted" placeholder for users below LIMITED permission, so a shared tile
 *  never leaks GM-only content. */
export function canView(doc: unknown): boolean {
  const d = doc as { testUserPermission?: (u: unknown, p: string) => boolean } | null;
  try {
    return d?.testUserPermission ? d.testUserPermission(game.user, "LIMITED") : true;
  } catch {
    return true;
  }
}

/** Shared scaffold for a document-backed tile: resolve `config.uuid`, gate on
 *  permission, then hand the live document to `fill`. Renders synchronously with
 *  a placeholder and swaps in the resolved view. */
function docBody(ctx: RenderContext, fill: (doc: Record<string, unknown>, host: HTMLElement) => void): HTMLElement {
  const wrap = el("div", "bivouac-doc");
  const uuid = String(ctx.widget.config.uuid ?? "");
  if (!uuid) {
    wrap.appendChild(placeholder("fa-solid fa-link-slash", game.i18n.localize("BIVOUAC.Doc.None")));
    return wrap;
  }
  void (async () => {
    const doc = (await fromUuid(uuid).catch(() => null)) as Record<string, unknown> | null;
    if (!doc) {
      wrap.replaceChildren(placeholder("fa-solid fa-triangle-exclamation", game.i18n.localize("BIVOUAC.Doc.Missing")));
      return;
    }
    if (!canView(doc)) {
      wrap.replaceChildren(placeholder("fa-solid fa-lock", game.i18n.localize("BIVOUAC.Doc.Restricted")));
      return;
    }
    fill(doc, wrap);
  })();
  return wrap;
}

/** Best-effort image for a document (portrait, falling back to the token). */
function docImg(doc: Record<string, unknown>): string {
  const token = (doc.prototypeToken as { texture?: { src?: string } } | undefined)?.texture?.src;
  return (doc.img as string) || token || "icons/svg/mystery-man.svg";
}

/** Extract renderable HTML from a JournalEntry (first text page) or a page. */
function journalHtml(doc: Record<string, unknown>): string {
  const asPage = (doc.text as { content?: string } | undefined)?.content;
  if (typeof asPage === "string") return asPage;
  const pages = (doc.pages as { contents?: { type?: string; text?: { content?: string } }[] } | undefined)?.contents;
  const text = pages?.find((p) => p.type === "text")?.text?.content;
  return typeof text === "string" ? text : "";
}

/** Actor / Item card: portrait art + name; click opens the sheet (view mode). */
registerWidgetType({
  type: "actor",
  label: "BIVOUAC.Widgets.Actor.Label",
  icon: "fa-solid fa-user",
  defaultConfig: () => ({ uuid: "" }),
  renderBody(ctx) {
    return docBody(ctx, (doc, host) => {
      const box = el("div", "bivouac-actorcard");
      const img = document.createElement("img");
      img.className = "bivouac-actorcard__img";
      img.src = docImg(doc);
      img.alt = String(doc.name ?? "");
      box.appendChild(img);
      box.appendChild(el("span", "bivouac-actorcard__name", String(doc.name ?? "")));
      if (!ctx.editMode) {
        box.classList.add("bivouac-interactive");
        box.addEventListener("click", () => (doc.sheet as { render?: (b: boolean) => void })?.render?.(true));
      }
      host.replaceChildren(box);
    });
  },
});

/** Journal tile: inline-render the page content (default) or a link that opens
 *  it (config.journalMode === "link"). */
registerWidgetType({
  type: "journal",
  label: "BIVOUAC.Widgets.Journal.Label",
  icon: "fa-solid fa-book-open",
  defaultConfig: () => ({ uuid: "", journalMode: "inline" }),
  renderBody(ctx) {
    const link = ctx.widget.config.journalMode === "link";
    return docBody(ctx, (doc, host) => {
      if (link) {
        const box = el("div", "bivouac-doclink");
        box.appendChild(el("i", "bivouac-doclink__icon fa-solid fa-book-open"));
        box.appendChild(el("span", "bivouac-doclink__name", String(doc.name ?? "")));
        if (!ctx.editMode) {
          box.classList.add("bivouac-interactive");
          box.addEventListener("click", () => (doc.sheet as { render?: (b: boolean) => void })?.render?.(true));
        }
        host.replaceChildren(box);
        return;
      }
      const note = el("div", "bivouac-note");
      const html = journalHtml(doc);
      note.innerHTML = html || `<p class="bivouac-doc__empty">${game.i18n.localize("BIVOUAC.Doc.EmptyJournal")}</p>`;
      if (html) void enrichNote(note, html);
      host.replaceChildren(note);
    });
  },
});

/** Rollable table tile: a scrollable list of the table's entries + a Roll button.
 *  Rolling draws normally (posts to chat, so Dice So Nice etc. animate) and then
 *  highlights the matching result row and scrolls it into view. */
registerWidgetType({
  type: "table",
  label: "BIVOUAC.Widgets.Table.Label",
  icon: "fa-solid fa-dice-d20",
  defaultConfig: () => ({ uuid: "", textScale: 1 }),
  renderBody(ctx) {
    const scale = Number(ctx.widget.config.textScale) || 1;
    return docBody(ctx, (doc, host) => {
      const box = el("div", "bivouac-table");
      box.style.fontSize = `${(14 * Math.min(3, Math.max(0.4, scale))).toFixed(1)}px`;

      const header = el("div", "bivouac-table__header");
      header.appendChild(el("span", "bivouac-table__name", String(doc.name ?? "")));
      const roll = el("button", "bivouac-table__roll");
      roll.type = "button";
      roll.appendChild(el("i", "fa-solid fa-dice-d20"));
      roll.append(` ${String(doc.formula ?? "") || game.i18n.localize("BIVOUAC.Widgets.Table.Roll")}`);
      header.appendChild(roll);
      box.appendChild(header);

      const listEl = el("div", "bivouac-table__list");
      const results = ((doc.results as { contents?: unknown[] } | undefined)?.contents ?? []) as Record<
        string,
        unknown
      >[];
      const rows: HTMLElement[] = [];
      for (const rr of results) {
        const range = Array.isArray(rr.range) ? (rr.range as number[]) : [0, 0];
        const row = el("div", "bivouac-table__row");
        row.dataset.low = String(range[0]);
        row.dataset.high = String(range[1]);
        row.appendChild(el("span", "bivouac-table__range", range[0] === range[1] ? `${range[0]}` : `${range[0]}–${range[1]}`));
        const rimg = String(rr.img ?? rr.icon ?? "");
        if (rimg) {
          const im = document.createElement("img");
          im.className = "bivouac-table__thumb";
          im.src = rimg;
          row.appendChild(im);
        }
        row.appendChild(el("span", "bivouac-table__text", String(rr.text ?? rr.name ?? rr.description ?? "")));
        listEl.appendChild(row);
        rows.push(row);
      }
      box.appendChild(listEl);

      const settle = (total: number | undefined): void => {
        let hit: HTMLElement | undefined;
        for (const r of rows) {
          r.classList.remove("bivouac-table__row--cycling");
          const on = typeof total === "number" && total >= Number(r.dataset.low) && total <= Number(r.dataset.high);
          r.classList.toggle("bivouac-table__row--rolled", on && !hit);
          if (on && !hit) hit = r;
        }
        hit?.scrollIntoView({ block: "nearest" });
      };
      const doRoll = (): void => {
        if (!rows.length || roll.disabled) return;
        roll.disabled = true;
        rows.forEach((r) => r.classList.remove("bivouac-table__row--rolled"));
        // Kick off the real draw (posts to chat, so the dice roll / Dice So Nice
        // animate), and spin the on-tile highlight through the rows, decelerating,
        // before landing on the drawn result — like Foundry's own table popout.
        const draw = (doc.draw as (() => Promise<{ roll?: { total?: number } }>) | undefined)?.();
        const spinEnd = performance.now() + 1100;
        let delay = 55;
        let last = -1;
        const tick = (): void => {
          rows.forEach((r) => r.classList.remove("bivouac-table__row--cycling"));
          if (performance.now() < spinEnd) {
            let idx = last;
            if (rows.length > 1) while (idx === last) idx = Math.floor(Math.random() * rows.length);
            else idx = 0;
            last = idx;
            rows[idx].classList.add("bivouac-table__row--cycling");
            rows[idx].scrollIntoView({ block: "nearest" });
            delay = Math.min(240, delay * 1.14);
            window.setTimeout(tick, delay);
          } else {
            void Promise.resolve(draw).then((res) => {
              settle(res?.roll?.total);
              roll.disabled = false;
            });
          }
        };
        tick();
      };
      roll.addEventListener("click", (e) => {
        e.stopPropagation();
        doRoll();
      });
      host.replaceChildren(box);
    });
  },
});

/** Macro tile: icon/name button that executes the macro. Icon + title can each
 *  be shown/hidden and sized. */
registerWidgetType({
  type: "macro",
  label: "BIVOUAC.Widgets.Macro.Label",
  icon: "fa-solid fa-scroll",
  defaultConfig: () => ({ uuid: "", showIcon: true, showTitle: true, iconSize: 48, titleSize: 14 }),
  renderBody(ctx) {
    const cfg = ctx.widget.config;
    const showIcon = cfg.showIcon !== false;
    const showTitle = cfg.showTitle !== false;
    const iconSize = Number(cfg.iconSize) || 48;
    const titleSize = Number(cfg.titleSize) || 14;
    return docBody(ctx, (doc, host) => {
      const box = el("div", "bivouac-doctile bivouac-macrotile");
      if (showIcon) {
        if (doc.img) {
          const im = document.createElement("img");
          im.className = "bivouac-macrotile__img";
          im.src = String(doc.img);
          im.style.width = `${iconSize}px`;
          im.style.height = `${iconSize}px`;
          box.appendChild(im);
        } else {
          const ic = el("i", "bivouac-doctile__icon fa-solid fa-scroll");
          ic.style.fontSize = `${iconSize}px`;
          box.appendChild(ic);
        }
      }
      if (showTitle) {
        const nm = el("span", "bivouac-doctile__name", String(doc.name ?? ""));
        nm.style.fontSize = `${titleSize}px`;
        box.appendChild(nm);
      }
      if (!ctx.editMode) {
        box.classList.add("bivouac-interactive");
        box.addEventListener("click", () => (doc.execute as (() => void) | undefined)?.());
      }
      host.replaceChildren(box);
    });
  },
});

/* -------------------------------------------- card collection ----------- */

/** Lay cards out as a curved hand that spans the tile's full width WITHOUT
 *  clipping. Cards rotate around their bottom-centre, so the end cards' corners
 *  swing out — we size the card and side/vertical margins from the *rotated*
 *  bounding box (at the end-card angle) so those corners always stay on-tile.
 *  Uses layout px (client), which are transform-independent → correct under the
 *  world scaler. */
function applyFan(hand: HTMLElement, cards: HTMLElement[]): void {
  const n = cards.length;
  if (!n) return;
  const W = hand.clientWidth || 1;
  const H = hand.clientHeight || 1;
  const ASPECT = 5 / 7; // card width : height
  const fanDeg = Math.min(56, n * 10); // total spread; end cards at ±fanDeg/2
  const phiMax = ((fanDeg / 2) * Math.PI) / 180; // rad
  const sinM = Math.sin(phiMax) || 1e-3;
  const cosM = Math.cos(phiMax);
  const tanHalf = Math.tan(phiMax / 2);
  const HOVER = 0.06 * H; // reserve headroom for the hover lift so a raised card (and its ×) stays on-tile
  const sideGap = 0.04 * W;
  const topGap = 0.02 * H;
  const botGap = 0.03 * H;
  // Cards sit on a circular arc (centre highest, ends symmetrically lower) and
  // rotate radially. Shrink the card until the whole arc — corners, the raised
  // centre card, and the hover lift — fits inside the tile.
  let cardH = 0.8 * H;
  let cardW = cardH * ASPECT;
  let spreadX = 0;
  let arcDepth = 0;
  let baseBottom = botGap;
  for (let k = 0; k < 16; k++) {
    cardW = cardH * ASPECT;
    const ex = (cardW / 2) * cosM + cardH * sinM; // rotated horizontal half-extent
    spreadX = Math.max(0, W / 2 - ex - sideGap); // end-card centre offset (fills width)
    arcDepth = spreadX * tanHalf; // true circular-arc rise from ends to centre
    baseBottom = (cardW / 2) * sinM + botGap; // clear the rotated bottom corner
    const topReach = baseBottom + arcDepth + cardH + HOVER; // centre card, raised, hovered
    if (topReach <= H - topGap) break;
    cardH *= 0.94;
  }
  cards.forEach((c, i) => {
    const s = n > 1 ? (2 * i) / (n - 1) - 1 : 0; // -1 … 1
    const phi = phiMax * s;
    const x = n > 1 ? spreadX * (Math.sin(phi) / sinM) : 0; // px from tile centre
    const lift = n > 1 ? (arcDepth * (Math.cos(phi) - cosM)) / (1 - cosM || 1) : 0;
    c.style.height = `${((cardH / H) * 100).toFixed(2)}%`;
    c.style.left = `calc(50% + ${x.toFixed(1)}px)`;
    c.style.bottom = `${(((baseBottom + lift) / H) * 100).toFixed(2)}%`;
    c.style.setProperty("--card-angle", `${((phi * 180) / Math.PI).toFixed(2)}deg`);
    c.style.zIndex = String(i + 1);
  });
}

/** A collection of documents shown as a hand of cards (fan / row / grid). Drop
 *  Actors or Items onto it to add them; a card opens its sheet (if permitted).
 *  Card add/remove is dispatched as a bubbling `bivouac-card-op` event the host
 *  surface (world layer / DM screen) persists. */
const REORDER_TYPE = "application/x-bivouac-card"; // drag marker for in-hand reorder

/** Forgiving in-hand reorder: handled at the hand level so it works across the
 *  whole tile (gaps and overlaps alike). Continuously tracks the nearest card
 *  to the pointer and shows a before/after marker there; on drop, moves the
 *  dragged card to that spot. */
function attachHandReorder(
  hand: HTMLElement,
  cards: HTMLElement[],
  emit: (op: string, detail: Record<string, unknown>) => void,
): void {
  const clear = (): void =>
    cards.forEach((c) => c.classList.remove("bivouac-cards__card--before", "bivouac-cards__card--after"));
  const nearest = (clientX: number): { cid: string; after: boolean } | null => {
    let best: HTMLElement | null = null;
    let bestD = Infinity;
    let after = false;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const d = Math.abs(clientX - cx);
      if (d < bestD) {
        bestD = d;
        best = c;
        after = clientX > cx;
      }
    }
    return best?.dataset.cid ? { cid: best.dataset.cid, after } : null;
  };
  hand.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes(REORDER_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    const t = nearest(e.clientX);
    clear();
    if (t) {
      cards.find((c) => c.dataset.cid === t.cid)?.classList.add(
        t.after ? "bivouac-cards__card--after" : "bivouac-cards__card--before",
      );
      hand.dataset.rt = t.cid;
      hand.dataset.ra = t.after ? "1" : "0";
    }
  });
  hand.addEventListener("dragleave", clear);
  hand.addEventListener("drop", (e) => {
    const cid = e.dataTransfer?.getData(REORDER_TYPE);
    clear();
    if (!cid) return;
    e.preventDefault();
    e.stopPropagation();
    const targetCid = hand.dataset.rt;
    if (targetCid) emit("move", { cid, targetCid, after: hand.dataset.ra === "1" });
  });
}

registerWidgetType({
  type: "cards",
  label: "BIVOUAC.Widgets.Cards.Label",
  icon: "fa-solid fa-id-badge",
  defaultConfig: () => ({ cards: [], layout: "fan", art: "portrait", showNames: true, nameSize: 12, nameFont: "", showToAll: false }),
  renderBody(ctx) {
    const cfg = ctx.widget.config;
    const layout = ["fan", "row", "grid"].includes(String(cfg.layout)) ? String(cfg.layout) : "fan";
    const art = cfg.art === "token" ? "token" : "portrait";
    const showNames = cfg.showNames !== false;
    const nameSize = Number(cfg.nameSize) || 12;
    const nameFont = String(cfg.nameFont ?? "");
    const showToAll = cfg.showToAll === true; // reveal cards even to viewers who don't own the doc
    const control = cardsCanControl(cfg);
    // Whether to show the arrange affordances (reorder + remove). GMs manage via
    // edit mode; players have no edit mode, so they get them in normal play as
    // long as they have control permission for this collection.
    const manage = control && (ctx.editMode || !game.user?.isGM);
    const wrap = el("div", `bivouac-cards bivouac-cards--${layout}`);
    const emit = (op: string, detail: Record<string, unknown>): void => {
      wrap.dispatchEvent(new CustomEvent("bivouac-card-op", { bubbles: true, detail: { id: ctx.widget.id, op, ...detail } }));
    };

    // Drop Actors / Items onto the collection to add them (controllers only).
    // In-hand reorder drags carry REORDER_TYPE and are handled by the cards.
    wrap.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types.includes(REORDER_TYPE)) return;
      if (!control || !isDocDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      wrap.classList.add("bivouac-cards--dropok");
    });
    wrap.addEventListener("dragleave", () => wrap.classList.remove("bivouac-cards--dropok"));
    wrap.addEventListener("drop", (e) => {
      wrap.classList.remove("bivouac-cards--dropok");
      if (e.dataTransfer?.types.includes(REORDER_TYPE) || !control) return;
      const data = parseDrop(e);
      if (!data || (data.type !== "Actor" && data.type !== "Item")) return;
      e.preventDefault();
      e.stopPropagation();
      emit("add", { uuid: data.uuid }); // duplicates allowed — each add is a distinct card
    });

    // Normalise the collection ({ cid, uuid }); migrate any legacy config.uuids.
    const list: { cid: string; uuid: string }[] = Array.isArray(cfg.cards)
      ? (cfg.cards as { cid: string; uuid: string }[])
      : Array.isArray(cfg.uuids)
        ? (cfg.uuids as string[]).map((u) => ({ cid: u, uuid: u }))
        : [];
    if (!list.length) {
      wrap.appendChild(placeholder("fa-solid fa-id-badge", game.i18n.localize("BIVOUAC.Widgets.Cards.Empty")));
      return wrap;
    }
    const hand = el("div", "bivouac-cards__hand");
    wrap.appendChild(hand);
    void (async () => {
      const built: HTMLElement[] = [];
      // Controllers (and "show to all") see every card so they can arrange the
      // whole collection; otherwise a viewer only sees cards they can view.
      const seeAll = showToAll || control;
      for (const entry of list) {
        const doc = (await fromUuid(entry.uuid).catch(() => null)) as Record<string, unknown> | null;
        if (!doc || (!seeAll && !canView(doc))) continue;
        const card = el("div", "bivouac-cards__card");
        card.dataset.cid = entry.cid;
        const img = document.createElement("img");
        img.className = "bivouac-cards__art";
        img.draggable = false; // the card div owns the drag, not the image
        const token = (doc.prototypeToken as { texture?: { src?: string } } | undefined)?.texture?.src;
        img.src = (art === "token" ? token || (doc.img as string) : (doc.img as string)) || "icons/svg/mystery-man.svg";
        img.alt = String(doc.name ?? "");
        card.appendChild(img);
        if (showNames) {
          const nm = el("span", "bivouac-cards__name", String(doc.name ?? ""));
          nm.style.fontSize = `${nameSize}px`;
          if (nameFont) nm.style.fontFamily = `"${nameFont}", var(--font-primary, "Signika", sans-serif)`;
          card.appendChild(nm);
        }
        // Draggable in every mode: dragging a card onto the scene carries standard
        // Foundry document data, so it makes a token in normal play and (via our
        // dropCanvasData hook) a tile in edit mode. In edit mode it also reorders
        // within the hand (REORDER_TYPE marker).
        const docType = String(doc.documentName ?? (entry.uuid.includes("Item") ? "Item" : "Actor"));
        card.draggable = control; // arranging (reorder + drag-out) is gated per-collection
        card.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          e.dataTransfer?.setData("text/plain", JSON.stringify({ type: docType, uuid: entry.uuid }));
          if (control) e.dataTransfer?.setData(REORDER_TYPE, entry.cid);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
          // Custom drag image: a small clean card-art proxy follows the cursor,
          // instead of the browser's default (a big, transformed ghost of the card).
          const ghost = document.createElement("img");
          ghost.src = img.src;
          ghost.style.cssText =
            "position:fixed;left:-9999px;top:-9999px;width:64px;height:90px;object-fit:cover;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.5);";
          document.body.appendChild(ghost);
          try {
            e.dataTransfer?.setDragImage(ghost, 32, 45);
          } catch {
            /* older browsers — fall back to the default */
          }
          window.setTimeout(() => ghost.remove(), 0);
          card.classList.add("bivouac-cards__card--dragging");
        });
        card.addEventListener("dragend", () => card.classList.remove("bivouac-cards__card--dragging"));
        // Outside edit mode a click opens the sheet (drag still reorders / drags out).
        if (!ctx.editMode) {
          card.classList.add("bivouac-interactive");
          card.addEventListener("click", () => (doc.sheet as { render?: (b: boolean) => void })?.render?.(true));
        }
        if (manage) {
          const rm = el("button", "bivouac-cards__remove");
          rm.type = "button";
          rm.title = game.i18n.localize("BIVOUAC.Widgets.Cards.Remove");
          rm.textContent = "×";
          rm.addEventListener("click", (e) => {
            e.stopPropagation();
            emit("remove", { cid: entry.cid });
          });
          card.appendChild(rm);
        }
        built.push(card);
      }
      hand.replaceChildren(...built);
      if (layout === "fan") applyFan(hand, built);
      if (manage) attachHandReorder(hand, built, emit);
    })();
    return wrap;
  },
});

/* -------------------------------------------- factory ------------------- */

/** Create a new widget of the given type with default geometry/config. */
export function createWidget(type: WidgetType, gx: number, gy: number): Widget {
  const def = getWidgetType(type);
  return {
    id: foundry.utils.randomID(),
    type,
    cell: { gx, gy, gw: GRID.defaultSize, gh: GRID.defaultSize },
    scope: "shared",
    chrome: "subtle",
    interactions: [],
    config: def ? def.defaultConfig() : {},
  };
}
