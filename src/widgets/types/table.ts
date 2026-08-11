/** Bivouac — the rollable-table tile: the entry list plus a Roll button that
 *  draws for real and then lands the highlight on the drawn row. */

import { docBody } from "../doc-tile";
import { el } from "../dom";
import { registerWidgetType } from "../registry";

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
