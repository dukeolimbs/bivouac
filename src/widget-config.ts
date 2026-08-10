/** Bivouac — per-widget configuration dialog (DialogV2). */

import type { Widget, WidgetBackground, WidgetFrame, WidgetScope, WidgetType } from "./constants";
import { METER_KINDS, availableFonts, backgroundOf, frameOf, readMeter, widgetTypes } from "./widgets";

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

/** Suggestions for the Circle meter's centre icon — offered as a datalist, so
 *  any other Font Awesome class the GM types still works. */
const METER_ICONS = [
  "fa-solid fa-heart",
  "fa-solid fa-bolt",
  "fa-solid fa-shield-halved",
  "fa-solid fa-flask",
  "fa-solid fa-skull",
  "fa-solid fa-hourglass-half",
  "fa-solid fa-clock",
  "fa-solid fa-fire",
  "fa-solid fa-droplet",
  "fa-solid fa-moon",
  "fa-solid fa-sun",
  "fa-solid fa-star",
  "fa-solid fa-gem",
  "fa-solid fa-coins",
  "fa-solid fa-wheat-awn",
  "fa-solid fa-eye",
] as const;

/** `<option>`s for a per-tile minimum-role gate (`config.editRole`; 0 = inherit
 *  the global control role). Shared by the card and meter tiles — the value
 *  labels live under the `CardsRole_*` keys. */
function roleOptions(current: unknown): string {
  const cur = String(Number(current) || 0);
  return (["inherit", "player", "trusted", "assistant", "gm"] as const)
    .map((key, value) => {
      const v = String(value);
      return `<option value="${v}"${cur === v ? " selected" : ""}>${esc(t(`BIVOUAC.Config.CardsRole_${key}`))}</option>`;
    })
    .join("");
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
  // Text colour — offered on tiles that display text.
  if (["note", "journal", "table", "macro", "cards", "actor", "meter"].includes(widget.type)) {
    const tcOn = typeof widget.config.textColor === "string" && /^#[0-9a-fA-F]{6}$/.test(widget.config.textColor);
    const tc = tcOn ? (widget.config.textColor as string) : "#ffffff";
    general.push(group(t("BIVOUAC.Config.TextColor"),
      `<label class="bivouac-config__inline"><input type="checkbox" name="textColorOn"${tcOn ? " checked" : ""}> ${esc(t("BIVOUAC.Config.TextColorCustom"))}</label>` +
        `<input type="color" name="textColor" value="${esc(tc)}">`));
  }
  // Text stroke — offered on every tile (they all carry a title). Tri-state: a
  // plain checkbox couldn't express "follow the world default".
  {
    const ts = String(widget.config.textStroke ?? "");
    const opt = (v: string, label: string): string =>
      `<option value="${v}"${ts === v || (v === "" && ts !== "on" && ts !== "off") ? " selected" : ""}>${esc(t(label))}</option>`;
    general.push(group(t("BIVOUAC.Config.TextStroke"),
      `<select name="textStroke">
         ${opt("", "BIVOUAC.Config.TextStrokeInherit")}
         ${opt("on", "BIVOUAC.Config.TextStrokeOn")}
         ${opt("off", "BIVOUAC.Config.TextStrokeOff")}
       </select>` +
        `<p class="bivouac-config__hint">${esc(t("BIVOUAC.Config.TextStrokeHint"))}</p>`));
  }

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
    case "meter": {
      const m = readMeter(widget.config);
      content.push(group(t("BIVOUAC.Config.MeterKind"),
        `<select name="meterKind">${METER_KINDS
          .map((k) => `<option value="${k}"${m.kind === k ? " selected" : ""}>${esc(t(`BIVOUAC.Config.MeterKind_${k}`))}</option>`)
          .join("")}</select>` +
          `<p class="bivouac-config__hint">${esc(t("BIVOUAC.Config.MeterKindHint"))}</p>`));
      content.push(group(t("BIVOUAC.Config.MeterLabel"),
        `<input type="text" name="meterLabel" value="${esc(m.label)}" placeholder="${esc(t("BIVOUAC.Config.MeterLabelPlaceholder"))}">`));
      const curMeterFont = m.labelFont;
      const meterFontOpts = [`<option value=""${curMeterFont === "" ? " selected" : ""}>${esc(t("BIVOUAC.Config.NoteFontDefault"))}</option>`]
        .concat(availableFonts().map((f) => `<option value="${esc(f)}"${curMeterFont === f ? " selected" : ""}>${esc(f)}</option>`))
        .join("");
      content.push(group(t("BIVOUAC.Config.MeterLabelFont"), `<select name="meterLabelFont">${meterFontOpts}</select>`));
      content.push(group(t("BIVOUAC.Config.MeterLabelFontCustom"),
        `<input type="text" name="meterLabelFontCustom" value="${esc(m.labelFontCustom)}" placeholder="${esc(t("BIVOUAC.Config.NoteFontCustomPlaceholder"))}">` +
          `<p class="bivouac-config__hint">${esc(t("BIVOUAC.Config.NoteFontHint"))}</p>`));
      content.push(group(t("BIVOUAC.Config.MeterLabelColor"),
        `<label class="bivouac-config__inline"><input type="checkbox" name="meterLabelColorOn"${m.labelColor ? " checked" : ""}> ${esc(t("BIVOUAC.Config.TextColorCustom"))}</label>` +
          `<input type="color" name="meterLabelColor" value="${esc(m.labelColor || "#ffffff")}">`));
      content.push(group(t("BIVOUAC.Config.MeterLabelSize"),
        `<input type="number" name="meterLabelScale" value="${esc(m.labelScale)}" min="0.3" max="3" step="0.1">`));
      content.push(group(t("BIVOUAC.Config.MeterNumberColor"),
        `<label class="bivouac-config__inline"><input type="checkbox" name="meterNumColorOn"${m.numberColor ? " checked" : ""}> ${esc(t("BIVOUAC.Config.TextColorCustom"))}</label>` +
          `<input type="color" name="meterNumColor" value="${esc(m.numberColor || "#ffffff")}">`));
      content.push(group(t("BIVOUAC.Config.MeterNumberSize"),
        `<input type="number" name="meterNumScale" value="${esc(m.numberScale)}" min="0.3" max="3" step="0.1">` +
          `<p class="bivouac-config__hint">${esc(t("BIVOUAC.Config.MeterTextHint"))}</p>`));
      content.push(group(t("BIVOUAC.Config.MeterMin"),
        `<input type="number" name="meterMin" value="${esc(m.min)}" step="any" title="${esc(t("BIVOUAC.Config.MeterRangeHint"))}">`));
      content.push(group(t("BIVOUAC.Config.MeterMax"),
        `<input type="number" name="meterMax" value="${esc(m.max)}" step="any" title="${esc(t("BIVOUAC.Config.MeterRangeHint"))}">`));
      content.push(group(t("BIVOUAC.Config.MeterValue"),
        `<input type="number" name="meterValue" value="${esc(m.value)}" step="any">`));
      content.push(group(t("BIVOUAC.Config.MeterStep"),
        `<input type="number" name="meterStep" value="${esc(m.step)}" min="0" step="any" title="${esc(t("BIVOUAC.Config.MeterStepHint"))}">`));
      content.push(group(t("BIVOUAC.Config.MeterIcon"),
        `<input type="text" name="meterIcon" list="bivouac-meter-icons" value="${esc(m.icon)}" placeholder="${esc(t("BIVOUAC.Config.MeterIconPlaceholder"))}">` +
          `<datalist id="bivouac-meter-icons">${METER_ICONS.map((i) => `<option value="${esc(i)}">`).join("")}</datalist>` +
          `<p class="bivouac-config__hint">${esc(t("BIVOUAC.Config.MeterIconHint"))}</p>`));
      content.push(group(t("BIVOUAC.Config.MeterColor"), `<input type="color" name="meterColor" value="${esc(m.color)}">`));
      content.push(group(t("BIVOUAC.Config.MeterTrack"), `<input type="color" name="meterTrack" value="${esc(m.trackColor)}">`));
      content.push(group(t("BIVOUAC.Config.MeterShowValue"),
        `<input type="checkbox" name="meterShowValue"${m.showValue ? " checked" : ""}>`));
      content.push(group(t("BIVOUAC.Config.MeterRole"),
        `<select name="meterEditRole">${roleOptions(widget.config.editRole)}</select>` +
          `<p class="bivouac-config__hint">${esc(t("BIVOUAC.Config.MeterHint"))}</p>`));
      break;
    }
    case "actor":
      content.push(group(t("BIVOUAC.Config.LinkedDoc"),
        `<input type="text" name="uuid" value="${esc(widget.config.uuid ?? "")}" placeholder="${esc(t("BIVOUAC.Config.LinkedDocPlaceholder"))}">` +
          `<p class="bivouac-config__hint">${esc(t("BIVOUAC.Config.LinkedDocHint"))}</p>`));
      break;
    case "table":
      content.push(group(t("BIVOUAC.Config.LinkedDoc"),
        `<input type="text" name="uuid" value="${esc(widget.config.uuid ?? "")}" placeholder="${esc(t("BIVOUAC.Config.LinkedDocPlaceholder"))}">`));
      content.push(group(t("BIVOUAC.Config.TableTextSize"),
        `<input type="number" name="tableTextScale" value="${esc(Number(widget.config.textScale) || 1)}" min="0.4" max="3" step="0.1">`));
      break;
    case "macro": {
      content.push(group(t("BIVOUAC.Config.LinkedDoc"),
        `<input type="text" name="uuid" value="${esc(widget.config.uuid ?? "")}" placeholder="${esc(t("BIVOUAC.Config.LinkedDocPlaceholder"))}">`));
      const showIcon = widget.config.showIcon !== false;
      const showTitle = widget.config.showTitle !== false;
      content.push(group(t("BIVOUAC.Config.MacroShowIcon"),
        `<input type="checkbox" name="macroShowIcon"${showIcon ? " checked" : ""}>`));
      content.push(group(t("BIVOUAC.Config.MacroIconSize"),
        `<input type="number" name="macroIconSize" value="${esc(Number(widget.config.iconSize) || 48)}" min="16" max="256" step="1">`));
      content.push(group(t("BIVOUAC.Config.MacroShowTitle"),
        `<input type="checkbox" name="macroShowTitle"${showTitle ? " checked" : ""}>`));
      content.push(group(t("BIVOUAC.Config.MacroTitleSize"),
        `<input type="number" name="macroTitleSize" value="${esc(Number(widget.config.titleSize) || 14)}" min="8" max="48" step="1">`));
      break;
    }
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
      const showAll = widget.config.showToAll === true;
      content.push(group(t("BIVOUAC.Config.CardsShowAll"),
        `<label class="bivouac-config__inline"><input type="checkbox" name="cardsShowAll"${showAll ? " checked" : ""}> ${esc(t("BIVOUAC.Config.CardsShowAllLabel"))}</label>`));
      const curCardFont = String(widget.config.nameFont ?? "");
      const cardFontOpts = [`<option value=""${curCardFont === "" ? " selected" : ""}>${esc(t("BIVOUAC.Config.NoteFontDefault"))}</option>`]
        .concat(availableFonts().map((f) => `<option value="${esc(f)}"${curCardFont === f ? " selected" : ""}>${esc(f)}</option>`))
        .join("");
      content.push(group(t("BIVOUAC.Config.CardsNameFont"), `<select name="cardsNameFont">${cardFontOpts}</select>`));
      content.push(group(t("BIVOUAC.Config.CardsNameSize"),
        `<input type="number" name="cardsNameSize" value="${esc(Number(widget.config.nameSize) || 12)}" min="6" max="48" step="1">`));
      content.push(group(t("BIVOUAC.Config.CardsRole"),
        `<select name="cardsEditRole">${roleOptions(widget.config.editRole)}</select>` +
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

  // Optional per-tile text colour (text tiles only; the field is absent otherwise).
  updated.config.textColor =
    data.textColorOn === "on" && /^#[0-9a-fA-F]{6}$/.test(data.textColor ?? "") ? data.textColor : "";

  // Per-tile text-stroke override; "" = follow the world setting.
  updated.config.textStroke = data.textStroke === "on" || data.textStroke === "off" ? data.textStroke : "";

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
    case "meter": {
      const numOr = (raw: string | undefined, dflt: number): number => {
        const n = Number(raw);
        return Number.isFinite(n) ? n : dflt;
      };
      updated.config.meterKind = (METER_KINDS as readonly string[]).includes(data.meterKind) ? data.meterKind : "bar";
      updated.config.label = data.meterLabel?.trim() ?? "";
      updated.config.min = numOr(data.meterMin, 0);
      updated.config.max = numOr(data.meterMax, 10);
      updated.config.value = numOr(data.meterValue, 0);
      updated.config.step = Math.max(0, numOr(data.meterStep, 1));
      // Class list only — `readMeter` strips anything that isn't class-safe.
      updated.config.icon = data.meterIcon?.trim() ?? "";
      updated.config.labelFont = typeof data.meterLabelFont === "string" ? data.meterLabelFont : "";
      updated.config.labelFontCustom = (data.meterLabelFontCustom ?? "").trim();
      const hexIf = (on: string | undefined, value: string | undefined): string =>
        on === "on" && /^#[0-9a-fA-F]{6}$/.test(value ?? "") ? (value as string) : "";
      updated.config.labelColor = hexIf(data.meterLabelColorOn, data.meterLabelColor);
      updated.config.numberColor = hexIf(data.meterNumColorOn, data.meterNumColor);
      updated.config.labelScale = Math.min(3, Math.max(0.3, numOr(data.meterLabelScale, 1)));
      updated.config.numberScale = Math.min(3, Math.max(0.3, numOr(data.meterNumScale, 1)));
      updated.config.color = /^#[0-9a-fA-F]{6}$/.test(data.meterColor ?? "") ? data.meterColor : "#d98b3a";
      updated.config.trackColor = /^#[0-9a-fA-F]{6}$/.test(data.meterTrack ?? "") ? data.meterTrack : "#101219";
      updated.config.showValue = data.meterShowValue === "on";
      const mr = Number(data.meterEditRole);
      updated.config.editRole = Number.isFinite(mr) ? Math.min(4, Math.max(0, mr)) : 0;
      // Range/step are sanitised on read, so re-snap the stored value now — the
      // tile never shows a number the meter itself couldn't land on.
      updated.config.value = readMeter(updated.config).value;
      break;
    }
    case "actor":
      updated.config.uuid = data.uuid?.trim() ?? "";
      break;
    case "table": {
      updated.config.uuid = data.uuid?.trim() ?? "";
      const ts = Number(data.tableTextScale);
      updated.config.textScale = Number.isFinite(ts) ? Math.min(3, Math.max(0.4, ts)) : 1;
      break;
    }
    case "macro": {
      updated.config.uuid = data.uuid?.trim() ?? "";
      updated.config.showIcon = data.macroShowIcon === "on";
      updated.config.showTitle = data.macroShowTitle === "on";
      const is = Number(data.macroIconSize);
      updated.config.iconSize = Number.isFinite(is) ? Math.min(256, Math.max(16, is)) : 48;
      const ts = Number(data.macroTitleSize);
      updated.config.titleSize = Number.isFinite(ts) ? Math.min(48, Math.max(8, ts)) : 14;
      break;
    }
    case "journal":
      updated.config.uuid = data.uuid?.trim() ?? "";
      updated.config.journalMode = data.journalMode === "link" ? "link" : "inline";
      break;
    case "cards": {
      updated.config.layout = ["fan", "row", "grid"].includes(data.cardsLayout) ? data.cardsLayout : "fan";
      updated.config.art = data.cardsArt === "token" ? "token" : "portrait";
      updated.config.showNames = data.cardsShowNames === "on";
      updated.config.showToAll = data.cardsShowAll === "on";
      updated.config.nameFont = typeof data.cardsNameFont === "string" ? data.cardsNameFont : "";
      const ns = Number(data.cardsNameSize);
      updated.config.nameSize = Number.isFinite(ns) ? Math.min(48, Math.max(6, ns)) : 12;
      const er = Number(data.cardsEditRole);
      updated.config.editRole = Number.isFinite(er) ? Math.min(4, Math.max(0, er)) : 0;
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
