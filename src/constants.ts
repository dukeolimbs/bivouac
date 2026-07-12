/** Bivouac — shared constants and data model. */

export const MODULE_ID = "bivouac";

/** Flag / setting keys, namespaced under the module. */
export const FLAGS = {
  /** Landing layout stored on a Scene. */
  layout: "layout",
  /** DM screen layout stored per-GM on the User document. */
  dmScreenLayout: "dmScreenLayout",
} as const;

export const SETTINGS = {
  /** World setting: the id of the Scene designated as the landing page. */
  landingSceneId: "landingSceneId",
  /** Client setting: px the DM-screen tab keeps left of the sidebar edge. */
  dmTabPad: "dmTabPad",
  /** Client setting: vertical position of the DM-screen tab, as a % of height. */
  dmTabTop: "dmTabTop",
  /** World setting: max widget size in grid squares (resize cap). */
  maxWidgetSize: "maxWidgetSize",
  /** Client setting: DM-screen drawer width in px (set by dragging its edge). */
  dmDrawerWidth: "dmDrawerWidth",
  /** Client setting: how many web views may be live before LOD can kick in. */
  lodMinWebviews: "lodMinWebviews",
} as const;

/** Widget geometry, measured in whole scene grid squares. */
export interface WidgetCell {
  gx: number;
  gy: number;
  gw: number;
  gh: number;
}

export type WidgetType = "webview" | "image" | "note";
export type WidgetScope = "shared" | "dm";
/** Legacy single "chrome" axis — migrated to separate `frame` + `background`
 *  (stored in `config`); kept for reading old layouts. */
export type WidgetChrome = "none" | "subtle" | "framed";
/** Border/edge style (config.frame). */
export type WidgetFrame = "none" | "subtle" | "framed";
/** Fill style (config.background). `image` is a planned future value. */
export type WidgetBackground = "none" | "solid" | "frosted" | "gradient";

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
