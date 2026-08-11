/** Bivouac — the macro tile: an icon/name button that executes the macro. */

import { docBody } from "../doc-tile";
import { el } from "../dom";
import { registerWidgetType } from "../registry";

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
