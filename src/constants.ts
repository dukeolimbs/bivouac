/** Bivouac — shared constants and data model. */

export const MODULE_ID = "bivouac";

/** Flag / setting keys, namespaced under the module. */
export const FLAGS = {
  /** Landing layout stored on a Scene. */
  layout: "layout",
  /** DM screen layout stored per-GM on the User document. */
  dmScreenLayout: "dmScreenLayout",
  /** Cast Bar roster + speaker + visibility, stored per Scene (broadcast to all). */
  castBar: "castBar",
  /** Second Cast Bar's roster (a separate strip — e.g. party vs NPCs), per Scene. */
  castBar2: "castBar2",
  /** Per-Actor: remembered "name hidden from players" default for the Cast Bar,
   *  so re-adding an actor reuses the last choice instead of defaulting to hidden. */
  castNameHidden: "castNameHidden",
} as const;

export const SETTINGS = {
  /** World setting (legacy, single): the id of the Scene designated as the
   *  landing page. Migrated into `landingSceneIds` on ready. */
  landingSceneId: "landingSceneId",
  /** World setting: ids of all Scenes designated as landing pages. */
  landingSceneIds: "landingSceneIds",
  /** Client setting: px the DM-screen tab keeps left of the sidebar edge. */
  dmTabPad: "dmTabPad",
  /** Client setting: vertical position of the DM-screen tab, as a % of height. */
  dmTabTop: "dmTabTop",
  /** World setting: max widget size in grid squares (resize cap). */
  maxWidgetSize: "maxWidgetSize",
  /** Client setting: DM-screen drawer width in px (left/right dock; drag-set). */
  dmDrawerWidth: "dmDrawerWidth",
  /** Client setting: DM-screen drawer height in px (top/bottom dock; drag-set). */
  dmDrawerHeight: "dmDrawerHeight",
  /** Client setting: how many web views may be live before LOD can kick in. */
  lodMinWebviews: "lodMinWebviews",
  /** Client setting: DM-screen dock mode — "beside" the sidebar or "over" it. */
  dmDock: "dmDock",
  /** World setting: minimum user role that can control tiles/cards (role number). */
  controlRole: "controlRole",
  /** Client setting: which edge the Cast Bar docks to (bottom/top/left/right). */
  castBarDock: "castBarDock",
  /** Client setting: position of the Cast Bar toggle tab along its edge (%). */
  castBarTabPos: "castBarTabPos",
  /** Client setting: horizontal pad the right-dock Cast Bar tab keeps from the sidebar. */
  castBarTabPad: "castBarTabPad",
  /** World setting: the second Cast Bar's edge — "off" (disabled) or a dock position. */
  castBar2Dock: "castBar2Dock",
  /** Client setting: Cast Bar cross-axis size in px (drag-set; player-resizable). */
  castBarSize: "castBarSize",
  /** World settings: enable each Cast Bar stat globally (AC / perception / HP / investigation). */
  castStatAC: "castStatAC",
  castStatPP: "castStatPP",
  castStatHP: "castStatHP",
  castStatInv: "castStatInv",
  /** Client settings: per-bar quick scale multiplier (hover +/-, 0.25–1.5 of size). */
  castBarScale: "castBarScale",
  castBar2Scale: "castBar2Scale",
  /** World setting: hide the Cast Bar(s) while a combat encounter is running. */
  castHideInCombat: "castHideInCombat",
  /** Client settings: Cast Bar font — a Foundry font pick + a custom Google Font. */
  castBarFont: "castBarFont",
  castBarFontCustom: "castBarFontCustom",
  /** Client setting: Cast Bar name font-size multiplier (slider). */
  castBarFontSize: "castBarFontSize",
} as const;

/** May the current user control Bivouac tiles/cards (add / remove / reorder /
 *  drop-to-tile)? Gated by the `controlRole` world setting (default GM). NB: this
 *  is a UI gate — persisting board changes still requires Foundry permission
 *  (scene ownership for non-GMs). */
export function canControl(): boolean {
  try {
    const min = Number(game.settings.get(MODULE_ID, SETTINGS.controlRole));
    const role = Number(game.user?.role ?? 0);
    return role >= (Number.isFinite(min) ? min : 4);
  } catch {
    return !!game.user?.isGM;
  }
}

/** May the current user arrange a specific card collection (add / remove /
 *  reorder / drag its cards)? Uses the tile's own `config.editRole` (minimum
 *  role, 1–4) when set, else inherits the global `canControl()`. */
export function cardsCanControl(config: Record<string, unknown>): boolean {
  const per = Number((config as { editRole?: unknown }).editRole);
  if (Number.isFinite(per) && per >= 1) return Number(game.user?.role ?? 0) >= per;
  return canControl();
}

/** Widget geometry, measured in whole scene grid squares. */
export interface WidgetCell {
  gx: number;
  gy: number;
  gw: number;
  gh: number;
}

/** Tile type key. Open (any string) so tiles register via the registry without
 *  editing this file — including dropped-document tiles and future third-party
 *  types. Known built-ins: webview · image · note · actor · journal · table ·
 *  macro (+ planned: scene · playlist · meter · cards · party · combat · rules). */
export type WidgetType = string;
export type WidgetScope = "shared" | "dm";
/** Legacy single "chrome" axis — migrated to separate `frame` + `background`
 *  (stored in `config`); kept for reading old layouts. */
export type WidgetChrome = "none" | "subtle" | "framed";
/** Border/edge style (config.frame). */
export type WidgetFrame = "none" | "subtle" | "framed";
/** Fill style (config.background). */
export type WidgetBackground = "none" | "solid" | "frosted" | "gradient" | "image";

export interface WidgetInteraction {
  trigger: "click" | "dblclick";
  action: "openSheet" | "openJournal" | "runMacro" | "none";
  /** A document UUID or macro UUID, depending on the action. */
  uuid?: string;
}

export interface Widget {
  id: string;
  type: WidgetType;
  cell: WidgetCell;
  scope: WidgetScope;
  title?: string;
  chrome: WidgetChrome;
  interactions: WidgetInteraction[];
  /** Type-specific configuration. */
  config: Record<string, unknown>;
}

export interface Layout {
  widgets: Widget[];
}

/* -------------------------------------------- Cast Bar ------------------ */
// A dedicated, docked strip of character Plates for narrative encounters — its
// own tool, NOT part of the Widget/Tile system above. Portrait + name, with
// per-plate conversation states. State lives on the Scene flag so it broadcasts
// to players (GM-authored). See docs/cast-bar-design-spec.md.

/** One character Plate: references an Actor (or Item) by UUID + its states. */
export interface Plate {
  id: string;
  /** The referenced document (usually an Actor). */
  uuid: string;
  /** Which of the document's own images to use: "profile" (default) or "token". */
  art?: "profile" | "token";
  /** Optional custom image, overriding `art` and the document's own art. */
  img?: string;
  /** Darkened: physically in the scene but not in this conversation. */
  exited: boolean;
  /** GM-only: filtered out of the players' view entirely (like a hidden token). */
  hidden: boolean;
  /** Players see "?" instead of the name; the GM sees the real name greyed. */
  nameHidden: boolean;
  /** Show the Actor's stat overlay (AC / passive perception / HP / investigation)
   *  on this plate. Off by default; toggled per-plate from the hover controls. */
  stats?: boolean;
}

/** Cast Bar state for one Scene. */
export interface CastBarData {
  /** GM global show/hide, for everyone. */
  visible: boolean;
  /** The current speaker's plate id (green highlight); null = nobody. */
  speakerId: string | null;
  plates: Plate[];
}

export const EMPTY_CASTBAR: CastBarData = { visible: false, speakerId: null, plates: [] };

export const GRID = {
  /** Default size of a freshly-added widget, in squares. */
  defaultSize: 2,
  /** Clamp for widget dimensions, in squares. `max` is the default cap; the GM
   *  can override it via the `maxWidgetSize` setting. */
  min: 1,
  max: 40,
  /** Visual gap between a widget and its cell edge, as a fraction of one grid
   *  square, applied on every side. Scales with zoom and grid size, so adjacent
   *  widgets keep breathing room. Layout/snapping still use whole cells. */
  gap: 0.05,
} as const;

/** Level-of-detail: only degrade web views to placeholders when the board is
 *  busy AND zoomed way out, so most of the time they stay live. */
export const LOD = {
  /** Minimum number of web views present before LOD is considered at all. */
  minWebviews: 6,
  /** …and only when the canvas is zoomed out below this scale. */
  farScale: 0.3,
} as const;

/** Web-view rendering. The iframe is rendered at a logical resolution derived
 *  from the widget's square count and scaled to fit, so content magnification
 *  is consistent regardless of a widget's pixel size (a 2×5 reads like a 20×50). */
export const WEBVIEW = {
  /** Logical iframe pixels per grid square. Higher → more page shown, smaller content. */
  logicalPerSquare: 160,
} as const;

export const EMPTY_LAYOUT: Layout = { widgets: [] };

/** Prefix a console message with the module tag. */
export function log(...args: unknown[]): void {
  console.log(`${MODULE_ID} |`, ...args);
}
