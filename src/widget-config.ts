/** Bivouac — per-widget configuration dialog (DialogV2). */

import type { Widget, WidgetBackground, WidgetFrame, WidgetScope, WidgetType } from "./constants";
import { availableFonts, backgroundOf, frameOf, widgetTypes } from "./widgets";

type SaveFn = (updated: Widget) => void;
type LiveFn = (updated: Widget) => void;

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

/** A collapsible-looking titled section grouping related fields. */
function section(title: string, rows: string[]): string {
  if (!rows.length) return "";
  return `<fieldset class="bivouac-config__section"><legend>${esc(title)}</legend>${rows.join("")}</fieldset>`;
}

function buildForm(widget: Widget): string {
  // ---- General -------------------------------------------------------------
  const general = [
    group(t("BIVOUAC.Config.Title"),
      `<input type="text" name="title" value="${esc(widget.title ?? "")}" placeholder="${esc(t("BIVOUAC.Config.TitlePlaceholder"))}">`),
    group(t("BIVOUAC.Config.Scope"),
      `<select name="scope">
         <option value="shared"${widget.scope === "shared" ? " selected" : ""}>${esc(t("BIVOUAC.Config.ScopeShared"))}</option>
         <option value="dm"${widget.scope === "dm" ? " selected" : ""}>${esc(t("BIVOUAC.Config.ScopeDM"))}</option>
       </select>`),
  ];

  // ---- Content (type-specific) --------------------------------------------
  const content: string[] = [];
  switch (widget.type) {
    case "webview":
      content.push(group(t("BIVOUAC.Config.Url"),
        `<input type="text" name="url" value="${esc(widget.config.url ?? "")}" placeholder="${esc(t("BIVOUAC.Config.UrlPlaceholder"))}">` +
          `<p class="bivouac-config__hint">${esc(t("BIVOUAC.Config.UrlHint"))}</p>`));
      content.push(group(t("BIVOUAC.Config.WebviewZoom"),
        `<input type="number" name="zoom" value="${esc(Number(widget.config.zoom) || 1)}" min="0.25" max="4" step="0.05" title="${esc(t("BIVOUAC.Config.WebviewZoomHint"))}">`));
      break;
    case "image": {
      content.push(group(t("BIVOUAC.Config.Src"),
        `<input type="text" name="src" value="${esc(widget.config.src ?? "")}" placeholder="${esc(t("BIVOUAC.Config.SrcPlaceholder"))}">`));
      const fit = String(widget.config.fit ?? "cover");
      content.push(group(t("BIVOUAC.Config.Fit"),
        `<select name="fit">
           <option value="cover"${fit === "cover" ? " selected" : ""}>cover</option>
           <option value="contain"${fit === "contain" ? " selected" : ""}>contain</option>
         </select>`));
      const inter = widget.interactions[0];
      const actions = ["none", "openSheet", "openJournal", "runMacro"];
      content.push(group(t("BIVOUAC.Config.OnClick"),
        `<select name="iAction">${actions
          .map((a) => `<option value="${a}"${inter?.action === a || (!inter && a === "none") ? " selected" : ""}>${esc(t(`BIVOUAC.Config.Action_${a}`))}</option>`)
          .join("")}</select>`));
      content.push(group(t("BIVOUAC.Config.TargetUuid"),
        `<input type="text" name="iUuid" value="${esc(inter?.uuid ?? "")}" placeholder="${esc(t("BIVOUAC.Config.TargetUuidPlaceholder"))}">`));
      break;
    }
    case "note": {
      content.push(group(t("BIVOUAC.Config.Html"),
        `<textarea name="html" rows="6" placeholder="${esc(t("BIVOUAC.Config.HtmlPlaceholder"))}">${esc(widget.config.html ?? "")}</textarea>` +
          `<p class="bivouac-config__hint">${esc(t("BIVOUAC.Config.HtmlHint"))}</p>`));
      content.push(group(t("BIVOUAC.Config.NoteTextSize"),
        `<input type="number" name="textScale" value="${esc(Number(widget.config.textScale) || 1)}" min="0.5" max="3" step="0.1" title="${esc(t("BIVOUAC.Config.NoteTextSizeHint"))}">`));
      const curFont = String(widget.config.font ?? "");
      const fontOpts = [`<option value=""${curFont === "" ? " selected" : ""}>${esc(t("BIVOUAC.Config.NoteFontDefault"))}</option>`]
        .concat(availableFonts().map((f) => `<option value="${esc(f)}"${curFont === f ? " selected" : ""}>${esc(f)}</option>`))
        .join("");
      content.push(group(t("BIVOUAC.Config.NoteFont"), `<select name="noteFont">${fontOpts}</select>`));
      content.push(group(t("BIVOUAC.Config.NoteFontCustom"),
        `<input type="text" name="noteFontCustom" value="${esc(widget.config.fontCustom ?? "")}" placeholder="${esc(t("BIVOUAC.Config.NoteFontCustomPlaceholder"))}">` +
          `<p class="bivouac-config__hint">${esc(t("BIVOUAC.Config.NoteFontHint"))}</p>`));
      break;
    }
    case "actor":
    case "table":
    case "macro":
      content.push(group(t("BIVOUAC.Config.LinkedDoc"),
        `<input type="text" name="uuid" value="${esc(widget.config.uuid ?? "")}" placeholder="${esc(t("BIVOUAC.Config.LinkedDocPlaceholder"))}">` +
          `<p class="bivouac-config__hint">${esc(t("BIVOUAC.Config.LinkedDocHint"))}</p>`));
      break;
    case "journal": {
      content.push(group(t("BIVOUAC.Config.LinkedDoc"),
        `<input type="text" name="uuid" value="${esc(widget.config.uuid ?? "")}" placeholder="${esc(t("BIVOUAC.Config.LinkedDocPlaceholder"))}">`));
      const jmode = widget.config.journalMode === "link" ? "link" : "inline";
      content.push(group(t("BIVOUAC.Config.JournalMode"),
        `<select name="journalMode">
           <option value="inline"${jmode === "inline" ? " selected" : ""}>${esc(t("BIVOUAC.Config.JournalInline"))}</option>
           <option value="link"${jmode === "link" ? " selected" : ""}>${esc(t("BIVOUAC.Config.JournalLink"))}</option>
         </select>`));
      break;
    }
    case "cards": {
      const layouts: [string, string][] = [
        ["fan", t("BIVOUAC.Config.CardsLayout_fan")],
        ["row", t("BIVOUAC.Config.CardsLayout_row")],
        ["grid", t("BIVOUAC.Config.CardsLayout_grid")],
      ];
      const curLayout = ["fan", "row", "grid"].includes(String(widget.config.layout)) ? String(widget.config.layout) : "fan";
      content.push(group(t("BIVOUAC.Config.CardsLayout"),
        `<select name="cardsLayout">${layouts
          .map(([v, l]) => `<option value="${v}"${curLayout === v ? " selected" : ""}>${esc(l)}</option>`)
          .join("")}</select>`));
      const curArt = widget.config.art === "token" ? "token" : "portrait";
      content.push(group(t("BIVOUAC.Config.CardsArt"),
        `<select name="cardsArt">
           <option value="portrait"${curArt === "portrait" ? " selected" : ""}>${esc(t("BIVOUAC.Config.CardsArt_portrait"))}</option>
           <option value="token"${curArt === "token" ? " selected" : ""}>${esc(t("BIVOUAC.Config.CardsArt_token"))}</option>
         </select>`));
      const showNames = widget.config.showNames !== false;
      content.push(group(t("BIVOUAC.Config.CardsShowNames"),
        `<input type="checkbox" name="cardsShowNames"${showNames ? " checked" : ""}>`));
      const curCardFont = String(widget.config.nameFont ?? "");
      const cardFontOpts = [`<option value=""${curCardFont === "" ? " selected" : ""}>${esc(t("BIVOUAC.Config.NoteFontDefault"))}</option>`]
        .concat(availableFonts().map((f) => `<option value="${esc(f)}"${curCardFont === f ? " selected" : ""}>${esc(f)}</option>`))
        .join("");
      content.push(group(t("BIVOUAC.Config.CardsNameFont"), `<select name="cardsNameFont">${cardFontOpts}</select>`));
      content.push(group(t("BIVOUAC.Config.CardsNameSize"),
        `<input type="number" name="cardsNameSize" value="${esc(Number(widget.config.nameSize) || 12)}" min="6" max="48" step="1">` +
          `<p class="bivouac-config__hint">${esc(t("BIVOUAC.Config.CardsHint"))}</p>`));
      break;
    }
  }

  // ---- Frame (border) axis -------------------------------------------------
  const frames: WidgetFrame[] = ["none", "subtle", "framed"];
  const curFrame = frameOf(widget);
  const frameColor = typeof widget.config.frameColor === "string" ? widget.config.frameColor : "#d98b3a";
  const frameOpacity = Number.isFinite(Number(widget.config.frameOpacity)) ? Number(widget.config.frameOpacity) : 0.4;
  const frame = [
    group(t("BIVOUAC.Config.Frame"),
      `<select name="frame">${frames
        .map((f) => `<option value="${f}"${curFrame === f ? " selected" : ""}>${esc(t(`BIVOUAC.Config.Chrome_${f}`))}</option>`)
        .join("")}</select>`),
    group(t("BIVOUAC.Config.FrameColor"), `<input type="color" name="frameColor" value="${esc(frameColor)}">`),
    group(t("BIVOUAC.Config.FrameOpacity"),
      `<input type="range" name="frameOpacity" value="${esc(frameOpacity)}" min="0" max="1" step="0.05" title="${esc(t("BIVOUAC.Config.FrameOpacityHint"))}"><output class="bivouac-range-out">${esc(frameOpacity)}</output>`),
  ];

  // ---- Background (fill) axis ---------------------------------------------
  const backgrounds: WidgetBackground[] = ["none", "solid", "frosted", "gradient", "image"];
  const curBg = backgroundOf(widget);
  const bgColor = typeof widget.config.bgColor === "string" ? widget.config.bgColor : "#101219";
  const bgColor2 = typeof widget.config.bgColor2 === "string" ? widget.config.bgColor2 : bgColor;
  const bgImage = typeof widget.config.bgImage === "string" ? widget.config.bgImage : "";
  const bgOpacity = Number.isFinite(Number(widget.config.bgOpacity)) ? Number(widget.config.bgOpacity) : 0.4;
  const background = [
    group(t("BIVOUAC.Config.Background"),
      `<select name="background">${backgrounds
        .map((b) => `<option value="${b}"${curBg === b ? " selected" : ""}>${esc(t(`BIVOUAC.Config.Bg_${b}`))}</option>`)
        .join("")}</select>`),
    group(t("BIVOUAC.Config.BgColor"), `<input type="color" name="bgColor" value="${esc(bgColor)}">`),
    group(t("BIVOUAC.Config.BgColor2"), `<input type="color" name="bgColor2" value="${esc(bgColor2)}">`),
    group(t("BIVOUAC.Config.BgImage"),
      `<input type="text" name="bgImage" value="${esc(bgImage)}" placeholder="${esc(t("BIVOUAC.Config.BgImagePlaceholder"))}">`),
    group(t("BIVOUAC.Config.BgOpacity"),
      `<input type="range" name="bgOpacity" value="${esc(bgOpacity)}" min="0" max="1" step="0.05" title="${esc(t("BIVOUAC.Config.BgOpacityHint"))}"><output class="bivouac-range-out">${esc(bgOpacity)}</output>`),
  ];

  return `<div class="bivouac-config standard-form">${
    section(t("BIVOUAC.Config.Section_General"), general) +
    section(t("BIVOUAC.Config.Section_Content"), content) +
    section(t("BIVOUAC.Config.Section_Frame"), frame) +
    section(t("BIVOUAC.Config.Section_Background"), background)
  }</div>`;
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

  // Frame (border) axis.
  updated.config.frame = (["none", "subtle", "framed"].includes(data.frame) ? data.frame : "subtle") as WidgetFrame;
  updated.config.frameColor = /^#[0-9a-fA-F]{6}$/.test(data.frameColor ?? "") ? data.frameColor : "#d98b3a";
  const frameOp = Number(data.frameOpacity);
  updated.config.frameOpacity = Number.isFinite(frameOp) ? Math.min(1, Math.max(0, frameOp)) : 0.4;

  // Background (fill) axis.
  updated.config.background = (["none", "solid", "frosted", "gradient", "image"].includes(data.background)
    ? data.background
    : "frosted") as WidgetBackground;
  updated.config.bgColor = /^#[0-9a-fA-F]{6}$/.test(data.bgColor ?? "") ? data.bgColor : "#101219";
  updated.config.bgColor2 = /^#[0-9a-fA-F]{6}$/.test(data.bgColor2 ?? "")
    ? data.bgColor2
    : (updated.config.bgColor as string);
  updated.config.bgImage = data.bgImage?.trim() ?? "";
  const bgOp = Number(data.bgOpacity);
  updated.config.bgOpacity = Number.isFinite(bgOp) ? Math.min(1, Math.max(0, bgOp)) : 0.4;

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
      updated.config.font = typeof data.noteFont === "string" ? data.noteFont : "";
      updated.config.fontCustom = (data.noteFontCustom ?? "").trim();
      break;
    }
    case "actor":
    case "table":
    case "macro":
      updated.config.uuid = data.uuid?.trim() ?? "";
      break;
    case "journal":
      updated.config.uuid = data.uuid?.trim() ?? "";
      updated.config.journalMode = data.journalMode === "link" ? "link" : "inline";
      break;
    case "cards": {
      updated.config.layout = ["fan", "row", "grid"].includes(data.cardsLayout) ? data.cardsLayout : "fan";
      updated.config.art = data.cardsArt === "token" ? "token" : "portrait";
      updated.config.showNames = data.cardsShowNames === "on";
      updated.config.nameFont = typeof data.cardsNameFont === "string" ? data.cardsNameFont : "";
      const ns = Number(data.cardsNameSize);
      updated.config.nameSize = Number.isFinite(ns) ? Math.min(48, Math.max(6, ns)) : 12;
      break;
    }
  }
  return updated;
}

/** Insert `text` at the textarea's selection, preferring execCommand so the
 *  textarea keeps its native undo stack; falls back to setRangeText. */
function insertText(ta: HTMLTextAreaElement, text: string): void {
  ta.focus();
  try {
    if (document.execCommand("insertText", false, text)) return;
  } catch {
    /* execCommand unavailable — fall through */
  }
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? start;
  ta.setRangeText(text, start, end, "end");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Wrap the current selection in `before`…`after`. With no selection, insert
 *  the empty pair and park the caret between the tags. */
function wrapSelection(ta: HTMLTextAreaElement, before: string, after: string): void {
  const start = ta.selectionStart ?? 0;
  const selected = ta.value.slice(start, ta.selectionEnd ?? start);
  insertText(ta, before + selected + after);
  const caret = selected ? start + before.length + selected.length + after.length : start + before.length;
  ta.setSelectionRange(caret, caret);
}

/** A single-token http(s) URL with no whitespace. */
function isBareUrl(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s) && !/\s/.test(s);
}

/** Ctrl/⌘+B/I/U formatting + paste-a-URL-over-selection → hyperlink, on the
 *  note editor's raw-HTML textarea. */
function wireNoteEditor(form: HTMLFormElement): void {
  const ta = form.querySelector('textarea[name="html"]') as HTMLTextAreaElement | null;
  if (!ta) return;
  const tags: Record<string, string> = { b: "strong", i: "em", u: "u" };
  ta.addEventListener("keydown", (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const tag = tags[e.key.toLowerCase()];
    if (!tag) return;
    e.preventDefault();
    wrapSelection(ta, `<${tag}>`, `</${tag}>`);
  });
  ta.addEventListener("paste", (e: ClipboardEvent) => {
    if ((ta.selectionStart ?? 0) === (ta.selectionEnd ?? 0)) return; // no selection → normal paste
    const url = (e.clipboardData?.getData("text/plain") ?? "").trim();
    if (!isBareUrl(url)) return; // not a bare URL → normal paste
    e.preventDefault();
    wrapSelection(ta, `<a href="${esc(url)}">`, "</a>");
  });
}

/** While a config dialog is open, this holds its live-preview binding so the
 *  (once-registered) renderDialogV2 hook can wire input → preview. Only one
 *  config dialog is open at a time. */
let activeLive: { widget: Widget; onLive: LiveFn } | null = null;
let liveHookReady = false;
function ensureLiveHook(): void {
  if (liveHookReady) return;
  liveHookReady = true;
  Hooks.on("renderDialogV2", (_app: unknown, html: unknown) => {
    const root = html instanceof HTMLElement ? html : (html as { [0]?: HTMLElement } | null)?.[0];
    const form = root?.querySelector?.("form") as HTMLFormElement | null;
    if (!form || !form.querySelector(".bivouac-config")) return; // only our tile-config dialog
    wireNoteEditor(form);
    const bind = activeLive;
    const onInput = (): void => {
      // Keep each slider's numeric readout in sync.
      form.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((r) => {
        const out = r.nextElementSibling;
        if (out instanceof HTMLOutputElement) out.value = r.value;
      });
      // Live-preview style edits (edit flow only; the add flow has no binding).
      if (bind) bind.onLive(applyForm(bind.widget, readForm(form)));
    };
    onInput();
    form.addEventListener("input", onInput);
  });
}

export async function openWidgetConfig(widget: Widget, onSave: SaveFn, onLive?: LiveFn): Promise<void> {
  ensureLiveHook();
  activeLive = onLive ? { widget, onLive } : null;
  try {
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: t("BIVOUAC.Edit.ConfigTitle"), icon: "fa-solid fa-gear", resizable: true },
      position: { width: 480 },
      content: buildForm(widget),
      ok: {
        label: t("BIVOUAC.Edit.Save"),
        icon: "fa-solid fa-check",
        callback: (_event: Event, button: { form: HTMLFormElement }) => readForm(button.form),
      },
      rejectClose: false,
    });
    if (!result) {
      onLive?.(widget); // cancelled → revert the live preview to the original
      return;
    }
    onSave(applyForm(widget, result as Record<string, string>));
  } finally {
    activeLive = null;
  }
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
