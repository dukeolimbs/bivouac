/**
 * Bivouac — the Mini Sheet tile: portrait + name + the active system's core stats,
 * plus an area where Items dragged off a character sheet are PINNED so they can be
 * rolled straight from the board.
 *
 * Two deliberate reuses rather than new machinery:
 *  • Stats come from `visibleStats()`, the same adapter-driven, setting-gated
 *    list the Cast Bar plates use — so a Daggerheart sheet shows Hit Points /
 *    Stress / Hope without this tile knowing anything about either system.
 *
 * DELIBERATE DIVERGENCE FROM THE CAST BAR (tester's decision, 2026-08-12): this
 * tile reads the PROTOTYPE actor its uuid points at, and does NOT resolve to a
 * scene token's actor the way a plate does (`sceneActor()` in `foundry-api.ts`).
 * The two surfaces want different things: a plate stands for whoever is in the
 * scene right now, so it must follow the token; a Mini Sheet is a reference card
 * pinned to a specific actor, and should keep showing that actor rather than
 * silently re-pointing itself when a token happens to be on the map. Do not
 * "fix" this into consistency — the difference is the point.
 *  • Pins are stored in `config.cards` and mutated through the SAME bubbling
 *    `bivouac-card-op` event the card collection uses. The host handlers in
 *    `world-layer.ts` / `dm-screen.ts` already validate permission and persist
 *    it, and they key off the event, not the tile type — so add / remove /
 *    reorder all work here with no new persistence path.
 */

import { cardsCanControl } from "../../constants";
import { isDocDrag, parseDrop } from "../../drop";
import { formatStat, itemInfoFor, statblockFor, visibleStats } from "../../systems";
import { docBody, docImg, openOnClick } from "../doc-tile";
import { el } from "../dom";
import { canView } from "../foundry-api";
import { registerWidgetType } from "../registry";

/** A modifier with its sign always shown. An unsigned "2" beside a "-1" reads as
 *  a score rather than a modifier, which is the one thing this strip must not be
 *  ambiguous about. */
function signed(n: number): string {
  return n < 0 ? String(n) : `+${String(n)}`;
}

registerWidgetType({
  type: "minisheet",
  label: "BIVOUAC.Widgets.MiniSheet.Label",
  icon: "fa-solid fa-id-card",
  defaultConfig: () => ({ uuid: "", cards: [] }),
  renderBody(ctx) {
    const cfg = ctx.widget.config;
    // Pinning is an arrangement action, so it takes the same gate as arranging a
    // card collection (per-tile `editRole`, else the global control role).
    const control = cardsCanControl(cfg);
    // Pins are managed by anyone the arrange role allows, in ANY mode and on
    // EITHER surface. The old rule — `control && (editMode || !isGM)` — left the
    // unpin ✕ unreachable for a GM in the DM screen, which renders every tile with
    // `editMode: false`, so both clauses were false and a mis-drag there was
    // permanent short of rebuilding the tile. Revealing the ✕ on hover of its own
    // pin (see `.bivouac-mini__unpin` in the CSS) keeps it out of the way in play
    // without hiding it, and matches how the Cast Bar gates its per-item controls.
    const manage = control;
    const emit = (op: string, detail: Record<string, unknown>): void => {
      box.dispatchEvent(
        new CustomEvent("bivouac-card-op", { bubbles: true, detail: { id: ctx.widget.id, op, ...detail } }),
      );
    };
    const box = el("div", "bivouac-mini");

    if (control) {
      // Drop an Item onto the tile to pin it. Actors are refused: this tile
      // already has one, and dropping a character onto it almost certainly means
      // "show this character", which is the config's job.
      //
      // The target is the WHOLE tile, not just the pins strip. The strip is
      // `flex: 1 1 auto; min-height: 0`, so in a short DM card it can collapse to
      // near-nothing — leaving no target under the pointer, so the drop fell
      // through to the drawer's own card handler and made a NEW CARD instead of
      // pinning. Attached once, out here rather than inside the doc callback,
      // because `box` survives re-renders (the pins strip does not) and listeners
      // would otherwise stack up on every refresh.
      //
      // `data-bivouac-nested-drop` tells the DM screen's card-level drop to stand
      // aside (see `overNestedDrop` in `dm-screen.ts`). That guard is what makes
      // this robust rather than merely likely: it holds even on the paths below
      // that bail out WITHOUT stopping propagation, e.g. a payload `parseDrop`
      // can't resolve on this system.
      box.dataset.bivouacNestedDrop = "";
      box.addEventListener("dragover", (e) => {
        if (!isDocDrag(e)) return;
        e.preventDefault();
        e.stopPropagation(); // else the board/drawer takes it and makes a new tile
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        box.classList.add("bivouac-mini--dropok");
      });
      box.addEventListener("dragleave", () => box.classList.remove("bivouac-mini--dropok"));
      box.addEventListener("drop", (e) => {
        box.classList.remove("bivouac-mini--dropok");
        const data = parseDrop(e);
        if (!data || data.type !== "Item") return;
        e.preventDefault();
        e.stopPropagation();
        emit("add", { uuid: data.uuid });
      });
    }

    return docBody(ctx, (doc, host) => {
      box.replaceChildren();

      // --- identity: portrait + name + stats ---------------------------------
      const head = el("div", "bivouac-mini__head");
      const img = document.createElement("img");
      img.className = "bivouac-mini__img";
      img.src = docImg(doc);
      img.alt = String(doc.name ?? "");
      head.appendChild(img);

      const ident = el("div", "bivouac-mini__ident");
      ident.appendChild(el("span", "bivouac-mini__name", String(doc.name ?? "")));

      const stats = el("div", "bivouac-mini__stats");
      for (const { stat, val } of visibleStats(doc)) {
        const row = el("div", `bivouac-mini__stat bivouac-plate__stat--${stat.key}`);
        if (val.reverse) row.classList.add("bivouac-mini__stat--reverse");
        row.innerHTML = `<i class="fa-solid ${stat.icon}"></i><span></span>`;
        row.querySelector("span")!.textContent = formatStat(val);
        row.dataset.tooltip = game.i18n.localize(stat.label);
        stats.appendChild(row);
      }
      if (stats.childElementCount) ident.appendChild(stats);
      head.appendChild(ident);

      // The portrait opens the full sheet — this tile is a readout, not an editor,
      // so anything it doesn't show is one click away.
      if (!ctx.editMode) openOnClick(head, doc);
      box.appendChild(head);

      // --- statblock: the at-a-glance readout --------------------------------
      // Everything here is optional and self-hiding: a block whose data the
      // system doesn't expose simply isn't built, so a Daggerheart sheet (no
      // movement, no senses, no damage-resistance table) renders fewer blocks
      // rather than a grid of blanks. Which blocks are VISIBLE at a given tile
      // size is CSS's job — see the `@container` tiers in module.css. Building
      // them all and letting the tile hide what won't fit keeps one render path
      // and means resizing a tile needs no re-render.
      const sb = statblockFor(doc);
      if (sb) {
        const facts: [string, string][] = [];
        if (sb.rank) facts.push(["fa-award", sb.rank]);
        if (sb.prof != null) facts.push(["fa-certificate", `+${sb.prof}`]);
        if (sb.speed) facts.push(["fa-person-running", sb.speed]);
        if (sb.senses) facts.push(["fa-eye", sb.senses]);
        if (facts.length) {
          const band = el("div", "bivouac-mini__facts");
          for (const [icon, text] of facts) {
            const f = el("span", "bivouac-mini__fact");
            f.appendChild(el("i", `fa-solid ${icon}`));
            f.appendChild(el("span", undefined, text));
            band.appendChild(f);
          }
          box.appendChild(band);
        }

        if (sb.abilities?.length) {
          const strip = el("div", "bivouac-mini__abilities");
          for (const a of sb.abilities) {
            const cell = el("div", "bivouac-mini__abil");
            if (a.proficient) cell.classList.add("bivouac-mini__abil--prof");
            cell.appendChild(el("span", "bivouac-mini__abil-key", a.label));
            // The MODIFIER is the number you actually roll, so it's the big one;
            // the raw score is reference and sits under it. Signed explicitly —
            // an unsigned "2" next to a "-1" reads as a score, not a modifier.
            cell.appendChild(el("span", "bivouac-mini__abil-mod", a.mod == null ? "—" : signed(a.mod)));
            if (a.score != null) cell.appendChild(el("span", "bivouac-mini__abil-score", String(a.score)));
            if (a.save != null) {
              const save = el("span", "bivouac-mini__abil-save", signed(a.save));
              save.dataset.tooltip = game.i18n.localize("BIVOUAC.StatBlock.Save");
              cell.appendChild(save);
            }
            strip.appendChild(cell);
          }
          box.appendChild(strip);
        }

        for (const t of sb.traits ?? []) {
          const row = el("div", `bivouac-mini__trait bivouac-mini__trait--${t.key}`);
          row.appendChild(el("span", "bivouac-mini__trait-label", t.label));
          row.appendChild(el("span", "bivouac-mini__trait-values", t.values.join(", ")));
          box.appendChild(row);
        }
      }

      // --- pinned features ---------------------------------------------------
      const pins = el("div", "bivouac-mini__pins");
      const list: { cid: string; uuid: string }[] = Array.isArray(cfg.cards)
        ? (cfg.cards as { cid: string; uuid: string }[])
        : [];

      if (!list.length) {
        pins.appendChild(
          el("p", "bivouac-mini__empty", game.i18n.localize(control ? "BIVOUAC.MiniSheet.Empty" : "BIVOUAC.MiniSheet.EmptyPlayer")),
        );
      } else {
        // Column header, in the manner of a character sheet's item table. It
        // exists to LABEL the columns, which is only worth doing because the
        // numbers below are in fixed columns rather than packed against the right
        // edge — without alignment there is nothing for a header to head, and
        // scanning "which of these has charges left" means reading every row.
        // Hidden on a narrow tile, where the columns collapse (see the CSS).
        const head2 = el("div", "bivouac-mini__pins-head");
        head2.appendChild(el("span", "bivouac-mini__pins-title", game.i18n.localize("BIVOUAC.MiniSheet.Pinned")));
        const cols = el("div", "bivouac-mini__pin-meta");
        for (const k of ["ColRoll", "ColFormula", "ColUses"]) {
          cols.appendChild(el("span", undefined, game.i18n.localize(`BIVOUAC.MiniSheet.${k}`)));
        }
        head2.appendChild(cols);
        // Reserve the unpin ✕'s width so the columns line up with the rows below
        // it, which carry that button.
        if (manage) head2.appendChild(el("span", "bivouac-mini__pins-spacer"));
        pins.appendChild(head2);
      }

      for (const pin of list) {
        // The unpin ✕ is a SIBLING of the pin button, inside a row wrapper — not
        // a child of it. A <button> nested inside a <button> is invalid
        // interactive nesting, and Chromium resolves the activation to the
        // ANCESTOR: clicking the ✕ fired the pin (rolling the ability) instead of
        // removing it, and no amount of `stopPropagation` on the inner handler
        // fixes that, because it isn't a propagation problem. Keeping them as
        // siblings is the only structurally correct arrangement.
        const row = el("div", "bivouac-mini__pin-row");
        const btn = el("button", "bivouac-mini__pin");
        btn.type = "button";
        const icon = document.createElement("img");
        icon.className = "bivouac-mini__pin-img";
        btn.appendChild(icon);
        const col = el("div", "bivouac-mini__pin-text");
        const label = el("span", "bivouac-mini__pin-name", "…");
        col.appendChild(label);
        btn.appendChild(col);
        row.appendChild(btn);

        // Resolve async so a compendium item doesn't block the tile rendering.
        void (async () => {
          const item = (await fromUuid(pin.uuid).catch(() => null)) as Record<string, unknown> | null;
          if (!item) {
            btn.classList.add("bivouac-mini__pin--missing");
            label.textContent = game.i18n.localize("BIVOUAC.Doc.Missing");
            return;
          }
          icon.src = docImg(item);
          label.textContent = String(item.name ?? "");

          // A pin answered "what can I click", not "should I click it" — you
          // still had to open the sheet to see the attack bonus, the damage or
          // whether a charge was left, which is the thing the tile exists to
          // save. So the numbers are ON the row, mirroring the sheet's own
          // ROLL / FORMULA / CHARGES columns; only the wordy reference fields
          // (activation, range) go to the subtitle and tooltip. Every field is
          // optional, so a system that exposes none renders as it did before.
          const info = itemInfoFor(item);
          const sub = [info?.activation, info?.range].filter(Boolean).join(" • ");
          if (sub) col.appendChild(el("span", "bivouac-mini__pin-sub", sub));

          // ALWAYS three cells, even when empty. Packing only the values that
          // exist puts a weapon's damage under the next row's charges and makes
          // the column header a lie — fixed cells are what let a GM read straight
          // down "what still has uses" instead of parsing each row.
          const meta = el("div", "bivouac-mini__pin-meta");
          const cell = (text: string, cls = ""): HTMLElement => {
            const c = el("span", `bivouac-mini__pin-cell ${cls}`.trim(), text);
            meta.appendChild(c);
            return c;
          };
          cell(info?.attack ?? "", "bivouac-mini__pin-cell--atk");
          cell(info?.formula ?? "", "bivouac-mini__pin-cell--dmg");
          const uses = info?.uses;
          const usesCell = cell(
            uses ? (uses.max == null ? `${uses.value}` : `${uses.value}/${uses.max}`) : "",
            "bivouac-mini__pin-cell--uses",
          );
          // Dimmed at zero as a readout, but still clickable: whether a depleted
          // ability may fire is the system's call (and MidiQoL's), not ours —
          // refusing here would block legitimate use.
          if (uses && uses.value <= 0) usesCell.classList.add("bivouac-mini__pin-uses--out");
          btn.appendChild(meta);

          const detail = [info?.activation, info?.range, info?.attack, info?.formula].filter(Boolean).join(" · ");
          btn.dataset.tooltip = detail ? `${String(item.name ?? "")}\n${detail}` : String(item.name ?? "");
          // Rolling is gated by FOUNDRY's permission on the item, not by our
          // arrange role: being allowed to rearrange someone's board is not the
          // same as being allowed to use their abilities.
          if (!canView(item)) {
            btn.disabled = true;
            return;
          }
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const it = item as {
              usable?: boolean;
              use?: () => unknown;
              roll?: () => unknown;
              sheet?: { render?: (b: boolean) => void };
            };
            // Ask the system whether the item is actually usable before calling
            // `use()`. Daggerheart, for one, defines `use()` to return silently
            // when an item has no actions — which is most passive features — so
            // calling it regardless makes the button look broken. Where the
            // system tells us (`usable`), honour it; where it doesn't, the
            // property is undefined and we just try.
            const usable = typeof it.usable === "boolean" ? it.usable : true;
            if (usable && typeof it.use === "function") void it.use();
            else if (usable && typeof it.roll === "function") void it.roll();
            // Nothing to roll — a passive feature, or a plain Item. Open its
            // sheet so the click still shows you the thing you asked for.
            else it.sheet?.render?.(true);
          });
        })();

        if (manage) {
          const x = el("button", "bivouac-mini__unpin");
          x.type = "button";
          x.innerHTML = `<i class="fa-solid fa-xmark"></i>`;
          x.title = game.i18n.localize("BIVOUAC.MiniSheet.Unpin");
          // The click guard alone was not enough in live testing — clicking ✕
          // still fired the pin. `click` is the LAST event in the sequence, so
          // anything acting on `pointerdown` / `mousedown` (a delegated handler,
          // or the surface's own select/drag wiring) has already run by then.
          // Swallowing the whole sequence at the ✕ is what makes it inert to
          // every listener upstream, whichever one was catching it.
          for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
            x.addEventListener(type, (e) => {
              e.stopPropagation();
              e.preventDefault();
            });
          }
          x.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            emit("remove", { cid: pin.cid });
          });
          row.appendChild(x);
        }
        pins.appendChild(row);
      }
      box.appendChild(pins);
      host.replaceChildren(box);
    });
  },
});
