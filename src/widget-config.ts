/** Bivouac — per-widget configuration dialog (DialogV2). */

import type { Widget, WidgetChrome, WidgetScope, WidgetType } from "./constants";
import { widgetTypes } from "./widgets";

type SaveFn = (updated: Widget) => void;

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function t(key: string): string {
  return game.i18n.localize(key);
}

function group(label: string, field: string): string {
  return `<div class="form-group"><label>${esc(label)}</label><div class="form-fields">${field}</div></div>`;
}

function buildForm(widget: Widget): string {
  const rows: string[] = [];

  rows.push(group(t("BIVOUAC.Config.Title"),
    `<input type="text" name="title" value="${esc(widget.title ?? "")}" placeholder="${esc(t("BIVOUAC.Config.TitlePlaceholder"))}">`));

  rows.push(group(t("BIVOUAC.Config.Scope"),
    `<select name="scope">
       <option value="shared"${widget.scope === "shared" ? " selected" : ""}>${esc(t("BIVOUAC.Config.ScopeShared"))}</option>
       <option value="dm"${widget.scope === "dm" ? " selected" : ""}>${esc(t("BIVOUAC.Config.ScopeDM"))}</option>
     </select>`));

  const chromes: WidgetChrome[] = ["none", "subtle", "framed"];
  rows.push(group(t("BIVOUAC.Config.Chrome"),
    `<select name="chrome">${chromes
      .map((c) => `<option value="${c}"${widget.chrome === c ? " selected" : ""}>${esc(t(`BIVOUAC.Config.Chrome_${c}`))}</option>`)
      .join("")}</select>`));

  // Per-tile frame colour + opacity (overrides the theme panel for the
  // Subtle/Framed styles when "custom" is ticked; otherwise theme default).
  const frameCustom = !!widget.config.frameCustom;
  const frameColor = typeof widget.config.frameColor === "string" ? widget.config.frameColor : "#101219";
  const frameOpacity = Number.isFinite(Number(widget.config.frameOpacity)) ? Number(widget.config.frameOpacity) : 0.4;
  rows.push(group(t("BIVOUAC.Config.FrameCustom"),
    `<input type="checkbox" name="frameCustom"${frameCustom ? " checked" : ""}>`));
  rows.push(group(t("BIVOUAC.Config.FrameColor"),
    `<input type="color" name="frameColor" value="${esc(frameColor)}">`));
  rows.push(group(t("BIVOUAC.Config.FrameOpacity"),
    `<input type="number" name="frameOpacity" value="${esc(frameOpacity)}" min="0" max="1" step="0.05" title="${esc(t("BIVOUAC.Config.FrameOpacityHint"))}">`));

  switch (widget.type) {
    case "webview":
      rows.push(group(t("BIVOUAC.Config.Url"),
        `<input type="text" name="url" value="${esc(widget.config.url ?? "")}" placeholder="${esc(t("BIVOUAC.Config.UrlPlaceholder"))}">`));
      rows.push(group(t("BIVOUAC.Config.WebviewZoom"),
        `<input type="number" name="zoom" value="${esc(Number(widget.config.zoom) || 1)}" min="0.25" max="4" step="0.05" title="${esc(t("BIVOUAC.Config.WebviewZoomHint"))}">`));
      break;
    case "image": {
      rows.push(group(t("BIVOUAC.Config.Src"),
        `<input type="text" name="src" value="${esc(widget.config.src ?? "")}" placeholder="${esc(t("BIVOUAC.Config.SrcPlaceholder"))}">`));
      const fit = String(widget.config.fit ?? "cover");
      rows.push(group(t("BIVOUAC.Config.Fit"),
        `<select name="fit">
           <option value="cover"${fit === "cover" ? " selected" : ""}>cover</option>
           <option value="contain"${fit === "contain" ? " selected" : ""}>contain</option>
         </select>`));
      const inter = widget.interactions[0];
      const actions = ["none", "openSheet", "openJournal", "runMacro"];
      rows.push(group(t("BIVOUAC.Config.OnClick"),
        `<select name="iAction">${actions
          .map((a) => `<option value="${a}"${inter?.action === a || (!inter && a === "none") ? " selected" : ""}>${esc(t(`BIVOUAC.Config.Action_${a}`))}</option>`)
          .join("")}</select>`));
      rows.push(group(t("BIVOUAC.Config.TargetUuid"),
        `<input type="text" name="iUuid" value="${esc(inter?.uuid ?? "")}" placeholder="${esc(t("BIVOUAC.Config.TargetUuidPlaceholder"))}">`));
      break;
    }
    case "note":
      rows.push(group(t("BIVOUAC.Config.Html"),
        `<textarea name="html" rows="6" placeholder="${esc(t("BIVOUAC.Config.HtmlPlaceholder"))}">${esc(widget.config.html ?? "")}</textarea>`));
      rows.push(group(t("BIVOUAC.Config.NoteTextSize"),
        `<input type="number" name="textScale" value="${esc(Number(widget.config.textScale) || 1)}" min="0.5" max="3" step="0.1" title="${esc(t("BIVOUAC.Config.NoteTextSizeHint"))}">`));
      break;
  }

  return `<div class="bivouac-config standard-form">${rows.join("")}</div>`;
}

function readForm(form: HTMLFormElement): Record<string, string> {
  const data = new FormData(form);
  const out: Record<string, string> = {};
  for (const [k, v] of data.entries()) out[k] = typeof v === "string" ? v : "";
  return out;
}

function applyForm(widget: Widget, data: Record<string, string>): Widget {
  const updated: Widget = {
    ...widget,
    config: { ...widget.config },
    interactions: [...widget.interactions],
  };
  updated.title = data.title?.trim() || undefined;
  updated.scope = (data.scope === "dm" ? "dm" : "shared") as WidgetScope;
  updated.chrome = (["none", "subtle", "framed"].includes(data.chrome) ? data.chrome : "subtle") as WidgetChrome;

  updated.config.frameCustom = !!data.frameCustom;
  updated.config.frameColor = /^#[0-9a-fA-F]{6}$/.test(data.frameColor ?? "") ? data.frameColor : "#101219";
  const frameOp = Number(data.frameOpacity);
  updated.config.frameOpacity = Number.isFinite(frameOp) ? Math.min(1, Math.max(0, frameOp)) : 0.4;

  switch (widget.type) {
    case "webview": {
      updated.config.url = data.url?.trim() ?? "";
      const z = Number(data.zoom);
      updated.config.zoom = Number.isFinite(z) ? Math.min(4, Math.max(0.25, z)) : 1;
      break;
    }
    case "image":
      updated.config.src = data.src?.trim() ?? "";
      updated.config.fit = data.fit === "contain" ? "contain" : "cover";
      updated.interactions =
        data.iAction && data.iAction !== "none" && data.iUuid?.trim()
          ? [{ trigger: "click", action: data.iAction as never, uuid: data.iUuid.trim() }]
          : [];
      break;
    case "note": {
      updated.config.html = data.html ?? "";
      const s = Number(data.textScale);
      updated.config.textScale = Number.isFinite(s) ? Math.min(3, Math.max(0.5, s)) : 1;
      break;
    }
  }
  return updated;
}

export async function openWidgetConfig(widget: Widget, onSave: SaveFn): Promise<void> {
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("BIVOUAC.Edit.ConfigTitle"), icon: "fa-solid fa-gear" },
    position: { width: 480 },
    content: buildForm(widget),
    ok: {
      label: t("BIVOUAC.Edit.Save"),
      icon: "fa-solid fa-check",
      callback: (_event: Event, button: { form: HTMLFormElement }) => readForm(button.form),
    },
    rejectClose: false,
  });
  if (!result) return;
  onSave(applyForm(widget, result as Record<string, string>));
}

/** Prompt the GM to choose a widget type to add. Resolves null on cancel. */
export async function pickWidgetType(): Promise<WidgetType | null> {
  const defs = widgetTypes();
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: t("BIVOUAC.Edit.AddTitle"), icon: "fa-solid fa-plus" },
    content: `<p class="bivouac-pick-hint">${esc(t("BIVOUAC.Edit.AddHint"))}</p>`,
    buttons: defs.map((d) => ({ action: d.type, label: t(d.label), icon: d.icon })),
    rejectClose: false,
  });
  return defs.find((d) => d.type === result)?.type ?? null;
}
