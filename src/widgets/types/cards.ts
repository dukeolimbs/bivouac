/** Bivouac — the card-collection tile: a hand of documents shown as cards (fan /
 *  row / grid). Drop Actors or Items on it to add them; drag within it to reorder.
 *  Add/remove/move are dispatched as bubbling `bivouac-card-op` events the host
 *  surface persists (see `applyCardOp` in `../card-model.ts`). */

import { cardsCanControl } from "../../constants";
import { isDocDrag, parseDrop } from "../../drop";
import { openOnClick } from "../doc-tile";
import { el, placeholder } from "../dom";
import { fontStack } from "../fonts";
import { canView } from "../foundry-api";
import { registerWidgetType } from "../registry";

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

/** A collection of documents shown as a hand of cards (fan / row / grid). Drop
 *  Actors or Items onto it to add them; a card opens its sheet (if permitted).
 *  Card add/remove is dispatched as a bubbling `bivouac-card-op` event the host
 *  surface (world layer / DM screen) persists. */
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
          const stack = fontStack(nameFont, "");
          if (stack) nm.style.fontFamily = stack;
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
        if (!ctx.editMode) openOnClick(card, doc);
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
