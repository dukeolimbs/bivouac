/**
 * Bivouac — Settings window presentation.
 *
 * Foundry lists every `config: true` setting of a namespace as one flat run of
 * `.form-group` rows, ordered by registration. With ~20 settings (most of them
 * Cast Bar) that reads as a wall of sliders, so on render we regroup those rows
 * into labelled `<fieldset>` sections and flag the world-scoped ones.
 *
 * Everything here is cosmetic: the rows are the *same* elements Foundry built,
 * only moved, so submit, "Reset Defaults" and the search filter keep working.
 */

import { MODULE_ID, SETTINGS, log } from "./constants";
import { activeAdapter } from "./systems";

/** A titled section of the module's settings, in display order. */
type SettingGroup = {
  /** i18n key for the section heading. */
  label: string;
  /** Setting keys shown in the section, in order. Missing ones are skipped. */
  keys: readonly string[];
};

/**
 * The sections, top to bottom. A setting listed here is placed in that section;
 * a *new* setting that is registered but not listed keeps its own place in the
 * flat list, outside the sections — a visible nudge to add it here too.
 */
export function settingGroups(): readonly SettingGroup[] {
  return [
    {
      label: "BIVOUAC.Settings.Groups.Appearance",
      keys: [SETTINGS.textStroke, SETTINGS.textStrokeWidth],
    },
    {
      label: "BIVOUAC.Settings.Groups.Landing",
      keys: [
        SETTINGS.controlRole,
        SETTINGS.maxWidgetSize,
        SETTINGS.lodMinWebviews,
      ],
    },
    {
      label: "BIVOUAC.Settings.Groups.DmScreen",
      keys: [SETTINGS.dmDock, SETTINGS.dmTabTop, SETTINGS.dmTabPad],
    },
    {
      label: "BIVOUAC.Settings.Groups.CastBar",
      keys: [
        SETTINGS.castBarDock,
        SETTINGS.castBar2Dock,
        SETTINGS.castBarSize,
        SETTINGS.castPlateShape,
        SETTINGS.castHideInCombat,
        SETTINGS.castDoubleClickMs,
        SETTINGS.castBarTabPos,
        SETTINGS.castBarTabPad,
      ],
    },
    {
      label: "BIVOUAC.Settings.Groups.CastBarText",
      keys: [
        SETTINGS.castBarFont,
        SETTINGS.castBarFontCustom,
        SETTINGS.castBarFontSize,
      ],
    },
    {
      label: "BIVOUAC.Settings.Groups.CastBarStats",
      // Driven by the ACTIVE system adapter, not a fixed dnd5e four — under
      // Daggerheart these are Hit Points / Stress / Hope / Evasion / Armor. This
      // is why the groups are a function rather than a const: the list can only
      // be built once `game.settings` exists, not at module load.
      keys: [
        SETTINGS.castSystem,
        ...activeAdapter().stats.map((s) => s.setting),
      ],
    },
  ];
}

/** Watches the rows Foundry's search filter hides, so empty sections hide too.
 *  Held module-wide so a re-render / close can drop the previous one. */
let searchObserver: MutationObserver | null = null;

/** The `.form-group` row Foundry rendered for one of our settings, if present.
 *  World-scoped rows are absent for non-GMs, and every row is absent before the
 *  module's category has rendered. */
function rowFor(root: HTMLElement, key: string): HTMLElement | null {
  const field = root.querySelector(`[name="${MODULE_ID}.${key}"]`);
  return (field?.closest(".form-group") as HTMLElement | null) ?? null;
}

/** Tag a row that is world-scoped — one GM sets it for the whole table. Client
 *  rows are left unmarked: "no badge" reads as "just my screen". */
function markWorldScope(row: HTMLElement, key: string): void {
  const setting = game.settings.settings.get(`${MODULE_ID}.${key}`) as
    { scope?: string } | undefined;
  if (setting?.scope !== "world") return;

  // Foundry renders the row's caption as either a <label> or a <span class="label">.
  const label = row.querySelector(":scope > label, :scope > span.label");
  if (!label || label.querySelector(".bivouac-scope")) return;

  const badge = document.createElement("span");
  badge.className = "bivouac-scope";
  badge.textContent = game.i18n.localize("BIVOUAC.Settings.WorldBadge");
  badge.dataset.tooltip = game.i18n.localize("BIVOUAC.Settings.WorldBadgeHint");
  label.append(badge);
}

/** Hide a section whose every row has been filtered out by the search box —
 *  otherwise a search match in one section leaves the others as bare headings.
 *  Only writes on an actual change, so it can't re-trigger its own observer. */
function syncSectionVisibility(container: HTMLElement): void {
  for (const section of container.querySelectorAll<HTMLElement>(
    "fieldset.bivouac-settings-group",
  )) {
    const anyVisible = Array.from(
      section.querySelectorAll<HTMLElement>(".form-group"),
    ).some((row) => !row.hidden);
    if (section.hidden === anyVisible) section.hidden = !anyVisible;
  }
}

/**
 * Regroup this module's settings rows into labelled sections. Safe to call on
 * every `renderSettingsConfig` — it no-ops once the sections exist.
 */
export function decorateSettingsForm(root: HTMLElement): void {
  if (root.querySelector(".bivouac-settings-group")) return; // already done this render

  // Resolve every section's rows first: nothing moves until we know where the
  // block of sections should land.
  const planned: { label: string; rows: HTMLElement[] }[] = [];
  for (const group of settingGroups()) {
    const rows: HTMLElement[] = [];
    for (const key of group.keys) {
      const row = rowFor(root, key);
      if (!row) continue; // not rendered (e.g. a world setting seen by a player)
      markWorldScope(row, key);
      rows.push(row);
    }
    if (rows.length) planned.push({ label: group.label, rows }); // else: GM-only section, and we're a player
  }
  if (!planned.length) return; // our category isn't in this render pass

  // Anchor the block of sections where our first row already sits, then fill it
  // in the order declared above rather than the order the settings happen to be
  // registered in (so the two can't silently drift apart).
  const first = planned
    .flatMap((p) => p.rows)
    .reduce((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? b : a,
    );
  const container = first.parentElement;
  if (!container) return;
  const anchor = document.createComment("bivouac-settings");
  first.before(anchor);

  for (const { label, rows } of planned) {
    const section = document.createElement("fieldset");
    section.className = "bivouac-settings-group";
    const legend = document.createElement("legend");
    legend.textContent = game.i18n.localize(label);
    section.append(legend, ...rows); // moves the rows out of the flat list
    anchor.before(section);
  }
  anchor.remove();
  log("Grouped settings window");

  // Foundry's search hides rows by toggling `hidden`; follow it so the headings
  // of fully-filtered sections disappear with their contents.
  searchObserver?.disconnect();
  searchObserver = new MutationObserver(() => syncSectionVisibility(container));
  searchObserver.observe(container, {
    attributes: true,
    attributeFilter: ["hidden"],
    subtree: true,
  });
}

/** Drop the search observer when the Settings window closes (it would otherwise
 *  keep the detached form alive). */
export function teardownSettingsForm(): void {
  searchObserver?.disconnect();
  searchObserver = null;
}
