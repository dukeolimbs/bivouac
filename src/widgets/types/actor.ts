/** Bivouac — the actor tile: portrait art + name; click opens the sheet. */

import { docBody, docImg, openOnClick } from "../doc-tile";
import { el } from "../dom";
import { registerWidgetType } from "../registry";

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
      if (!ctx.editMode) openOnClick(box, doc);
      host.replaceChildren(box);
    });
  },
});
