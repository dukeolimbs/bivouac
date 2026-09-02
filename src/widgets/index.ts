/** Bivouac — tiles.
 *
 *  This is the only file the rest of the module imports from; everything below is
 *  re-exported from the module that owns it, so `import { … } from "./widgets"`
 *  keeps working exactly as before.
 *
 *  Layout:
 *    registry.ts     the tile type registry + `createWidget` factory
 *    types/*.ts      one file per tile type, each registering itself on import
 *    meter/*.ts      the meter's numbers (pure), gestures, and shapes
 *    style.ts        frame / background / text colour / text outline
 *    dom.ts svg.ts   element shorthands
 *    doc-tile.ts     the shared document-backed tile scaffold
 *    card-model.ts   pure card-list ops, shared with both host surfaces
 *    fonts.ts        font dropdown + on-demand Google Fonts
 *    foundry-api.ts  the version-fragile Foundry probes, in one place
 *
 *  IMPORTANT — the import order below IS the order of the Add-tile picker, because
 *  each type registers itself when its module first loads and `widgetTypes()`
 *  returns them in registration order. Reordering these lines reorders that
 *  dialog; adding a tile type means adding a file and one line here. */

import "./types/webview";
import "./types/image";
import "./types/note";
import "./types/meter";
import "./types/actor";
import "./types/journal";
import "./types/table";
import "./types/macro";
import "./types/cards";
import "./types/minisheet";

export { createWidget, getWidgetType, registerWidgetType, widgetTypes } from "./registry";
export type { RenderContext, WidgetTypeDef } from "./registry";

export { attachInteractions, runInteraction } from "./interactions";

export {
  applyBackground,
  applyFrameStyle,
  applyTextColor,
  applyTextStroke,
  backgroundOf,
  frameOf,
  setTextStrokeVars,
  textOutlineMode,
  textStrokeWidth,
} from "./style";
export type { OutlineMode } from "./style";

export { availableFonts, ensureGoogleFont } from "./fonts";

export { METER_KINDS, clampMeterValue, readMeter, snapMeter } from "./meter/model";
export type { MeterKind, MeterState } from "./meter/model";

export { applyCardOp, refsUuid } from "./card-model";

export {
  canView,
  conditionBadges,
  inCombat,
  sceneActor,
  sceneTokensOf,
  toggleCombat,
} from "./foundry-api";
export type { CombatResult, ConditionBadge } from "./foundry-api";

export { docImg } from "./doc-tile";
