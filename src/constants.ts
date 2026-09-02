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
  /** Per-Token: marks a hidden Token that Bivouac parked in the scene to back a
   *  plate (see `plate-tokens.ts`). The marker is the ONLY thing that authorises
   *  deleting a token, so a GM-placed one is never mistaken for ours. */
  plateToken: "plateToken",
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
  castBarDockForced: "castBarDockForced",
  /** GM-defined stat rows (array of CustomStatRow). Hidden — edited through its
   *  own form, since a row is five fields and there can be several. */
  customStats: "customStats",
  /** Client setting: position of the Cast Bar toggle tab along its edge (%). */
  castBarTabPos: "castBarTabPos",
  /** Client setting: horizontal pad the right-dock Cast Bar tab keeps from the sidebar. */
  castBarTabPad: "castBarTabPad",
  /** World setting: the second Cast Bar's edge — "off" (disabled) or a dock position. */
  castBar2Dock: "castBar2Dock",
  /** Client setting: Cast Bar cross-axis size in px (drag-set; player-resizable). */
  castBarSize: "castBarSize",
  /** World setting: which system adapter supplies the Cast Bar stats ("auto" = detect). */
  castSystem: "castSystem",
  /** World settings: enable each Cast Bar stat globally. The active system adapter
   *  owns the full list (see systems.ts); these four are the dnd5e ones, kept at
   *  their original keys so existing worlds do not lose their choices. */
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
  /** Client setting: which tile an Actor drop creates — "ask" / "actor" / "minisheet". */
  actorDropTile: "actorDropTile",
  /** World setting: Cast Bar plate shape (a key of `PLATE_SHAPES`). */
  castPlateShape: "castPlateShape",
  /** World setting: back every plate with a hidden Token in the scene, so modules
   *  that look for `actor.getActiveTokens()` can find plated characters. Opt-in:
   *  it changes what the scene actually contains. */
  castPlateTokens: "castPlateTokens",
  /** World setting: show wounded states on plates at all (art swap, or a tint
   *  when a plate has no wounded art). */
  castWoundStates: "castWoundStates",
  /** World settings: the health PERCENTAGES at or below which a plate counts as
   *  injured / critical. Configurable rather than fixed at 50/10 — where "hurt"
   *  sits is a table's judgement, and systems differ on how fast health falls. */
  castWoundInjured: "castWoundInjured",
  castWoundCritical: "castWoundCritical",
  /** World setting: draw a thin dark stroke behind text that sits over artwork. */
  textStroke: "textStroke",
  textOutlineMode: "textOutlineMode",
  /** World setting: that stroke's width, in px. */
  textStrokeWidth: "textStrokeWidth",
} as const;

/** Default text-stroke width in px, and the slider's bounds. Shared by the
 *  setting registration, the two apply paths and the live preview so they can't
 *  drift apart. */
export const TEXT_STROKE = { default: 5, min: 0.5, max: 10, step: 0.1 } as const;

/**
 * Cast Bar plate shapes, as **width ÷ height**. Presets rather than a free
 * number: the value feeds both the CSS `aspect-ratio` AND the auto-shrink maths
 * in `#fit()`, and a known set keeps the strip looking deliberate.
 *
 * Full-body character art wants a tall plate, token art wants a square one —
 * which is the whole point of the request. `portrait` is the original 3:4.
 */
export const PLATE_SHAPES = {
  portrait: 3 / 4,
  tarot: 2 / 3,
  square: 1,
  wide: 4 / 3,
} as const;
export type PlateShape = keyof typeof PLATE_SHAPES;
export const PLATE_SHAPE_DEFAULT: PlateShape = "portrait";

/** The configured plate aspect (width ÷ height), falling back to the default. */
export function plateAspect(): number {
  const k = String(game.settings.get(MODULE_ID, SETTINGS.castPlateShape) ?? "");
  return PLATE_SHAPES[k as PlateShape] ?? PLATE_SHAPES[PLATE_SHAPE_DEFAULT];
}

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

/** May the current user operate a specific tile's contents — arrange a card
 *  collection (add / remove / reorder) or adjust a meter? Uses the tile's own
 *  `config.editRole` (minimum role, 1–4) when set, else inherits `canControl()`. */
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
 *  types. Known built-ins: webview · image · note · meter · actor · journal ·
 *  table · macro · cards (+ planned: scene · playlist · party · combat · rules). */
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
  /** Optional art for the WOUNDED states, shown in place of the normal image
   *  once health crosses the matching threshold (see the `castWound…` settings).
   *  Both are optional and independent: with only `imgInjured` set, a critical
   *  character keeps showing the injured art rather than falling back to healthy,
   *  because the nearer-to-death picture is the safer one to be wrong with.
   *
   *  When a state has no art, the plate tints the normal portrait instead — so
   *  the feature reads correctly with no per-character setup at all, and the art
   *  is the upgrade rather than the entry fee. */
  imgInjured?: string;
  imgCritical?: string;
  /** Darkened: physically in the scene but not in this conversation. */
  exited: boolean;
  /** GM-only: filtered out of the players' view entirely (like a hidden token). */
  hidden: boolean;
  /** Players see "?" instead of the name; the GM sees the real name greyed. */
  nameHidden: boolean;
  /** Show the Actor's stat overlay (AC / passive perception / HP / investigation)
   *  on this plate. Off by default; toggled per-plate from the hover controls.
   *
   *  Drawn for CONTROLLERS ONLY — unlike `conditions` there is no reveal state,
   *  because a player watching the overlay appear on their own plate learns the GM
   *  is checking them. This flag therefore says "the GM is looking at this", not
   *  "the table can see this". */
  stats?: boolean;
  /** Show the Actor's active conditions (status effects) on this plate. Off by
   *  default; a per-plate toggle exactly like `stats`. */
  conditions?: boolean;
  /** Also reveal those conditions to players who could NOT otherwise know them.
   *  Conditions on an NPC are GM information — whether the boss is frightened is
   *  usually something a table plays to find out — so showing them is a per-plate
   *  decision rather than all-or-nothing. Has no effect unless `conditions` is on,
   *  and none for an actor the player can already inspect (their own character's
   *  conditions are theirs regardless). */
  conditionsPublic?: boolean;
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
