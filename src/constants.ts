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
export type WidgetChrome = "none" | "subtle" | "framed";

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
  /** Clamp for widget dimensions, in squares. */
  min: 1,
  max: 10,
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
