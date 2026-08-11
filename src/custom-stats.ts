/**
 * Bivouac — GM-defined stat rows.
 *
 * The built-in adapters (`systems.ts`) cover the systems we ship support for, and
 * `generic` shows nothing at all. This lets a GM point a stat row at any path
 * under an actor's `system` data, which turns "we support two systems" into "we
 * support whatever you point us at" — with no code per system.
 *
 * Rows are appended to the active adapter's own stats, so every consumer picks
 * them up for free: the per-stat toggle loop at `init`, the settings window
 * grouping, the Cast Bar plate overlay and the Mini Sheet all read
 * `activeAdapter().stats`. Under `generic` (whose list is empty) custom rows are
 * simply the only source, which is exactly what an unsupported system wants.
 */

import { MODULE_ID, SETTINGS } from "./constants";

/** One GM-defined row. Stored as a plain array in a `config: false` world setting. */
export interface CustomStatRow {
  /** Stable id, generated on creation. Keys this row's own toggle setting, so
   *  reordering or renaming a row never silently re-points an existing toggle at
   *  a different stat. */
  id: string;
  /** Shown as the row's tooltip and as its toggle's label in Settings. A literal,
   *  not an i18n key — the GM typed it. */
  name: string;
  /** Font Awesome class, e.g. `fa-wand-sparkles`. */
  icon: string;
  /** Dotted path UNDER `system`, e.g. `attributes.spelldc`. */
  path: string;
  /** Optional second path, rendered as `value/max`. */
  maxPath: string;
  /** A higher number is worse (the flag Daggerheart's marked-damage pools need). */
  reverse: boolean;
}

/** Toggle setting key for a row. Prefixed so it can never collide with a
 *  built-in adapter's hand-written `castStat…` keys. */
export function customStatSetting(id: string): string {
  return `castStatCustom_${id}`;
}

/** Only `[a-z0-9]` ids are generated, so the setting key is always a safe
 *  identifier and a stored file can't inject something odd into a key. */
function safeId(v: unknown): string {
  return String(v ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 24);
}

export function newRowId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`.replace(/[^a-z0-9]/gi, "");
}

/** Read + sanitise the stored rows. Everything here is `unknown` at runtime — the
 *  setting is world data that a GM (or a bad import) can put anything into — so a
 *  malformed row is dropped rather than allowed to throw during `init`, which
 *  would take the whole module down with it. */
export function customStatRows(): CustomStatRow[] {
  let raw: unknown;
  try {
    raw = game.settings.get(MODULE_ID, SETTINGS.customStats);
  } catch {
    return []; // not registered yet (called before init completes)
  }
  if (!Array.isArray(raw)) return [];
  const out: CustomStatRow[] = [];
  const seen = new Set<string>();
  for (const r of raw as Record<string, unknown>[]) {
    const id = safeId(r?.id);
    const path = String(r?.path ?? "").trim();
    // A row with no id or no path can't be toggled or read, so it isn't a row.
    if (!id || !path || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: String(r?.name ?? "").trim() || path,
      icon: String(r?.icon ?? "").trim() || "fa-circle-dot",
      path,
      maxPath: String(r?.maxPath ?? "").trim(),
      reverse: !!r?.reverse,
    });
  }
  return out;
}

/** Resolve a dotted path against a document's `system` data, exactly as the
 *  built-in adapters do — returning a finite number or null so a row that doesn't
 *  apply to this actor is skipped rather than shown as a zero. */
export function readCustomPath(doc: Record<string, unknown>, path: string): number | null {
  const start = (doc.system ?? {}) as unknown;
  const v = path
    .split(".")
    .reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), start);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* ------------------------------------------------------------- the editor -- */

function t(key: string): string {
  return game.i18n.localize(key);
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The actor to validate paths against: whatever the GM has selected, else their
 *  own character. Live validation is the thing that makes typing
 *  `attributes.spelldc` survivable for a non-technical GM — "resolves to 14" vs
 *  "no value" is the whole difference between this being usable and being a
 *  guessing game. */
function probeActor(): Record<string, unknown> | null {
  const selected = canvas?.tokens?.controlled?.[0]?.actor;
  return (selected ?? game.user?.character ?? null) as Record<string, unknown> | null;
}

function rowHtml(r: CustomStatRow): string {
  return `<div class="bivouac-cstat" data-id="${esc(r.id)}">
    <input type="text" data-f="name" value="${esc(r.name)}" placeholder="${esc(t("BIVOUAC.CustomStats.Name"))}">
    <input type="text" data-f="icon" value="${esc(r.icon)}" placeholder="fa-circle-dot" list="bivouac-cstat-icons">
    <input type="text" data-f="path" value="${esc(r.path)}" placeholder="attributes.spelldc">
    <input type="text" data-f="maxPath" value="${esc(r.maxPath)}" placeholder="${esc(t("BIVOUAC.CustomStats.MaxPath"))}">
    <label class="bivouac-cstat__rev" data-tooltip="${esc(t("BIVOUAC.CustomStats.ReverseHint"))}">
      <input type="checkbox" data-f="reverse" ${r.reverse ? "checked" : ""}> ${esc(t("BIVOUAC.CustomStats.Reverse"))}
    </label>
    <span class="bivouac-cstat__probe" data-probe></span>
    <button type="button" class="bivouac-cstat__del" data-del title="${esc(t("BIVOUAC.CustomStats.Delete"))}">
      <i class="fa-solid fa-trash"></i>
    </button>
  </div>`;
}

/** A handful of glyphs that suit a stat row, offered through a `<datalist>` so
 *  the field stays free text (any Font Awesome class works) while still being
 *  pickable — the same trade the meter's centre-icon field makes. */
const ICON_SUGGESTIONS = [
  "fa-shield-halved", "fa-heart", "fa-eye", "fa-mask", "fa-bolt", "fa-star",
  "fa-wand-sparkles", "fa-hand-fist", "fa-brain", "fa-person-running",
  "fa-gauge-high", "fa-droplet", "fa-fire", "fa-snowflake", "fa-skull", "fa-dice-d20",
];

function editorHtml(rows: CustomStatRow[]): string {
  const probe = probeActor();
  return `<div class="bivouac-config bivouac-cstats">
    <p class="bivouac-config__hint">${esc(t("BIVOUAC.CustomStats.Hint"))}</p>
    <p class="bivouac-config__hint">${esc(
      probe ? game.i18n.format("BIVOUAC.CustomStats.Probing", { name: String(probe.name ?? "") }) : t("BIVOUAC.CustomStats.NoProbe"),
    )}</p>
    <datalist id="bivouac-cstat-icons">${ICON_SUGGESTIONS.map((i) => `<option value="${i}">`).join("")}</datalist>
    <div class="bivouac-cstats__head">
      <span>${esc(t("BIVOUAC.CustomStats.Name"))}</span>
      <span>${esc(t("BIVOUAC.CustomStats.Icon"))}</span>
      <span>${esc(t("BIVOUAC.CustomStats.Path"))}</span>
      <span>${esc(t("BIVOUAC.CustomStats.MaxPath"))}</span>
      <span></span><span></span><span></span>
    </div>
    <div class="bivouac-cstats__rows">${rows.map(rowHtml).join("")}</div>
    <button type="button" class="bivouac-cstats__add" data-add>
      <i class="fa-solid fa-plus"></i> ${esc(t("BIVOUAC.CustomStats.Add"))}
    </button>
  </div>`;
}

/** Read the form back into rows, dropping any with no path (an empty row the GM
 *  added and then thought better of). */
function readEditor(form: HTMLElement): CustomStatRow[] {
  const out: CustomStatRow[] = [];
  for (const el of form.querySelectorAll<HTMLElement>(".bivouac-cstat")) {
    const get = (f: string): HTMLInputElement | null => el.querySelector(`[data-f="${f}"]`);
    const path = get("path")?.value.trim() ?? "";
    if (!path) continue;
    out.push({
      id: el.dataset.id || newRowId(),
      name: get("name")?.value.trim() || path,
      icon: get("icon")?.value.trim() || "fa-circle-dot",
      path,
      maxPath: get("maxPath")?.value.trim() ?? "",
      reverse: !!get("reverse")?.checked,
    });
  }
  return out;
}

/** Live "does this path resolve?" feedback for every row. */
function refreshProbes(form: HTMLElement): void {
  const actor = probeActor();
  for (const el of form.querySelectorAll<HTMLElement>(".bivouac-cstat")) {
    const out = el.querySelector<HTMLElement>("[data-probe]");
    if (!out) continue;
    const path = el.querySelector<HTMLInputElement>('[data-f="path"]')?.value.trim() ?? "";
    if (!actor || !path) {
      out.textContent = "";
      out.className = "bivouac-cstat__probe";
      continue;
    }
    const v = readCustomPath(actor, path);
    const maxPath = el.querySelector<HTMLInputElement>('[data-f="maxPath"]')?.value.trim() ?? "";
    const max = maxPath ? readCustomPath(actor, maxPath) : null;
    out.textContent = v == null ? t("BIVOUAC.CustomStats.NoValue") : max == null ? `= ${v}` : `= ${v}/${max}`;
    out.className = `bivouac-cstat__probe${v == null ? " bivouac-cstat__probe--bad" : " bivouac-cstat__probe--ok"}`;
  }
}

/** Wire add / delete / live validation once the dialog has rendered. Registered
 *  as its own `renderDialogV2` listener, scoped by our own root class so it can
 *  never touch the tile-config dialog (or another module's). */
let editorHookReady = false;
function ensureEditorHook(): void {
  if (editorHookReady) return;
  editorHookReady = true;
  Hooks.on("renderDialogV2", (_app: unknown, html: unknown) => {
    const root = html instanceof HTMLElement ? html : (html as { [0]?: HTMLElement } | null)?.[0];
    const form = root?.querySelector?.(".bivouac-cstats") as HTMLElement | null;
    if (!form) return;
    const rows = form.querySelector(".bivouac-cstats__rows");
    form.querySelector("[data-add]")?.addEventListener("click", () => {
      rows?.insertAdjacentHTML("beforeend", rowHtml({ id: newRowId(), name: "", icon: "", path: "", maxPath: "", reverse: false }));
      refreshProbes(form);
    });
    form.addEventListener("click", (e) => {
      const del = (e.target as HTMLElement | null)?.closest("[data-del]");
      if (del) del.closest(".bivouac-cstat")?.remove();
    });
    form.addEventListener("input", () => refreshProbes(form));
    refreshProbes(form);
  });
}

/** Open the row editor. Rows are registered as settings at `init`, so a change
 *  needs a reload to take effect — offered rather than silently required. */
export async function openCustomStatsEditor(): Promise<void> {
  ensureEditorHook();
  const before = JSON.stringify(customStatRows());
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("BIVOUAC.CustomStats.Title"), icon: "fa-solid fa-sliders", resizable: true },
    classes: ["bivouac-dialog"],
    position: { width: 760 },
    content: editorHtml(customStatRows()),
    ok: {
      label: t("BIVOUAC.Edit.Save"),
      icon: "fa-solid fa-check",
      callback: (_e: Event, button: { form: HTMLFormElement }) => readEditor(button.form),
    },
    rejectClose: false,
  });
  if (!result) return;
  await game.settings.set(MODULE_ID, SETTINGS.customStats, result);
  if (JSON.stringify(result) === before) return;
  // Each row's on/off toggle is registered during `init` from this list, so a new
  // or removed row can't appear in the Settings window until the world reloads.
  const cfg = (foundry as { applications?: { settings?: { SettingsConfig?: { reloadConfirm?: (o: object) => unknown } } } })
    ?.applications?.settings?.SettingsConfig;
  if (typeof cfg?.reloadConfirm === "function") void cfg.reloadConfirm({ world: true });
  else ui.notifications?.info(t("BIVOUAC.CustomStats.ReloadNeeded"));
}
