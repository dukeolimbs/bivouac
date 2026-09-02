/** Bivouac — the Cast Bar: a dedicated, docked strip of character "Plates" for
 *  narrative encounters (who's in the scene, who's speaking). Its own tool, not
 *  part of the Widget/Tile system. Roster + speaker + visibility persist per
 *  Scene (broadcast to all players); dock edge / tab position / size are per
 *  client. See docs/cast-bar-design-spec.md. */

import {
  FLAGS,
  MODULE_ID,
  SETTINGS,
  canControl,
  plateAspect,
  type CastBarData,
  type Plate,
} from "./constants";
import {
  formatStat,
  healthFraction,
  levelledStatus,
  setStatusLevel,
  statusLevel,
  visibleStats,
} from "./systems";
import { readCastBar, writeCastBar } from "./layout";
import {
  canView,
  conditionBadges,
  docImg,
  inCombat,
  sceneActor,
  toggleCombat,
} from "./widgets";
import { isDocDrag, parseDrop } from "./drop";
import { openPlateArt, pickImageFile, pickImageSource } from "./plate-art";
import { closePopover, openPopover, repaintPopover } from "./popover";
import { worldLayer } from "./world-layer";

const DOCKS = ["bottom", "top", "left", "right"] as const;
type Dock = (typeof DOCKS)[number];

/** Plate-size bounds, in px (also capped at 60vh/60vw). SIZE_MIN is low so a 25%
 *  quick-scale of a small base size is still honoured. */
const SIZE_MIN = 24;
const SIZE_MAX = 520;

/** Raise My Hand (`raise-my-hand`) is socket-only with no readable roster, so we
 *  track raises/lowers ourselves from its channel (`{type:RAISE|LOWER, playerID}`).
 *  `game.socket.emit` doesn't echo to the sender, so a client's OWN hand is read
 *  from the module's in-memory `game.handRaiser.isRaised` instead. */
const raisedHands = new Set<string>();

/** Fold a raise-my-hand socket message into the tracked set (wired in module.ts).
 *  Handles both the original module's raw `{type:RAISE|LOWER, playerID}` and the
 *  socketlib-based raise-my-hand-plus envelope `{handlerName, args:[userId]}`
 *  (createHandPopout/appendPlayerListIcon = up, close/remove/lower = down). */
export function onRaiseHandMessage(msg: unknown): void {
  const m = msg as {
    type?: unknown;
    playerID?: string;
    handlerName?: string;
    args?: unknown[];
  } | null;
  if (!m) return;
  if (typeof m.playerID === "string") {
    if (m.type === "RAISE") raisedHands.add(m.playerID);
    else if (m.type === "LOWER") raisedHands.delete(m.playerID);
  } else if (typeof m.handlerName === "string") {
    const h = m.handlerName;
    if (/clear/i.test(h)) raisedHands.clear();
    else {
      const uid = Array.isArray(m.args) ? m.args[0] : undefined;
      if (typeof uid === "string") {
        if (/create|append|raise|show|open/i.test(h)) raisedHands.add(uid);
        else if (/close|remove|lower|hide/i.test(h)) raisedHands.delete(uid);
      }
    }
  }
}

/** Is this element actually being shown? Presence in the DOM is NOT the same as
 *  a raised hand: a players-list indicator is commonly rendered for EVERY row and
 *  revealed by CSS only for the user whose hand is up, so reading presence alone
 *  put a hand on every plate the moment anyone raised. An element hidden by
 *  `display:none` has no client rects; one hidden by `visibility`/`opacity` does,
 *  so both are checked. */
function isShown(el: Element): boolean {
  if (!el.getClientRects().length) return false;
  const st = window.getComputedStyle(el);
  return st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity || "1") > 0.01;
}

/** User ids whose hand is currently raised.
 *
 *  Ordered most to least trustworthy:
 *   1. the socket feed (`raisedHands`) — an explicit per-user raise/lower;
 *   2. our own hand, which the socket never echoes back to us;
 *   3. the players-list ✋ marker, for hands raised before we connected — counted
 *      only when the marker is actually VISIBLE (see `isShown`);
 *   4. a user flag from an active module, for other raised-hand modules — counted
 *      only when the value is literally `true`.
 *
 *  3 and 4 are guesses about modules we don't control, so both are deliberately
 *  narrow. Their previous forms ("an element matched" / "a truthy key containing
 *  hand") could each mark the WHOLE table as raised from a single raise, or from
 *  an unrelated preference flag like `handColour`. A guess that can't tell one
 *  player from all of them is worse than no guess. */
function raisedHandUserIds(): Set<string> {
  const out = new Set<string>(raisedHands);
  if (game.handRaiser?.isRaised && game.user?.id) out.add(game.user.id);
  // Players-list marker: raise-my-hand-plus uses ".raise-my-hand-indicator"; the
  // original module used ".raised-hand". Read both.
  document
    .querySelectorAll(".raise-my-hand-indicator, .raised-hand")
    .forEach((span) => {
      if (!isShown(span)) return;
      const uid = (span.closest("[data-user-id]") as HTMLElement | null)
        ?.dataset.userId;
      if (uid) out.add(uid);
    });
  const users = (game.users?.contents ?? []) as {
    id?: string;
    flags?: Record<string, Record<string, unknown>>;
  }[];
  for (const u of users) {
    for (const [mod, data] of Object.entries(u.flags ?? {})) {
      if (!data || !game.modules?.get?.(mod)?.active) continue;
      // `v === true`, not merely truthy: a raise is a boolean state, whereas the
      // hand-ish keys that are NOT a state (handColour, raisedHandIcon, a sound
      // path) hold strings — which are truthy, and matched every user that had
      // ever configured the module.
      if (Object.entries(data).some(([k, v]) => v === true && /hand/i.test(k))) {
        if (u.id) out.add(u.id);
        break;
      }
    }
  }
  return out;
}

/** Per-instance wiring so multiple Cast Bars (e.g. party + NPCs) can coexist: each
 *  has its own scene flag, dock/size/tab settings, and DOM ids. CSS vars are scoped
 *  to the instance's own elements (not the document root), so they don't clash. */
interface CastBarConfig {
  flag: string;
  dockSetting: string;
  tabPosSetting: string;
  tabPadSetting: string;
  sizeSetting: string;
  /** Per-bar quick scale multiplier (hover +/-), applied on top of the size. */
  scaleSetting: string;
  elId: string;
  tabId: string;
  /** If true, a dock value outside DOCKS (e.g. "off") disables the bar entirely. */
  optional: boolean;
}

/** The plate actions a keybinding can fire — the same set as the hover control
 *  bar, so the keys are an accelerator for buttons that already exist. */
export type PlateAction =
  | "speaker"
  | "name"
  | "exited"
  | "hidden"
  | "stats"
  | "conditions"
  | "combat"
  | "menu"
  | "art"
  | "remove";

/** What the pointer is currently over. Keybindings for "the hovered plate" only
 *  make sense against live pointer state, and this has to be module-level because
 *  there are two bar instances and the bindings are registered once.
 *
 *  Held as ids rather than instances, so nothing here can pin a stale object:
 *  both are resolved on use, and a plate id that has since gone simply no-ops
 *  (every action re-reads the roster). */
let hoveredPlate: { barId: string; plateId: string } | null = null;
let hoveredBarId: string | null = null;

function barById(id: string | null): CastBar | null {
  return castBars.find((b) => b.id === id) ?? null;
}

/** Fire a plate action on whatever the pointer is over. Returns whether it acted,
 *  so the keybinding can consume the key ONLY when it did something — otherwise
 *  the key falls through to Foundry (or another module) untouched. */
export function castPlateAction(action: PlateAction): boolean {
  const bar = hoveredPlate ? barById(hoveredPlate.barId) : null;
  if (!bar || !hoveredPlate || !canControl()) return false;
  void bar.plateAction(hoveredPlate.plateId, action);
  return true;
}

/** Show/hide the ONE Cast Bar the pointer is over. Returns false with the pointer
 *  anywhere else, so the key falls through to Foundry rather than acting on a bar
 *  the user was not pointing at — `castToggleAllVisible` is the key for that,
 *  and the two are separate bindings so each can say which it does.
 *
 *  Like the bar's own × this is a WORLD change: visibility lives on the scene
 *  flag, so it shows/hides for every player, not just the GM pressing the key. */
export function castToggleVisible(): boolean {
  if (!canControl()) return false;
  const hovered = barById(hoveredBarId);
  if (!hovered) return false;
  void hovered.toggleVisible();
  return true;
}

/** Show/hide EVERY enabled Cast Bar at once, wherever the pointer is. Both bars
 *  are flipped to the same state rather than each being toggled independently:
 *  with one bar already open, one press should leave the table looking at both
 *  bars or neither, not swap which one is up. So while EITHER is hidden the key
 *  opens both, and only with both already up does it close them. */
export function castToggleAllVisible(): boolean {
  if (!canControl()) return false;
  const bars = castBars.filter((b) => b.enabled);
  if (!bars.length) return false;
  const shown = bars.filter((b) => b.visible).length;
  const next = shown <= bars.length / 2;
  bars.forEach((b) => void b.setVisible(next));
  return true;
}


/** How badly hurt a plate's character is — "" (fine), "injured" or "critical".
 *
 *  Off unless the GM switched wounded states on, and "" whenever health can't be
 *  read at all: an unsupported system, an actor type with no health, or a pool
 *  with no maximum to measure against. A plate that CANNOT be assessed must look
 *  exactly like one that is unhurt, never like one that is dying.
 *
 *  Thresholds are inclusive and read live from the settings — `critical` is
 *  tested first so it wins when the two are set to the same number. */
function woundState(doc: Record<string, unknown> | null): "" | "injured" | "critical" {
  if (!doc) return "";
  try {
    if (!game.settings.get(MODULE_ID, SETTINGS.castWoundStates)) return "";
    const frac = healthFraction(doc);
    if (frac == null) return "";
    const pct = frac * 100;
    if (pct <= Number(game.settings.get(MODULE_ID, SETTINGS.castWoundCritical)))
      return "critical";
    if (pct <= Number(game.settings.get(MODULE_ID, SETTINGS.castWoundInjured)))
      return "injured";
    return "";
  } catch {
    return "";
  }
}

/* ------------------------------------------- plate panels ---------------- */

/**
 * The two floating panels a plate can open, built on the shared `popover`
 * mechanics (mounting, positioning, toggle-on-retrigger, dismissal, repaint).
 *
 *  • **The condition palette** — apply and clear conditions, the job the Token
 *    HUD does for a token.
 *  • **The plate menu** — everything about a plate that is set up once rather
 *    than done mid-conversation.
 *
 * They exist as panels rather than more controls because the control bar is the
 * scarce resource: a portrait plate at the default size has 144px of usable bar,
 * and seven 22px buttons plus the grip need 161px. Moving the occasional actions
 * into a menu takes the bar to four items, which fits every plate shape and
 * leaves room for the size ladder to thin it further.
 */

/** The status effects this world has, in its configured order — the same list,
 *  in the same order, that the Token HUD shows. */
function statusEffectList(): { id: string; name: string; img: string }[] {
  const cfg = (CONFIG?.statusEffects ?? []) as {
    id?: string;
    name?: string;
    label?: string;
    img?: string;
    icon?: string;
  }[];
  return cfg
    .filter((s) => !!s.id)
    .map((s) => ({
      id: String(s.id),
      name: game.i18n.localize(String(s.name ?? s.label ?? s.id)),
      img: String(s.img ?? s.icon ?? ""),
    }));
}

/**
 * The condition palette.
 *
 * Writes to the SCENE actor, not the sidebar one. For an unlinked NPC those are
 * different documents, and the scene one is what the plate reads back — so a
 * condition applied here shows on the plate immediately, and the showing and
 * applying halves can never disagree about which actor they meant.
 */
function openConditionPalette(
  anchor: HTMLElement,
  actor: Record<string, unknown> | null,
  key: string,
): void {
  if (!actor) return;
  const toggle = (
    actor as { toggleStatusEffect?: (id: string, o?: object) => Promise<unknown> }
  ).toggleStatusEffect;
  if (typeof toggle !== "function") {
    ui.notifications?.warn(game.i18n.localize("BIVOUAC.CastBar.CondsUnsupported"));
    return;
  }
  const effects = statusEffectList();
  if (!effects.length) return;

  openPopover({
    key,
    anchor,
    className: "bivouac-cond-picker",
    title: String(actor.name ?? ""),
    exempt: `.${CTRL_CONDS}`,
    build: (body, onRepaint) => {
      const grid = document.createElement("div");
      grid.className = "bivouac-cond-picker__grid";
      // The column count has to be a NUMBER, not `auto-fill`: the panel is
      // shrink-to-fit, so a grid asking how wide its container is gets no answer
      // and lays out one column — which is how this palette came to be a single
      // stripe down the screen.
      //
      // Slightly wider than square (hence the 1.6), because a row of icons scans
      // faster than a column of them. Clamped either end: below 3 a small world's
      // palette turns into a stack, and above 8 a large one gets wider than the
      // plate it belongs to.
      const cols = Math.min(
        effects.length, // never more columns than there are icons to put in them
        Math.max(3, Math.min(8, Math.ceil(Math.sqrt(effects.length * 1.6)))),
      );
      grid.style.setProperty("--cond-cols", String(cols));
      body.appendChild(grid);
      // Re-read the live set on every paint rather than caching it: a condition
      // can also arrive from the Token HUD, a macro, or another GM, while this
      // sits open.
      const active = (): Set<string> => {
        const s = actor.statuses as Set<string> | undefined;
        return s && typeof s.has === "function" ? s : new Set<string>();
      };
      for (const e of effects) {
        // A levelled status is a NUMBER, not a flag — dnd5e exhaustion is the one
        // in practice. `levelledStatus` answers null for everything else, and
        // that null is what keeps the ordinary path below exactly as it was.
        const levels = levelledStatus(e.id);
        const level = (): number => statusLevel(actor, e.id) ?? 0;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "bivouac-cond-picker__item";
        b.setAttribute("aria-label", e.name);
        const icon = document.createElement("img");
        icon.src = e.img;
        icon.alt = "";
        b.appendChild(icon);
        // The count, drawn on the icon. Only a levelled status gets one at all —
        // an empty badge on every other condition would be a box to explain.
        const badge = levels ? document.createElement("span") : null;
        if (badge) {
          badge.className = "bivouac-cond-picker__lvl";
          b.appendChild(badge);
        }
        const hint = game.i18n.localize("BIVOUAC.CastBar.CondsLevelHint");
        b.dataset.tooltip = levels ? `${e.name} — ${hint}` : e.name;
        onRepaint(() => {
          const n = levels ? level() : 0;
          const on = levels ? n > 0 : active().has(e.id);
          b.classList.toggle("bivouac-cond-picker__item--on", on);
          b.setAttribute("aria-pressed", String(on));
          if (badge) {
            badge.textContent = n ? String(n) : "";
            badge.hidden = !n;
            b.dataset.tooltip = `${e.name}${n ? ` ${n}` : ""} — ${hint}`;
          }
        });
        /** Apply a click: the level step for a levelled status, else the toggle.
         *  Optimistic on the plain path (flip the icon now, write after) — the
         *  plate is redrawn by the ActiveEffect hooks, so this only has to keep
         *  the PALETTE honest for the moment between the click and the round
         *  trip. A level is NOT flipped optimistically: the number comes back
         *  from the actor, and guessing it would show a level the system may
         *  have clamped. */
        const apply = (step: number): void => {
          const write = levels
            ? setStatusLevel(actor, e.id, level() + step)
            : Promise.resolve(toggle.call(actor, e.id));
          if (!levels) b.classList.toggle("bivouac-cond-picker__item--on");
          void Promise.resolve(write)
            .catch(() =>
              ui.notifications?.warn(
                game.i18n.localize("BIVOUAC.CastBar.CondsFailed"),
              ),
            )
            .finally(() => repaintPopover());
        };
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          apply(1);
        });
        // Right-click steps a level back DOWN, which is the same gesture dnd5e's
        // own Token HUD uses for exhaustion — so the palette and the HUD cannot
        // teach the GM two different things. Bound only on a levelled status: on
        // a plain one there is nothing for it to do and a context menu is the
        // more useful default.
        if (levels) {
          b.addEventListener("contextmenu", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            apply(-1);
          });
        }
        grid.appendChild(b);
      }
    },
  });
}

/** A menu row that reads and writes one piece of plate state. */
interface MenuToggle {
  label: string;
  /** Current value, re-read on every repaint. */
  get(): boolean;
  set(): void | Promise<void>;
}

/** One labelled group of rows in the plate menu. */
function menuGroup(body: HTMLElement, label: string): HTMLElement {
  const g = document.createElement("div");
  g.className = "bivouac-pmenu__group";
  const h = document.createElement("p");
  h.className = "bivouac-pmenu__grouplabel";
  h.textContent = label;
  g.appendChild(h);
  body.appendChild(g);
  return g;
}

/**
 * The plate menu.
 *
 * Holds what used to be four separate buttons plus one undiscoverable click
 * target. Two of those readings improve by moving here rather than merely fitting:
 *
 *  • The conditions REVEAL is a three-state cycle (off → you → everyone). As a
 *    button that was a thing you clicked repeatedly to find out what it did; as
 *    three radio rows the states are simply visible.
 *  • Name visibility had no button at all — it was a bare click on the name
 *    banner, hinted at only by a `title` and a "?" that appears on hover. It
 *    keeps that shortcut, and now also has a place you can find it.
 */
function openPlateMenu(
  anchor: HTMLElement,
  bar: CastBar,
  plate: Plate,
  name: string,
): void {
  openPopover({
    key: `${bar.id}:menu:${plate.id}`,
    anchor,
    className: "bivouac-pmenu",
    title: name,
    exempt: `.${CTRL_MENU}`,
    build: (body, onRepaint) => {
      const t = (k: string): string => game.i18n.localize(k);

      /** A checkbox row. Stays open after a click, so several can be set in one
       *  visit — the whole point of gathering them here. */
      const check = (into: HTMLElement, row: MenuToggle): void => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "bivouac-pmenu__item";
        b.setAttribute("role", "menuitemcheckbox");
        const tick = document.createElement("i");
        tick.className = "bivouac-pmenu__tick fa-solid fa-check";
        const span = document.createElement("span");
        span.textContent = row.label;
        b.append(tick, span);
        onRepaint(() => {
          const on = row.get();
          b.classList.toggle("bivouac-pmenu__item--on", on);
          b.setAttribute("aria-checked", String(on));
        });
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          void row.set();
        });
        into.appendChild(b);
      };

      /* -- visibility ------------------------------------------------------ */
      const vis = menuGroup(body, t("BIVOUAC.CastBar.MenuVisibility"));
      check(vis, {
        label: t("BIVOUAC.CastBar.MenuInScene"),
        get: () => !plate.exited,
        set: () => bar.plateAction(plate.id, "exited"),
      });
      check(vis, {
        label: t("BIVOUAC.CastBar.MenuHidden"),
        get: () => !!plate.hidden,
        set: () => bar.plateAction(plate.id, "hidden"),
      });
      check(vis, {
        label: t("BIVOUAC.CastBar.MenuNameShown"),
        get: () => !plate.nameHidden,
        set: () => bar.plateAction(plate.id, "name"),
      });

      /* -- overlays -------------------------------------------------------- */
      const ov = menuGroup(body, t("BIVOUAC.CastBar.MenuOverlays"));
      check(ov, {
        label: t("BIVOUAC.CastBar.MenuStats"),
        get: () => !!plate.stats,
        set: () => bar.plateAction(plate.id, "stats"),
      });

      // The reveal states as radios rather than a cycling button. `conditions`
      // and `conditionsPublic` are two booleans in the data but only three of
      // their four combinations mean anything, so the UI offers exactly three.
      const revealRow = document.createElement("div");
      revealRow.className = "bivouac-pmenu__reveal";
      const revealLabel = document.createElement("span");
      revealLabel.className = "bivouac-pmenu__revealtitle";
      revealLabel.textContent = t("BIVOUAC.CastBar.MenuConditions");
      revealRow.appendChild(revealLabel);
      const states: { key: string; conditions: boolean; publicly: boolean }[] = [
        { key: "BIVOUAC.CastBar.MenuCondsOff", conditions: false, publicly: false },
        { key: "BIVOUAC.CastBar.MenuCondsYou", conditions: true, publicly: false },
        { key: "BIVOUAC.CastBar.MenuCondsAll", conditions: true, publicly: true },
      ];
      for (const s of states) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "bivouac-pmenu__radio";
        b.setAttribute("role", "menuitemradio");
        b.textContent = t(s.key);
        onRepaint(() => {
          const on =
            !!plate.conditions === s.conditions &&
            (!s.conditions || !!plate.conditionsPublic === s.publicly);
          b.classList.toggle("bivouac-pmenu__radio--on", on);
          b.setAttribute("aria-checked", String(on));
        });
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          void bar.setConditionReveal(plate.id, s.conditions, s.publicly);
        });
        revealRow.appendChild(b);
      }
      ov.appendChild(revealRow);

      /* -- appearance ------------------------------------------------------ */
      const app = menuGroup(body, t("BIVOUAC.CastBar.MenuAppearance"));
      const artBtn = document.createElement("button");
      artBtn.type = "button";
      artBtn.className = "bivouac-pmenu__item";
      artBtn.setAttribute("role", "menuitem");
      artBtn.innerHTML = `<i class="bivouac-pmenu__tick fa-solid fa-image"></i>`;
      artBtn.append(
        Object.assign(document.createElement("span"), {
          textContent: t("BIVOUAC.CastBar.ArtEdit"),
        }),
      );
      // Opens a dialog, so the menu goes — unlike the checkboxes, there is
      // nothing more to set here and leaving it up would sit behind the dialog.
      artBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closePopover();
        void bar.plateAction(plate.id, "art");
      });
      app.appendChild(artBtn);

      /* -- remove ---------------------------------------------------------- */
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "bivouac-pmenu__item bivouac-pmenu__item--danger";
      rm.setAttribute("role", "menuitem");
      rm.innerHTML = `<i class="bivouac-pmenu__tick fa-solid fa-xmark"></i>`;
      rm.append(
        Object.assign(document.createElement("span"), {
          textContent: t("BIVOUAC.CastBar.MenuRemove"),
        }),
      );
      rm.addEventListener("click", (e) => {
        e.stopPropagation();
        closePopover();
        void bar.plateAction(plate.id, "remove");
      });
      body.appendChild(rm);
    },
  });
}

/** Quick-scale bounds + step for the hover +/- control (× the base Actor size). */
const SCALE_MIN = 0.25;
const SCALE_MAX = 1.5;
const SCALE_STEP = 0.1;

/** How many condition icons a plate draws before collapsing the rest into "+n",
 *  per size tier. The plate face is shared with the stats overlay, the name
 *  banner and the raised-hand badge, and six icons come to two thirds of a
 *  portrait plate's height at ANY size — the icons scale with the plate, so the
 *  proportion never improves on its own. */
const CONDITION_CAP: Record<Tier, number> = {
  full: 6,
  compact: 3,
  min: 0,
  none: 0,
};

/** How many stat rows a plate draws, per size tier.
 *
 *  A cap is needed because the row count is not ours: the GM chooses which stats
 *  are enabled, and a custom row can be added for anything the system exposes, so
 *  "however many there are" could be ten. Four rows plus the control bar and a
 *  two-line name banner is the most a default-size portrait plate holds.
 *
 *  At `compact` the one row kept is the HEALTH row, whichever the active adapter
 *  (or a GM's custom row) says that is — so it is HP on dnd5e, marked Hit Points
 *  on Daggerheart, and whatever a GM declared on a system with no adapter. */
const STAT_CAP: Record<Tier, number> = {
  full: 4,
  compact: 1,
  min: 0,
  none: 0,
};

/** Control classes the panels' dismiss handlers must treat as their trigger
 *  rather than as an outside press. Named constants because the class is written
 *  in one place and matched in another, and a typo would silently break the
 *  open/close toggle rather than fail loudly. */
const CTRL_CONDS = "bivouac-plate__ctrl--conds";
const CTRL_MENU = "bivouac-plate__ctrl--menu";
const CTRL_COMBAT = "bivouac-plate__ctrl--combat";

/**
 * Plate size tiers.
 *
 * A plate's height is `--bivouac-castbar-fit` and its width is that times the
 * aspect, so a portrait plate at the default 200px size is 150px wide with 144px
 * of usable control bar — and `#fit()` can take the height down to 24px. Nothing
 * about the chrome survives that range unchanged, so the tier says how much of
 * it to draw:
 *
 *  • `full`     grip, exit, combat, conditions, menu; stats and conditions
 *                overlays in full.
 *  • `compact`  grip, exit, combat, menu; the health stat row only; conditions
 *                capped at 3.
 *  • `min`      grip and menu; no overlays.
 *  • `none`     < 50px  — no controls at all. At that size a plate is a
 *                thumbnail and a 16px button is a third of its width; the
 *                keybindings remain the way to act on it.
 *
 * Laddered on BOTH axes, and the stricter answer wins. The two constraints are
 * genuinely different: the control bar runs across the plate, while the banner
 * and the overlay columns stack down it. A short wide plate can be broad enough
 * for the full bar with no height for a bar plus a banner; a narrow tall one is
 * the reverse.
 *
 * A single threshold on the smaller side was tried first and was too blunt — it
 * dropped a tarot plate at the DEFAULT size to `compact`, losing three stat rows
 * and the conditions button on a plate with room for both.
 *
 * The numbers are each tier's measured requirement plus headroom, verified
 * against every size/shape combination:
 *   full     needs 119px across (grip + 4 buttons + padding) and ~120px down
 *   compact  needs  74px across (grip + 3 buttons + padding) and  ~84px down
 *   min      needs  38px across (grip + 1 button  + padding) and  ~46px down
 */
export const TIERS = ["full", "compact", "min", "none"] as const;
export type Tier = (typeof TIERS)[number];

const TIER_MIN_W = { full: 110, compact: 78, min: 40 } as const;
const TIER_MIN_H = { full: 130, compact: 84, min: 46 } as const;

function tierFor(widthPx: number, heightPx: number): Tier {
  for (const t of ["full", "compact", "min"] as const)
    if (widthPx >= TIER_MIN_W[t] && heightPx >= TIER_MIN_H[t]) return t;
  return "none";
}

/** Extra horizontal inset (px) for the vertical docks, ON TOP of the base edge
 *  clearance (left → scene-controls toolbar, right → sidebar). Tweak to taste. */
const LEFT_DOCK_PAD = -35; // left bar's gap from the scene-controls toolbar
const RIGHT_DOCK_PAD = 0; // right bar's gap from the sidebar

class CastBar {
  #el: HTMLElement | null = null;
  #strip: HTMLElement | null = null;
  #tab: HTMLButtonElement | null = null;
  #closeBtn: HTMLButtonElement | null = null;
  /** Hover control that cycles the bar's edge; hidden under a forced dock. */
  #dockBtn: HTMLButtonElement | null = null;
  #dock: Dock = "bottom";
  /** Plate id being drag-reordered, or null. */
  #dragId: string | null = null;
  #fitFrames = 0;
  /** Current size tier, and whether a tier-change re-render is already pending.
   *  `#fit()` decides the tier because it is the one place that knows the
   *  effective plate size; the parts of the tier CSS can't express (which
   *  controls exist, how many condition icons) need a re-render to catch up. */
  #tier: Tier = "full";
  #tierPending = false;
  #fitting = false;
  #cfg: CastBarConfig;
  #enabled = true;

  constructor(cfg: CastBarConfig) {
    this.#cfg = cfg;
  }

  /* ------------------------------------------------ mount --------------- */

  /** Build the surface (for everyone) and, for controllers, the toggle tab.
   *  Idempotent — safe to call once on `ready`. */
  mount(): void {
    const iface = document.getElementById("interface") ?? document.body;

    if (!this.#el) {
      const bar = document.createElement("aside");
      bar.id = this.#cfg.elId;
      bar.className = "bivouac-castbar";
      // Which bar the pointer is over, so a bar-level keybinding can target the
      // one being looked at when two are running.
      bar.addEventListener("pointerenter", () => {
        hoveredBarId = this.id;
      });
      bar.addEventListener("pointerleave", () => {
        if (hoveredBarId === this.id) hoveredBarId = null;
        // Also clear the plate: a plate that was re-rendered (a speaker change
        // rebuilds them) never fires its own pointerleave, because the element
        // the pointer was over no longer exists. Leaving the bar is the reliable
        // moment to know nothing is hovered. `pointerleave` doesn't fire when
        // moving BETWEEN plates inside the bar, so this can't clear a live hover.
        if (hoveredPlate?.barId === this.id) hoveredPlate = null;
      });

      const strip = document.createElement("div");
      strip.className = "bivouac-castbar__strip";
      // Drop an Actor/Item onto the bar → add a Plate. Available to any controller
      // whenever the bar is open, NOT only in Bivouac Edit Mode: adding someone to
      // a scene is a thing you do mid-conversation, and requiring edit mode meant
      // routing every addition through the Landing Page controls first.
      // Skipped while an internal reorder is in flight (it has its own handling).
      strip.addEventListener("dragover", (e) => {
        if (this.#dragId || !canControl() || !isDocDrag(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      });
      strip.addEventListener("drop", (e) => {
        if (!this.#dragId) void this.#onDrop(e);
      });
      bar.appendChild(strip);
      this.#strip = strip;

      // Controllers get a close button on the bar itself (the toggle tab fades
      // while the bar is open, so it can't double as the closer).
      if (canControl()) {
        const close = document.createElement("button");
        close.type = "button";
        close.className = "bivouac-castbar__close";
        close.title = game.i18n.localize("BIVOUAC.CastBar.Close");
        close.innerHTML = `<i class="fa-solid fa-eye"></i>`;
        // Toggle (not just hide) so it also works to un-hide while editing.
        close.addEventListener("click", () => void this.toggleVisible());
        bar.appendChild(close);
        this.#closeBtn = close;
      }

      // Client-side quick scale (all users): +/- buttons revealed on hover.
      const scaleBox = document.createElement("div");
      scaleBox.className = "bivouac-castbar__scale";
      const scaleBtn = (
        icon: string,
        titleKey: string,
        delta: number,
      ): void => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "bivouac-castbar__scalebtn";
        b.title = game.i18n.localize(titleKey);
        b.innerHTML = `<i class="fa-solid ${icon}"></i>`;
        b.addEventListener("click", () => void this.#nudgeScale(delta));
        scaleBox.appendChild(b);
      };
      // Move the bar from the bar itself. Where the strip sits is a look-and-feel
      // judgement made WHILE LOOKING at the scene, and it currently costs a round
      // trip through the Settings window — conspicuous next to the chrome that's
      // already here. It CYCLES rather than opening a four-way pad: one glyph, no
      // popover, and four clicks gets you anywhere.
      //
      // Controller-gated, which matters most on bar 2: its dock is a WORLD setting
      // (bar 1's is per-client), so the same button is a personal tweak on one bar
      // and a change-for-everyone on the other. It also disables itself under a
      // forced dock, or it would silently do nothing.
      const dockBtn = document.createElement("button");
      dockBtn.type = "button";
      dockBtn.className = "bivouac-castbar__dockbtn";
      // A rectangle with one filled edge, ROTATED to match the dock — so the
      // button reports where the bar currently is as well as offering to move it.
      // No other single glyph does both, and this one costs nothing to keep in
      // sync: the rotation is four CSS rules hanging off the
      // `bivouac-castdock-*` class `applyDock()` already puts on the bar.
      //
      // Two glyphs were tried and rejected first. `fa-arrows-up-down-left-right`
      // is a thin symmetrical cross sitting between a real − and a real +, and
      // read as a third plus. `fa-hand`/`fa-hand-back-fist` said "grab" but the
      // open hand is already the RAISED-HAND badge on a plate — one glyph for "a
      // player wants to speak" and "move the bar" is two unrelated meanings — and
      // a hand implies dragging, where this button clicks.
      //
      // REGULAR weight, not solid: the solid cut is a filled block with the edge
      // knocked out of it, which reads as a white tile. The regular cut is what
      // the button is actually describing — an outlined rectangle with one solid
      // edge, i.e. an empty screen with a bar along one side. Foundry ships FA
      // PRO, so the outline weights (`fa-regular-400.woff2` and friends) are
      // there to use; on the free set only solid and brands exist.
      dockBtn.innerHTML = `<i class="fa-regular fa-window-maximize"></i>`;
      dockBtn.addEventListener("click", () => void this.#cycleDock());
      this.#dockBtn = dockBtn;

      // Order: −  move  +. The move control sits BETWEEN the two scale buttons
      // rather than off to one side, so the trio reads as one cluster of three
      // matching circles instead of a pair plus a stray. It hides itself under a
      // forced dock (`#syncDockBtn`), and `display: none` leaves no gap behind —
      // the row closes up to − + on its own.
      scaleBtn("fa-minus", "BIVOUAC.CastBar.ScaleDown", -SCALE_STEP);
      scaleBox.appendChild(dockBtn);
      scaleBtn("fa-plus", "BIVOUAC.CastBar.ScaleUp", SCALE_STEP);
      bar.appendChild(scaleBox);
      this.#syncDockBtn();

      iface.appendChild(bar);
      this.#el = bar;
      window.addEventListener("resize", () => this.applySize());
      // The available width changes when the sidebar collapses/expands → refit
      // across the animation so it tracks to the settled position.
      Hooks.on("collapseSidebar", this.#scheduleFit);
    }

    if (canControl() && !this.#tab) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.id = this.#cfg.tabId;
      tab.className = "bivouac-castbar-tab bivouac-casttab-bottom"; // edge fixed by applyDock()
      tab.title = game.i18n.localize("BIVOUAC.CastBar.Toggle");
      tab.innerHTML = `<i class="fa-solid fa-masks-theater"></i>`;
      tab.addEventListener("click", () => void this.toggleVisible());
      iface.appendChild(tab);
      this.#tab = tab;
    }

    this.applyDock();
    this.applySize();
    this.applyTabPos();
    this.refresh();
    // Foundry's sidebar / controls may still be settling on first world load, so
    // re-measure across the next frames (and once more after the cold-start delay).
    this.#scheduleFit();
    window.setTimeout(this.#scheduleFit, 500);
  }

  /* ------------------------------------------------ dock / size --------- */

  /** Whether a GM has pinned this bar's edge for everyone. Only the primary bar
   *  has an override — the second bar's own dock is already world-scoped, so it
   *  is forced by construction. Returns the forced edge, or null. */
  #forcedDock(): Dock | null {
    if (this.#cfg.dockSetting !== SETTINGS.castBarDock) return null;
    const f = String(game.settings.get(MODULE_ID, SETTINGS.castBarDockForced) ?? "off");
    return (DOCKS as readonly string[]).includes(f) ? (f as Dock) : null;
  }

  /** True when the bar's edge is not this client's to change — used to disable the
   *  affordances that write the setting, so they can't silently do nothing.
   *
   *  Deliberately applies to the GM too. A forced edge exists so everyone's screen
   *  matches what the GM framed the scene around; if the GM's own bar drifted off
   *  it, they'd be designing against a layout nobody else has. The GM changes the
   *  forced value itself instead. */
  dockLocked(): boolean {
    return this.#forcedDock() !== null;
  }

  /** Step the bar's edge on one place. Writing the SETTING (rather than moving
   *  the bar directly) means its `onChange` runs `applyDock()` + `applySize()`,
   *  so placement, the fit maths and the tab all re-derive with no extra wiring —
   *  and the Settings dropdown stays in step, since it's the same value. */
  async #cycleDock(): Promise<void> {
    if (this.dockLocked() || !canControl()) return;
    const order: readonly Dock[] = ["top", "right", "bottom", "left"];
    const cur = String(game.settings.get(MODULE_ID, this.#cfg.dockSetting) ?? "bottom");
    const i = order.indexOf(cur as Dock);
    await game.settings.set(MODULE_ID, this.#cfg.dockSetting, order[(i + 1) % order.length]);
  }

  /** Show the move button only to users who may actually use it. */
  #syncDockBtn(): void {
    const b = this.#dockBtn;
    if (!b) return;
    const allowed = canControl() && !this.dockLocked();
    b.style.display = allowed ? "" : "none";
    b.title = game.i18n.localize("BIVOUAC.CastBar.MoveBar");
  }

  applyDock(): void {
    // Resolved forced-else-client HERE, in the one place that reads the dock, so
    // everything downstream — the fit maths, the tab edge, the empty drop-zone
    // shape — follows from it for free.
    const m = String(
      this.#forcedDock() ?? game.settings.get(MODULE_ID, this.#cfg.dockSetting) ?? "bottom",
    );
    const valid = (DOCKS as readonly string[]).includes(m);
    // Optional (secondary) bars are disabled when their dock is "off" / invalid.
    this.#enabled = valid || !this.#cfg.optional;
    if (this.#el) this.#el.style.display = this.#enabled ? "" : "none";
    if (this.#tab) this.#tab.style.display = this.#enabled ? "" : "none";
    if (!this.#enabled) return;
    this.#dock = valid ? (m as Dock) : "bottom";
    const set = (elm: HTMLElement | null, prefix: string): void => {
      if (!elm) return;
      DOCKS.forEach((d) => elm.classList.remove(`${prefix}-${d}`));
      elm.classList.add(`${prefix}-${this.#dock}`);
    };
    set(this.#el, "bivouac-castdock");
    set(this.#tab, "bivouac-casttab");
    // A GM turning the override on/off has to reach every client's button, and
    // `applyDock` is what every one of those paths already runs.
    this.#syncDockBtn();
  }

  #vertical(): boolean {
    return this.#dock === "left" || this.#dock === "right";
  }

  applySize(): void {
    const el = this.#el;
    if (!el) return;
    const base = Number(
      game.settings.get(MODULE_ID, this.#cfg.sizeSetting) ?? 200,
    );
    const scale = Number(
      game.settings.get(MODULE_ID, this.#cfg.scaleSetting) ?? 1,
    );
    const wanted =
      (Number.isFinite(base) ? base : 200) *
      (Number.isFinite(scale) ? scale : 1);
    const cap = Math.min(
      SIZE_MAX,
      (this.#vertical() ? window.innerWidth : window.innerHeight) * 0.6,
    );
    const size = Math.min(cap, Math.max(SIZE_MIN, wanted));
    // Scoped to this bar's element (not :root) so two bars don't clobber each other.
    el.style.setProperty("--bivouac-castbar-size", `${Math.round(size)}px`);
    // Plate shape. Published as a number (a valid `<ratio>`) so the CSS and the
    // fit maths below are driven by the same value.
    el.style.setProperty("--bivouac-plate-aspect", String(plateAspect()));
    this.#fit();
  }

  /** Nudge this bar's client scale by ±one step, clamped, and re-apply. */
  async #nudgeScale(delta: number): Promise<void> {
    const cur = Number(
      game.settings.get(MODULE_ID, this.#cfg.scaleSetting) ?? 1,
    );
    const raw = (Number.isFinite(cur) ? cur : 1) + delta;
    const next = Math.min(
      SCALE_MAX,
      Math.max(SCALE_MIN, Math.round(raw / SCALE_STEP) * SCALE_STEP),
    );
    await game.settings.set(MODULE_ID, this.#cfg.scaleSetting, next); // onChange → applySize
  }

  applyTabPos(): void {
    const pos = Number(
      game.settings.get(MODULE_ID, this.#cfg.tabPosSetting) ?? 50,
    );
    this.#tab?.style.setProperty(
      "--bivouac-casttab-pos",
      `${Number.isFinite(pos) ? pos : 50}%`,
    );
    this.#syncTab();
  }

  /** Recompute the fit/position for ~20 frames, so the bar settles into place as
   *  Foundry's UI finishes laying out (first world load) or animates (sidebar
   *  collapse) — a one-shot measure can land before the sidebar/controls settle. */
  #scheduleFit = (): void => {
    this.#fitFrames = 20;
    if (this.#fitting) return;
    this.#fitting = true;
    const step = (): void => {
      this.#fit();
      if (--this.#fitFrames > 0) requestAnimationFrame(step);
      else this.#fitting = false;
    };
    requestAnimationFrame(step);
  };

  /**
   * Adopt the size tier for a plate of height `fitPx` and the given aspect.
   *
   * Published two ways because the ladder is split between them. `data-tier` on
   * the bar lets CSS thin the chrome with no JavaScript in the loop — which
   * controls are visible, whether the overlays are drawn, which stat rows show.
   * The parts CSS cannot express — how many condition icons to draw before the
   * `+n`, since the count has to be arithmetic — need a re-render.
   *
   * That re-render is scheduled, not immediate: `#fit()` is called ~20 times per
   * settle from `#scheduleFit`, and it is `#fit()` that calls this, so rendering
   * synchronously from here would re-enter the render it was called from. One
   * frame later is soon enough, and `#tierPending` collapses a burst into a
   * single pass. It terminates because the second pass measures the same width
   * and so finds the tier unchanged.
   */
  #applyTier(fitPx: number, aspect: number): void {
    const next = tierFor(fitPx * aspect, fitPx);
    if (this.#el) this.#el.dataset.tier = next;
    if (next === this.#tier || this.#tierPending) return;
    this.#tier = next;
    this.#tierPending = true;
    requestAnimationFrame(() => {
      this.#tierPending = false;
      this.refresh();
    });
  }

  /** Scale the plates down so the whole cast fits the available space (clear of
   *  Foundry's side UI) instead of overlapping it or running off-screen. Sets the
   *  effective plate size on `--bivouac-castbar-fit`; the CSS falls back to the
   *  full `--bivouac-castbar-size` when no shrink is needed. */
  #fit(): void {
    const el = this.#el;
    const strip = this.#strip;
    if (!el || !strip || !this.#enabled) return;
    this.#syncTab();
    // PLACE THE BAR FIRST, whatever it contains. Where the bar sits is a function
    // of Foundry's UI (sidebar / scene controls / hotbar), not of the plates, so
    // it must not be skipped on the empty path — this used to sit below the
    // early return, which meant an EMPTY bar never got its dock inset at all and
    // fell back to the CSS `right: 12px`, i.e. underneath the sidebar. The
    // edit-mode drop zone is exactly the case that is always empty, so the one
    // thing a GM had to aim at was the one thing that was never placed.
    // It also leaves a stale inline inset behind when the last plate is removed.
    const avail = this.#placeAndBand(el);
    const count = strip.querySelectorAll(".bivouac-plate").length;
    if (!count) {
      el.style.removeProperty("--bivouac-castbar-fit");
      return;
    }
    const gap =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--bivouac-gap",
        ),
      ) || 8;
    const size =
      parseFloat(
        getComputedStyle(el).getPropertyValue("--bivouac-castbar-size"),
      ) || 180;
    const stripCS = getComputedStyle(strip);
    const vertical = this.#vertical();
    const pad = vertical
      ? parseFloat(stripCS.paddingTop) + parseFloat(stripCS.paddingBottom)
      : parseFloat(stripCS.paddingLeft) + parseFloat(stripCS.paddingRight);
    // Per-plate footprint along the strip per 1px of plate size. The driven axis
    // is the height on a horizontal strip and the width on a vertical one, so
    // with an aspect of width÷height a plate takes `aspect × size` along a
    // horizontal strip and `size ÷ aspect` along a vertical one. This must track
    // the CSS `aspect-ratio`, or auto-shrink miscalculates and the plates overlap
    // the sidebar or run off-screen — hence both reading `plateAspect()`.
    const aspect = plateAspect();
    const per = vertical ? 1 / aspect : aspect;
    // …plus the plate's border, which `aspect-ratio` does NOT include: the
    // ratio applies to the content box, so each plate is `per × size` of content
    // with the border on top. Measured, not assumed — a 200px plate lays out at
    // 204px. Left out, the strip's footprint is underestimated by `border × count`
    // (4px a plate as it stands), which is invisible with three plates and pushes
    // a large cast into the sidebar. Read from a live plate rather than hard-coded,
    // so it can't drift from the CSS.
    const first = strip.querySelector(".bivouac-plate");
    const plateCS = first ? getComputedStyle(first) : null;
    const border = plateCS
      ? vertical
        ? parseFloat(plateCS.borderTopWidth) + parseFloat(plateCS.borderBottomWidth)
        : parseFloat(plateCS.borderLeftWidth) + parseFloat(plateCS.borderRightWidth)
      : 0;
    const maxSize = (avail - (count - 1) * gap - pad - count * border) / (count * per);
    // Auto-shrink to fit, but never below 80px UNLESS the chosen size is already
    // smaller (a deliberate quick-scale down) — then honour it.
    const floor = Math.min(80, size);
    const fit = Math.max(floor, Math.min(size, maxSize));
    el.style.setProperty("--bivouac-castbar-fit", `${Math.floor(fit)}px`);
    this.#applyTier(fit, aspect);
  }

  /** Position the bar with a dock-specific inset that clears the adjacent Foundry
   *  UI (top→nav · bottom→macro hotbar · left→scene controls · right→sidebar), and
   *  re-centre it along its main axis within the free band. Returns the main-axis
   *  extent (px) for the fit calc. All measured from THIS client's own window —
   *  nothing shared/persisted, so larger monitors keep full-size plates. */
  #placeAndBand(el: HTMLElement): number {
    const gapUI = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dock = this.#dock;
    el.style.removeProperty("top");
    el.style.removeProperty("bottom");
    el.style.removeProperty("left");
    el.style.removeProperty("right");

    if (dock === "left" || dock === "right") {
      // Vertical strip: centre in the viewport, and cap the column height so it
      // clears the top nav and the macro hotbar (measured) symmetrically about
      // that centre. Left/right bars carry +30px extra padding on every side
      // (both the vertical top/bottom clearance and the horizontal edge inset).
      const center = vh / 2;
      const topClear = 90; // 60 + 30 vertical padding
      const bottom = this.#hotbarTop() - gapUI - 70; // 40 + 30 vertical padding
      el.style.top = `${Math.round(center)}px`; // translateY(-50%) → viewport-centred
      // Horizontal inset per dock — the LEFT_DOCK_PAD / RIGHT_DOCK_PAD knobs above.
      if (dock === "left")
        el.style.left = `${Math.round(this.#controlsRight() + gapUI + LEFT_DOCK_PAD)}px`;
      else
        el.style.right = `${Math.round(vw - this.#sidebarLeft() + gapUI + RIGHT_DOCK_PAD)}px`;
      return Math.max(200, 2 * Math.min(center - topClear, bottom - center));
    }

    // Horizontal strip: band along x, between the scene controls and the sidebar.
    const start = this.#controlsRight() + gapUI;
    const end = this.#sidebarLeft() - gapUI;
    el.style.left = `${Math.round((start + end) / 2)}px`;
    // Top keeps its CSS inset (clears the nav); bottom rises above the hotbar.
    if (dock === "bottom")
      el.style.bottom = `${Math.round(vh - this.#hotbarTop() + gapUI)}px`;
    return Math.max(200, end - start);
  }

  /** Park the right-dock toggle tab just left of the sidebar's live edge (the same
   *  method the DM-screen tab uses), so a hidden right-docked bar's re-open button
   *  never sits under the sidebar. */
  #syncTab(): void {
    if (!this.#tab) return;
    const pad = Number(
      game.settings.get(MODULE_ID, this.#cfg.tabPadSetting) ?? -33,
    );
    const inset = Math.max(
      0,
      window.innerWidth -
        this.#sidebarLeft() +
        (Number.isFinite(pad) ? pad : -33),
    );
    this.#tab.style.setProperty(
      "--bivouac-casttab-inset",
      `${Math.round(inset)}px`,
    );
  }

  /** Live-preview the tab position/padding from explicit values (Settings window
   *  drag), without persisting. Close-settings re-applies the saved values. */
  previewTab(posPct: number, padPx: number): void {
    const tab = this.#tab;
    if (!tab) return;
    if (Number.isFinite(posPct))
      tab.style.setProperty("--bivouac-casttab-pos", `${posPct}%`);
    if (Number.isFinite(padPx)) {
      const inset = Math.max(
        0,
        window.innerWidth - this.#sidebarLeft() + padPx,
      );
      tab.style.setProperty(
        "--bivouac-casttab-inset",
        `${Math.round(inset)}px`,
      );
    }
  }

  /** Left edge of the right-hand sidebar (collapses/expands, so measured). */
  #sidebarLeft(): number {
    const el =
      document.getElementById("sidebar") ??
      (ui.sidebar?.element instanceof HTMLElement
        ? ui.sidebar.element
        : null) ??
      (document.querySelector("#ui-right") as HTMLElement | null);
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 ? r.left : window.innerWidth;
  }

  /** Right edge of the (thin) left scene-controls toolbar. */
  #controlsRight(): number {
    const el =
      (document.querySelector("#scene-controls") as HTMLElement | null) ??
      (document.getElementById("controls") as HTMLElement | null);
    const r = el?.getBoundingClientRect();
    // Guard against matching a wide wrapper — the toolbar itself is narrow.
    return r && r.width > 0 && r.width < 200 ? r.right : 60;
  }

  /** Top edge of the macro hotbar (so a bottom / side dock clears it). */
  #hotbarTop(): number {
    const el =
      document.getElementById("hotbar") ??
      (document.querySelector("#ui-bottom") as HTMLElement | null);
    const r = el?.getBoundingClientRect();
    return r && r.height > 0 ? r.top : window.innerHeight;
  }

  /* ------------------------------------------------ state I/O ----------- */

  #read(): CastBarData {
    return readCastBar(canvas?.scene ?? null, this.#cfg.flag);
  }

  /** Write to the current scene. The `updateScene` broadcast re-renders every
   *  client (including us), so callers don't render directly. */
  async #write(data: CastBarData): Promise<void> {
    const scene = canvas?.scene;
    if (!scene) return;
    await writeCastBar(scene, this.#cfg.flag, data);
  }

  async #setVisible(v: boolean): Promise<void> {
    if (!canControl()) return;
    const d = this.#read();
    d.visible = v;
    await this.#write(d);
  }

  async #onDrop(event: DragEvent): Promise<void> {
    if (!canControl()) return;
    const data = parseDrop(event);
    if (!data || (data.type !== "Actor" && data.type !== "Item")) return;
    event.preventDefault();
    event.stopPropagation();
    // Choose the image FIRST — the plate isn't created/shown until Profile/Token
    // is chosen, or (Custom) a file is actually picked. Cancelling anywhere adds
    // nothing.
    const choice = await pickImageSource();
    if (!choice) return;
    let art: "profile" | "token" = "profile";
    let img: string | undefined;
    if (choice === "custom") {
      img = await pickImageFile();
      if (!img) return; // file picker closed without a selection → don't add
    } else {
      art = choice; // "profile" | "token"
    }
    // Names start HIDDEN on first add, but the choice is remembered per-actor
    // (see #toggleName) — so re-adding an actor whose name was revealed keeps it
    // revealed rather than defaulting to hidden again.
    const doc = (await fromUuid(data.uuid).catch(() => null)) as {
      getFlag?: (m: string, k: string) => unknown;
    } | null;
    const remembered = doc?.getFlag?.(MODULE_ID, FLAGS.castNameHidden);
    const nameHidden = typeof remembered === "boolean" ? remembered : true;
    // A TOKEN-art plate is standing in for the token itself, and a token on the
    // canvas shows its status icons to the whole table — so it starts at the third
    // of the three reveal states (on, and public) rather than off. Profile art is
    // a portrait for a conversation, where a condition is still the GM's to give
    // out, so that keeps the off default.
    //
    // Only the STARTING state: the menu's three-state reveal owns it from then
    // on, and switching an existing plate to token art through the art editor
    // deliberately does NOT re-decide it — that would overwrite a choice the GM
    // had already made.
    const asToken = art === "token";
    const d = this.#read();
    d.plates.push({
      id: foundry.utils.randomID(),
      uuid: data.uuid,
      art,
      img,
      exited: false,
      hidden: false,
      nameHidden,
      conditions: asToken,
      conditionsPublic: asToken,
    });
    d.visible = true; // dropping a character shows the bar
    await this.#write(d);
  }

  /** This bar's element id — also its identity in the hover tracking above. */
  get id(): string {
    return this.#cfg.elId;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** Is this bar currently shown (for everyone — it is scene state)? */
  get visible(): boolean {
    return this.#read().visible === true;
  }

  /** Show/hide this bar for everyone (the tab, the × and the keybinding all
   *  land here). Public so `castToggleVisible` can reach it. */
  async toggleVisible(): Promise<void> {
    await this.#setVisible(!this.#read().visible);
  }

  /** Set it outright rather than flipping it — what the all-bars key needs, so
   *  that two bars in different states end up agreeing. */
  async setVisible(v: boolean): Promise<void> {
    await this.#setVisible(v);
  }

  /** Apply one of the hover-control actions to a plate by id. A single public
   *  entry point rather than a wrapper per action, so the keybindings in
   *  `module.ts` can reach the private mutators without the class growing a
   *  method for each. Every one of these is permission-gated inside. */
  async plateAction(id: string, action: PlateAction): Promise<void> {
    switch (action) {
      case "speaker":
        return this.#setSpeaker(id);
      case "name":
        return this.#toggleName(id);
      case "remove":
        return this.#remove(id);
      case "exited":
        return this.#mutate(id, (p) => (p.exited = !p.exited));
      case "hidden":
        return this.#mutate(id, (p) => (p.hidden = !p.hidden));
      case "stats":
        return this.#mutate(id, (p) => (p.stats = !p.stats));
      case "conditions":
        this.openConditions(id);
        return;
      case "combat":
        return this.#toggleCombat(id);
      case "menu":
        this.openMenu(id);
        return;
      case "art":
        return this.#editArt(id);
    }
  }

  /** Open the art editor for a plate and store whatever comes back.
   *
   *  Writes all four art fields together rather than merging: the editor shows
   *  the complete set, so an empty slot is a deliberate "none", not an omission.
   *  Merging would make clearing an image impossible. */
  async #editArt(id: string): Promise<void> {
    if (!canControl()) return;
    const p = this.#read().plates.find((x) => x.id === id);
    if (!p) return;
    const doc = (await fromUuid(p.uuid).catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!doc) return;
    const token = (
      doc.prototypeToken as { texture?: { src?: string } } | undefined
    )?.texture?.src;
    const art = await openPlateArt(
      { art: p.art ?? "profile", img: p.img, imgInjured: p.imgInjured, imgCritical: p.imgCritical },
      String(doc.name ?? ""),
      docImg(doc),
      String(token ?? ""),
    );
    if (!art) return;
    await this.#mutate(id, (x) => {
      x.art = art.art;
      // DELETE rather than assign undefined: the roster is persisted as a scene
      // flag, and a key set to undefined is not the same as an absent one on the
      // way through serialisation. Clearing an image has to actually clear it.
      for (const k of ["img", "imgInjured", "imgCritical"] as const) {
        if (art[k]) x[k] = art[k];
        else delete x[k];
      }
    });
  }

  /** The rendered element for a plate id, or null. Both panels anchor to the
   *  PLATE rather than to the control that opened them: the control is 16–22px
   *  and sits inside the plate, so anchoring there would put the panel over the
   *  face it belongs to. */
  #plateEl(id: string): HTMLElement | null {
    return (
      this.#strip?.querySelector<HTMLElement>(
        `.bivouac-plate[data-id="${CSS.escape(id)}"]`,
      ) ?? null
    );
  }

  /** Open the condition palette over a plate. Unlike the other plate actions
   *  this writes to the ACTOR, not the roster, so it goes nowhere near
   *  `#mutate` — nothing about the plate itself changes. */
  openConditions(id: string): void {
    if (!canControl()) return;
    const el = this.#plateEl(id);
    const uuid = el?.dataset.uuid;
    if (!el || !uuid) return;
    const doc = fromUuidSync(uuid) as Record<string, unknown> | null;
    // The SCENE actor, for the same reason the plate reads from it: for an
    // unlinked NPC the sidebar prototype is a different document, and applying a
    // condition to it would change nothing the plate is showing.
    const live = doc ? (sceneActor(doc) as Record<string, unknown>) : null;
    openConditionPalette(el, live, `${this.id}:conds:${id}`);
  }

  /**
   * Put a plate's character into the encounter, or take them out.
   *
   * Acts on the SCENE actor for the same reason everything else does: combat is
   * a property of tokens in the scene, and for an unlinked NPC the sidebar
   * prototype is a different document.
   *
   * The `no-token` case is the one worth a word to the GM rather than a silent
   * no-op. A plate holds an Actor uuid, not a token, so a plated character need
   * not be in the scene at all — and there is nothing for Foundry to make a
   * combatant out of. The notification names the setting that fixes it, because
   * "nothing happened" is otherwise indistinguishable from a broken button.
   */
  async #toggleCombat(id: string): Promise<void> {
    if (!canControl()) return;
    const el = this.#plateEl(id);
    const uuid = el?.dataset.uuid;
    if (!uuid) return;
    const doc = fromUuidSync(uuid) as Record<string, unknown> | null;
    if (!doc) return;
    const result = await toggleCombat(sceneActor(doc));
    if (result === "no-token") {
      // Two different situations, and pointing at the wrong one is worse than
      // saying less. With the setting OFF, turning it on is the fix and the
      // message should say so. With it ON, this plate is one the pass cannot
      // cover — a compendium actor, an Item, or a scene whose sync has not run —
      // and telling a GM to switch on something already switched on reads as a
      // broken module.
      let managed = false;
      try {
        managed = !!game.settings.get(MODULE_ID, SETTINGS.castPlateTokens);
      } catch {
        /* not registered yet — treat as off, which gives the actionable text */
      }
      ui.notifications?.warn(
        game.i18n.localize(
          managed
            ? "BIVOUAC.CastBar.CombatNoTokenManaged"
            : "BIVOUAC.CastBar.CombatNoToken",
        ),
      );
    } else if (result === "failed")
      ui.notifications?.warn(game.i18n.localize("BIVOUAC.CastBar.CombatFailed"));
    // Foundry's own combat hooks drive the redraw, so the button restates itself
    // without this having to; see the createCombatant/deleteCombatant wiring.
  }

  /** Open the plate menu — the occasional settings, gathered off the bar. */
  openMenu(id: string): void {
    if (!canControl()) return;
    const el = this.#plateEl(id);
    const plate = this.#read().plates.find((p) => p.id === id);
    if (!el || !plate) return;
    const doc = plate.uuid
      ? (fromUuidSync(plate.uuid) as Record<string, unknown> | null)
      : null;
    openPlateMenu(
      el,
      this,
      plate,
      String(doc?.name ?? game.i18n.localize("BIVOUAC.CastBar.Missing")),
    );
  }

  async #remove(id: string): Promise<void> {
    if (!canControl()) return;
    const d = this.#read();
    d.plates = d.plates.filter((p) => p.id !== id);
    if (d.speakerId === id) d.speakerId = null;
    await this.#write(d);
  }

  /** Set the conditions reveal to one of its three meaningful states.
   *
   *  The data is two booleans, but only three of their four combinations mean
   *  anything — `conditionsPublic` with `conditions` off is "reveal something
   *  that isn't being shown". The menu offers the three and this writes both
   *  fields together, so the fourth is never reachable. */
  async setConditionReveal(
    id: string,
    conditions: boolean,
    publicly: boolean,
  ): Promise<void> {
    await this.#mutate(id, (p) => {
      p.conditions = conditions;
      p.conditionsPublic = conditions && publicly;
    });
  }

  async #setSpeaker(id: string): Promise<void> {
    if (!canControl()) return;
    const d = this.#read();
    d.speakerId = d.speakerId === id ? null : id; // click the speaker again to clear
    await this.#write(d);
  }

  /** Apply a mutation to one plate and persist. */
  async #mutate(id: string, fn: (p: Plate) => void): Promise<void> {
    if (!canControl()) return;
    const d = this.#read();
    const p = d.plates.find((x) => x.id === id);
    if (!p) return;
    fn(p);
    await this.#write(d);
  }

  /** Toggle a plate's name visibility, and remember the choice on the actor so
   *  future adds of the same actor reuse it (per-actor default). */
  async #toggleName(id: string): Promise<void> {
    if (!canControl()) return;
    const d = this.#read();
    const p = d.plates.find((x) => x.id === id);
    if (!p) return;
    p.nameHidden = !p.nameHidden;
    await this.#write(d);
    const doc = (await fromUuid(p.uuid).catch(() => null)) as {
      setFlag?: (m: string, k: string, v: unknown) => Promise<unknown>;
    } | null;
    // Best-effort — a non-owner can't persist the actor's default; the plate
    // state still applied above.
    try {
      await doc?.setFlag?.(MODULE_ID, FLAGS.castNameHidden, p.nameHidden);
    } catch {
      /* no permission to write the actor flag */
    }
  }

  async #reorder(
    dragId: string,
    targetId: string,
    after: boolean,
  ): Promise<void> {
    if (!canControl() || dragId === targetId) return;
    const d = this.#read();
    const from = d.plates.findIndex((p) => p.id === dragId);
    if (from < 0) return;
    const [moved] = d.plates.splice(from, 1);
    const ti = d.plates.findIndex((p) => p.id === targetId);
    if (ti < 0) d.plates.push(moved);
    else d.plates.splice(ti + (after ? 1 : 0), 0, moved);
    await this.#write(d);
  }

  /* ------------------------------------------------ render -------------- */

  /** Re-read the current scene's Cast Bar and reflect it. Called on mount, scene
   *  change, and the `updateScene` broadcast. */
  refresh(): void {
    if (!this.#el || !this.#enabled) return;
    const d = this.#read();
    const controller = canControl();
    // "Editing" = a controller with Bivouac Edit Mode on (campground group active).
    const editing = controller && !!worldLayer.editMode;
    // The set this viewer may see: controllers see all; players never see hidden.
    const plates = controller ? d.plates : d.plates.filter((p) => !p.hidden);
    // Optionally hide entirely while a combat is running (edit mode overrides, so
    // the GM can still arrange it mid-combat).
    const inCombatHide =
      !!game.settings.get(MODULE_ID, SETTINGS.castHideInCombat) &&
      !!game.combat?.started;
    // Show the floating plates when the GM has them visible (and there's a plate
    // this viewer may see); a controller also sees the drop-zone whenever editing.
    const show = editing || (!inCombatHide && d.visible && plates.length > 0);
    this.#el.classList.toggle("bivouac-castbar--open", show);
    this.#el.classList.toggle("bivouac-castbar--editable", controller); // hover controls
    this.#el.classList.toggle("bivouac-castbar--editing", editing); // drop-zone chrome
    // While editing, a hidden bar still shows (so you can arrange it) but is dimmed,
    // so the hide button gives clear feedback without removing the drop-zone.
    this.#el.classList.toggle("bivouac-castbar--dimmed", editing && !d.visible);
    // Hide the toggle tab too during combat-hide — it can't open the bar then.
    if (this.#tab)
      this.#tab.style.display = inCombatHide && !editing ? "none" : "";
    this.#tab?.classList.toggle("bivouac-castbar-tab--open", show);
    this.#tab?.setAttribute("aria-pressed", String(d.visible));
    // The eye button reflects (and toggles) the current player-visibility.
    if (this.#closeBtn) {
      const icon = this.#closeBtn.querySelector("i");
      if (icon)
        icon.className = d.visible
          ? "fa-solid fa-eye"
          : "fa-solid fa-eye-slash";
      this.#closeBtn.title = game.i18n.localize(
        d.visible ? "BIVOUAC.CastBar.Close" : "BIVOUAC.CastBar.Reveal",
      );
    }
    // An open condition palette outlives the plate rebuild below (it is parented
    // to the interface, not the plate), so it has to be restated here — this is
    // the call the ActiveEffect hooks make when a condition lands.
    repaintPopover();
    // Always (re)build from the permitted set, so a player's DOM never contains a
    // hidden plate. NOTE: the plate *data* still lives in the scene flag Foundry
    // broadcasts to all clients — a determined player could read it there. True
    // send-side filtering needs a GM socket relay (documented follow-up).
    this.#render(d, controller, plates, editing);
  }

  /** Re-render if any plate references the changed document (live actor art/name). */
  refreshActor(uuid: string): void {
    if (this.#read().plates.some((p) => p.uuid === uuid)) this.refresh();
  }

  #render(
    d: CastBarData,
    controller: boolean,
    plates: Plate[],
    editing: boolean,
  ): void {
    const strip = this.#strip;
    if (!strip) return;
    strip.replaceChildren();
    if (!plates.length) {
      // Only in edit mode do we show a prompt (the drop zone) — otherwise the
      // empty area stays invisible.
      if (editing) {
        const empty = document.createElement("p");
        empty.className = "bivouac-castbar__empty";
        empty.textContent = game.i18n.localize("BIVOUAC.CastBar.Empty");
        strip.appendChild(empty);
      }
      this.#fit();
      return;
    }
    for (const p of plates)
      strip.appendChild(this.#renderPlate(p, d, controller));
    this.#fit(); // scale plates down if the cast would exceed the available width
  }

  /** Overlay the Actor's enabled stats (AC / passive perception / HP / passive
   *  investigation) on a plate, if the plate has stats toggled on. Only stats the
   *  GM has enabled and that resolve to a value are shown.
   *
   *  CONTROLLERS ONLY — a player never draws this, not even for their own
   *  character. The overlay is a GM's reference tool, and a player who watches it
   *  appear can tell the moment they are being looked up: flicking it on to check
   *  a passive perception announced the check to the table. Unlike the conditions
   *  overlay there is deliberately NO reveal state and no `canView` escape hatch —
   *  the actor a GM most often checks is a PC, so the one player who would pass
   *  `canView` is precisely the one who must not see it.
   *
   *  Gated on `canControl()` (threaded in as `controller`) rather than `isGM` so
   *  the audience that SEES it matches the audience that can TOGGLE it — the hover
   *  controls are controller-only. Nobody can switch on something they can't see,
   *  and anyone who can see it can switch it off.
   *
   *  Known limit: `plate.stats` still lives on the Scene flag Foundry broadcasts,
   *  so the toggle itself stays inferable by a player reading scene updates.
   *  Closing that means holding the state client-side per GM, at the cost of it no
   *  longer following the GM between browsers — see BACKLOG.md. */
  #renderStats(
    el: HTMLElement,
    plate: Plate,
    doc: Record<string, unknown> | null,
    controller: boolean,
  ): void {
    el.querySelector(".bivouac-plate__stats")?.remove();
    if (!plate.stats || !doc || !controller) return;
    // Whatever the active system adapter exposes — not a fixed dnd5e four. A stat
    // whose `read` returns null doesn't apply to this actor (wrong actor type, or
    // absent), so its row is simply skipped. Shared with the Mini Sheet tile.
    const all = visibleStats(doc);
    const cap = STAT_CAP[this.#tier];
    if (!all.length || !cap) return;
    // At the tighter tiers keep the HEALTH row rather than the first row: which
    // stats are enabled, and in what order, is the GM's choice, and "how hurt is
    // this character" is the one that earns the last remaining line. Falls back to
    // simple truncation on a system with no health row to prefer.
    const ordered =
      cap < all.length
        ? [...all].sort(
            (a, b) => Number(!!b.stat.health) - Number(!!a.stat.health),
          )
        : all;
    const rows = ordered.slice(0, cap);
    const box = document.createElement("div");
    box.className = "bivouac-plate__stats";
    // Nothing is dropped silently — the rows that didn't fit are named on hover,
    // the same courtesy the conditions overflow gets from its "+n".
    if (ordered.length > cap)
      box.dataset.tooltip = ordered
        .slice(cap)
        .map((r) => `${game.i18n.localize(r.stat.label)} ${formatStat(r.val)}`)
        .join(" · ");
    for (const { stat, val: v } of rows) {
      const row = document.createElement("div");
      row.className = `bivouac-plate__stat bivouac-plate__stat--${stat.key}`;
      // Marks the one row the size ladder keeps when the plate is too small for
      // the full set. Which row that is comes from the adapter (or from a GM's
      // custom row), not from a hard-coded key — so it is the right row on
      // dnd5e, on Daggerheart, and on a system with no adapter at all.
      if (stat.health) row.classList.add("bivouac-plate__stat--health");
      // Pools show `value/max`, so a Daggerheart plate reads "3/6" rather than a
      // bare "3" that gives no sense of scale — and `reverse` marks the ones where
      // a rising number is bad (damage and stress are MARKED upward), so the CSS
      // can colour them without re-deriving that per system.
      if (v.reverse) row.classList.add("bivouac-plate__stat--reverse");
      const text = formatStat(v);
      row.innerHTML = `<i class="fa-solid ${stat.icon}"></i><span></span>`;
      row.querySelector("span")!.textContent = text;
      row.dataset.tooltip = game.i18n.localize(stat.label);
      box.appendChild(row);
    }
    el.appendChild(box);
  }

  /** The actor's conditions and running effects, as icons.
   *
   *  Unlike the stats this is CORE Foundry, not system data — status ids, their
   *  art, and the actor's ActiveEffects — so it needs no per-system adapter to
   *  work anywhere. `conditionBadges()` decides what belongs here: the status
   *  conditions, plus TEMPORARY effects that grant no status, with a status's
   *  label enriched from the effect that granted it so a plate reads
   *  "Concentrating: Hunter's Mark" rather than a bare "Concentrating".
   *
   *  Capped per size tier, with a "+n" overflow: a plate already shares its face
   *  with the stats overlay, the name banner and the raised-hand badge, and a
   *  stunned-and-cursed boss with nine effects would otherwise bury the portrait.
   *  The cap is arithmetic — the `+n` has to count what was left out — which is
   *  why it lives here rather than in the tier CSS with the rest of the ladder. */
  #renderConditions(
    el: HTMLElement,
    plate: Plate,
    doc: Record<string, unknown> | null,
  ): void {
    el.querySelector(".bivouac-plate__conds")?.remove();
    const cap = CONDITION_CAP[this.#tier];
    if (!plate.conditions || !doc || !cap) return;
    // Conditions on an NPC are GM information — who's poisoned or concentrating
    // is exactly what a table plays to find out — so revealing them is a
    // PER-PLATE decision (three states in the plate menu: off, you, everyone).
    //
    // Two ways a player may see them: the GM marked this plate public, or the
    // player could already find out anyway by opening the sheet. The second
    // clause is what stops the switch being busywork for the party's own plates —
    // it only ever has to be used to reveal something a player couldn't otherwise
    // know. (Core Foundry has no per-effect "hide from players" flag to honour,
    // so the plate is the right place for this.)
    if (!game.user?.isGM && !plate.conditionsPublic && !canView(doc)) return;
    // Status conditions AND temporary ActiveEffects — see `conditionBadges`. The
    // decision of WHAT to show lives there, next to the rest of the fragile
    // Foundry probes; this only draws the answer.
    const found = conditionBadges(doc);
    if (!found.length) return;

    const box = document.createElement("div");
    box.className = "bivouac-plate__conds";
    for (const b of found.slice(0, cap)) {
      // A levelled status shows its LEVEL on the icon — an exhausted character
      // is 1 or 6, and which of those it is decides everything about the scene.
      // `statusLevel` is null for every status but the levelled one, and for a
      // levelled one the actor does not have, so the number is only ever drawn
      // where it means something.
      const lvl = b.status ? statusLevel(doc, b.status) : null;
      const label = lvl ? `${b.label} ${lvl}` : b.label;
      const icon = document.createElement("img");
      icon.className = b.effect
        ? "bivouac-plate__cond bivouac-plate__cond--effect"
        : "bivouac-plate__cond";
      icon.src = b.img;
      icon.alt = "";
      icon.dataset.tooltip = label;
      if (!lvl) {
        box.appendChild(icon);
        continue;
      }
      // Wrapped, because the number has to sit ON the icon and the strip is a
      // flex row of icons: a bare <span> after the <img> would become the next
      // item in the row instead of an overlay on this one.
      const wrap = document.createElement("span");
      wrap.className = "bivouac-plate__condwrap";
      wrap.dataset.tooltip = label;
      const num = document.createElement("span");
      num.className = "bivouac-plate__condlvl";
      num.textContent = String(lvl);
      wrap.append(icon, num);
      box.appendChild(wrap);
    }
    if (found.length > cap) {
      const more = document.createElement("span");
      more.className = "bivouac-plate__cond-more";
      more.textContent = `+${found.length - cap}`;
      more.dataset.tooltip = found
        .slice(cap)
        .map((b) => {
          const lvl = b.status ? statusLevel(doc, b.status) : null;
          return lvl ? `${b.label} ${lvl}` : b.label;
        })
        .join(", ");
      box.appendChild(more);
    }
    el.appendChild(box);
  }

  /** Show a raised-hand badge (top-right) when a player who OWNS this actor has
   *  their hand up (via an active raised-hand module). */
  /** Whether a NON-GM user who OWNS this actor currently has their hand raised. */
  #handUp(doc: Record<string, unknown> | null): boolean {
    if (!doc) return false;
    const raised = raisedHandUserIds();
    if (!raised.size) return false;
    const ownership =
      (doc.ownership as Record<string, number> | undefined) ?? {};
    const OWNER = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    const test = (
      doc as { testUserPermission?: (u: unknown, p: string) => boolean }
    ).testUserPermission;
    return [...raised].some((uid) => {
      const user = game.users?.get?.(uid);
      if (!user || user.isGM) return false;
      return test
        ? !!test.call(doc, user, "OWNER")
        : (ownership[uid] ?? 0) >= OWNER;
    });
  }

  /** Add/remove the hand overlay ONLY on a real state change, so frequent updates
   *  don't restart the wave animation or churn the DOM. */
  #renderHand(el: HTMLElement, doc: Record<string, unknown> | null): void {
    const up = this.#handUp(doc);
    const existing = el.querySelector(".bivouac-plate__hand");
    if (up && !existing) {
      const hand = document.createElement("div");
      hand.className = "bivouac-plate__hand";
      hand.innerHTML = `<i class="fa-solid fa-hand"></i>`;
      el.appendChild(hand);
    } else if (!up && existing) {
      existing.remove();
    }
  }

  /** Update just the hand overlays in place (no plate rebuild) — used for
   *  raise/lower so nothing flashes and the wave animation keeps running. */
  refreshHands(): void {
    this.#strip
      ?.querySelectorAll<HTMLElement>(".bivouac-plate")
      .forEach((el) => {
        const uuid = el.dataset.uuid;
        const doc = uuid
          ? (fromUuidSync(uuid) as Record<string, unknown> | null)
          : null;
        this.#renderHand(el, doc);
      });
  }

  /** Toggle the speaker highlight in the DOM without a full re-render — used for
   *  instant, optimistic feedback on click, ahead of the scene-flag write. */
  #applySpeakerHighlight(id: string | null): void {
    this.#strip
      ?.querySelectorAll<HTMLElement>(".bivouac-plate")
      .forEach((n) => {
        n.classList.toggle("bivouac-plate--speaker", n.dataset.id === id);
      });
  }

  #renderPlate(plate: Plate, d: CastBarData, controller: boolean): HTMLElement {
    const el = document.createElement("div");
    el.className = "bivouac-plate";
    el.dataset.id = plate.id;
    el.dataset.uuid = plate.uuid; // for targeted hand updates without a full re-render
    if (d.speakerId === plate.id) el.classList.add("bivouac-plate--speaker");
    if (plate.exited) el.classList.add("bivouac-plate--exited");
    if (plate.hidden) el.classList.add("bivouac-plate--hidden"); // controllers only reach here

    const img = document.createElement("img");
    img.className = "bivouac-plate__img";
    el.appendChild(img);

    const name = document.createElement("span");
    name.className = "bivouac-plate__name";
    el.appendChild(name);

    // Fill in art + name from the document; keep a handle so dblclick can open
    // the sheet.
    let doc: Record<string, unknown> | null = null;
    const fill = (resolved: Record<string, unknown> | null): void => {
      doc = resolved;
      if (!doc) {
        el.classList.add("bivouac-plate--missing");
        name.textContent = game.i18n.localize("BIVOUAC.CastBar.Missing");
        return;
      }
      const token = (
        doc.prototypeToken as { texture?: { src?: string } } | undefined
      )?.texture?.src;
      const base =
        plate.img || (plate.art === "token" && token ? token : docImg(doc));
      img.alt = String(doc.name ?? "");
      if (plate.nameHidden && !controller) {
        name.textContent = "?";
        name.classList.add("bivouac-plate__name--q");
      } else {
        name.textContent = String(doc.name ?? "");
        if (plate.nameHidden) name.classList.add("bivouac-plate__name--hidden"); // greyed, GM view
      }
      if (canView(doc)) el.classList.add("bivouac-plate--interactive");
      // Read the numbers and the conditions off the actor AS IT EXISTS IN THE
      // SCENE. A plate stores an `Actor.<id>` uuid, which resolves to the sidebar
      // prototype — but an unlinked token keeps its own actor, and everything
      // that happens to it in play (damage, conditions) is written there. Without
      // this the plate showed the state the actor had before it was ever placed.
      // The name, portrait and sheet-opening deliberately stay on `doc`: those
      // are the actor's identity, and the token's copy can carry a renamed or
      // re-arted duplicate.
      const live = sceneActor(doc);
      // Wounded states read the SCENE actor for the same reason the stats do: the
      // sidebar prototype of an unlinked NPC is at full health no matter what has
      // happened to it in play, which would make this show nothing exactly when
      // it matters. Health is a live number or it is decoration.
      const wound = woundState(live);
      // Art for the state, if the plate has any. A critical character with only
      // INJURED art keeps showing that rather than dropping back to healthy — the
      // nearer-to-death picture is the safer one to be wrong with.
      const woundImg =
        wound === "critical"
          ? (plate.imgCritical ?? plate.imgInjured)
          : wound === "injured"
            ? plate.imgInjured
            : undefined;
      img.src = woundImg || base;
      if (wound) el.classList.add(`bivouac-plate--${wound}`);
      // Dedicated art IS the signal, so the tint stands down for it. Without this
      // a GM who drew a bloodied portrait would get it washed red on top.
      el.querySelector(".bivouac-plate__wound")?.remove();
      if (woundImg) {
        el.classList.add("bivouac-plate--wound-art");
      } else if (wound) {
        const tint = document.createElement("div");
        tint.className = "bivouac-plate__wound";
        el.appendChild(tint);
      }
      this.#renderStats(el, plate, live, controller);
      this.#renderConditions(el, plate, live);
      this.#renderHand(el, doc);
    };
    // World docs (sidebar actors) resolve synchronously → no placeholder flash on
    // re-render. Compendium / not-yet-loaded docs fall back to async.
    const sync = fromUuidSync(plate.uuid) as { documentName?: string } | null;
    if (sync && sync.documentName) {
      fill(sync as Record<string, unknown>);
    } else {
      img.src = "icons/svg/mystery-man.svg";
      void fromUuid(plate.uuid)
        .then((r) => fill((r as Record<string, unknown> | null) ?? null))
        .catch(() => fill(null));
    }

    // Track which plate the pointer is over, so the keybindings have a target.
    el.addEventListener("pointerenter", () => {
      hoveredPlate = { barId: this.id, plateId: plate.id };
    });
    el.addEventListener("pointerleave", () => {
      if (hoveredPlate?.plateId === plate.id) hoveredPlate = null;
    });

    // One action per mouse button, one click each: LEFT opens the sheet (anyone
    // who may view it), RIGHT toggles the speaker (controllers).
    //
    // Both used to live on the left button — single click set the speaker, double
    // opened the sheet — so every click had to be held back to see whether a
    // second was coming. A considered re-click meant to turn Speaking Mode back
    // OFF got swallowed as a double-click: it opened a sheet nobody asked for and
    // cancelled the speaker change, which then had to be undone after the fact,
    // and that undo was broadcast to every player. Giving each action its own
    // button removes the whole problem rather than tuning it: there is nothing to
    // time, nothing to debounce and nothing to revert.
    el.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      // The controls always have their own handlers; the name only has one for
      // controllers, so for a player the name is just part of the plate.
      if (target.closest(".bivouac-plate__controls")) return;
      if (controller && target.closest(".bivouac-plate__name")) return;
      if (doc && canView(doc)) (doc.sheet as { render?: (b: boolean) => void })?.render?.(true);
    });

    // Right-click toggles the speaker. `preventDefault` runs only when we
    // actually act on the click, so a player — who has no speaker control — keeps
    // their normal browser menu instead of having it silently swallowed.
    el.addEventListener("contextmenu", (e) => {
      const target = e.target as HTMLElement;
      if (!controller || target.closest(".bivouac-plate__controls")) return;
      e.preventDefault();
      // The highlight moves IMMEDIATELY (optimistic) so it feels instant, then
      // the write broadcasts it.
      const makeSpeaker = !el.classList.contains("bivouac-plate--speaker");
      this.#applySpeakerHighlight(makeSpeaker ? plate.id : null);
      void this.#setSpeaker(plate.id);
    });

    if (controller) {
      // Click the name → toggle whether players see it (they get "?").
      name.classList.add("bivouac-plate__name--editable");
      name.title = game.i18n.localize("BIVOUAC.CastBar.NameToggle");
      name.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.#toggleName(plate.id);
      });
      // Hover hint: a "?" badge over the name makes it obvious that clicking hides
      // it (CSS reveals it on name hover, only while the name is currently shown).
      const hint = document.createElement("span");
      hint.className = "bivouac-plate__namehint";
      hint.textContent = "?";
      hint.setAttribute("aria-hidden", "true");
      el.appendChild(hint);
      el.appendChild(this.#controls(plate, el));
      this.#wireReorderTarget(el, plate.id);
    }

    return el;
  }

  /**
   * The hover control bar: reorder grip · exit/enter · conditions · menu.
   *
   * Four items, where there were seven. A portrait plate at the default size has
   * 144px of usable bar and seven 22px buttons plus the grip needed 161px, so the
   * bar could not fit its own contents at the DEFAULT size on the DEFAULT shape —
   * it wrapped onto a second row across the top of the portrait. Four items come
   * to ~89px, which fits every plate shape with room for the size ladder to thin
   * it further.
   *
   * What stayed is what gets used mid-conversation; what moved into the menu is
   * what gets set up once. Speaker is not here at all and never was — it is a
   * right-click on the plate face, which is the most-used action of the lot and
   * so deserves the largest target rather than a 22px one.
   *
   * Every control the menu absorbed keeps its keybinding, so nothing became
   * unreachable — which is also what makes the `min` and `none` tiers safe.
   */
  #controls(plate: Plate, el: HTMLElement): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "bivouac-plate__controls";

    const grip = document.createElement("span");
    grip.className = "bivouac-plate__grip";
    grip.draggable = true;
    grip.title = game.i18n.localize("BIVOUAC.CastBar.Reorder");
    grip.innerHTML = `<i class="fa-solid fa-grip"></i>`;
    grip.addEventListener("dragstart", (e) => {
      this.#dragId = plate.id;
      el.classList.add("bivouac-plate--dragging");
      e.dataTransfer?.setData("text/plain", plate.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    grip.addEventListener("dragend", () => {
      this.#dragId = null;
      el.classList.remove("bivouac-plate--dragging");
      this.#clearDropMarks();
    });
    bar.appendChild(grip);

    // `icon` is either a Font Awesome class (`fa-…`) or an image path. A path is
    // recognised by containing a slash, which no FA class does — that lets a
    // control borrow one of Foundry's own `CONFIG.controlIcons` and sit beside the
    // FA ones without a second helper or a second call shape.
    const btn = (
      icon: string,
      titleKey: string,
      cls: string,
      on: () => void,
    ): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `bivouac-plate__ctrl ${cls}`.trim();
      b.title = game.i18n.localize(titleKey);
      if (icon.includes("/")) {
        const img = document.createElement("img");
        img.src = icon;
        img.alt = "";
        b.appendChild(img);
      } else {
        b.innerHTML = `<i class="fa-solid ${icon}"></i>`;
      }
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        on();
      });
      bar.appendChild(b);
      return b;
    };

    // Exit / rejoin the conversation — the one plate state that changes while
    // people are actually talking.
    btn(
      plate.exited
        ? "fa-arrow-right-to-bracket"
        : "fa-arrow-right-from-bracket",
      plate.exited ? "BIVOUAC.CastBar.Enter" : "BIVOUAC.CastBar.Exit",
      "bivouac-plate__ctrl--exit",
      () => void this.#mutate(plate.id, (p) => (p.exited = !p.exited)),
    );

    // Enter / leave the encounter, beside the exit-the-conversation button — the
    // two are the same kind of decision about where a character stands, one in
    // the fiction and one in the initiative order, and a conversation turning
    // into a fight is exactly when you reach for both.
    //
    // Lit while the character IS in the encounter, and unlike the conditions
    // control it has a real on/off state to show. It wears Foundry's own
    // `CONFIG.controlIcons.combat` for the same reason the conditions button
    // wears `.effects`: this is the token HUD's job, done from a plate, so it
    // should not need a second symbol learning.
    // Resolved here rather than handed in from `fill()`: the controls are built
    // before the async resolve path finishes, and a compendium actor that cannot
    // resolve synchronously cannot be in a scene's combat either — so `false` is
    // the correct answer in exactly the cases this returns null for.
    const resolved = fromUuidSync(plate.uuid) as Record<string, unknown> | null;
    const fighting = inCombat(resolved ? sceneActor(resolved) : null);
    btn(
      String(CONFIG?.controlIcons?.combat ?? "icons/svg/combat.svg"),
      fighting ? "BIVOUAC.CastBar.CombatLeave" : "BIVOUAC.CastBar.CombatEnter",
      `${CTRL_COMBAT}${fighting ? " bivouac-plate__ctrl--active" : ""}`,
      () => void this.#toggleCombat(plate.id),
    );

    // The condition palette. A plain LEFT-click now: it was briefly a right-click
    // on the reveal button, which was only ever a way to avoid a seventh control.
    // With the reveal moved into the menu the button does one thing on one click,
    // like every other control here.
    //
    // Deliberately carries no active/lit state. A lit button reads as "this is
    // switched on", and this one is an action, not a toggle — what conditions are
    // applied is shown by the plate's own icons, and whether they are revealed to
    // players is shown in the menu.
    //
    // It wears Foundry's OWN status-effects icon — `CONFIG.controlIcons.effects`,
    // which is `icons/svg/aura.svg` out of the box — because this button does the
    // same job as the effects control on the token HUD, and a GM should not have
    // to learn a second symbol for it. Read from CONFIG rather than hard-coded so
    // that a system or module which re-points that icon moves this one with it,
    // which is what "the same as on tokens" actually means in a given world.
    btn(
      String(CONFIG?.controlIcons?.effects ?? "icons/svg/aura.svg"),
      "BIVOUAC.CastBar.CondsApply",
      CTRL_CONDS,
      () => this.openConditions(plate.id),
    );

    // Everything occasional. Lit when the plate is in a non-default state the bar
    // no longer shows a button for, so a hidden or stat-showing plate is still
    // legible at a glance without opening the menu to find out.
    const flagged =
      !!plate.hidden || !!plate.stats || !!plate.conditions || plate.nameHidden;
    btn(
      "fa-ellipsis",
      "BIVOUAC.CastBar.MenuOpen",
      `${CTRL_MENU}${flagged ? " bivouac-plate__ctrl--active" : ""}`,
      () => this.openMenu(plate.id),
    );

    return bar;
  }

  /** Make a plate a drop target for reordering: before/after by which half the
   *  pointer is over (along the bar's main axis). */
  #wireReorderTarget(el: HTMLElement, targetId: string): void {
    el.addEventListener("dragover", (e) => {
      if (!this.#dragId) return; // external doc drops fall through to the strip
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const after = this.#vertical()
        ? e.clientY - rect.top > rect.height / 2
        : e.clientX - rect.left > rect.width / 2;
      this.#clearDropMarks();
      el.classList.add(
        after ? "bivouac-plate--drop-after" : "bivouac-plate--drop-before",
      );
      el.dataset.after = String(after);
    });
    el.addEventListener("dragleave", () => this.#clearDropMarks());
    el.addEventListener("drop", (e) => {
      if (!this.#dragId) return;
      e.preventDefault();
      const dragId = this.#dragId;
      const after = el.dataset.after === "true";
      this.#dragId = null;
      this.#clearDropMarks();
      void this.#reorder(dragId, targetId, after);
    });
  }

  #clearDropMarks(): void {
    this.#el
      ?.querySelectorAll(
        ".bivouac-plate--drop-before, .bivouac-plate--drop-after",
      )
      .forEach((n) =>
        n.classList.remove(
          "bivouac-plate--drop-before",
          "bivouac-plate--drop-after",
        ),
      );
  }
}

/** Primary Cast Bar — always on, per-client dock (default right). */
export const castBar = new CastBar({
  flag: FLAGS.castBar,
  dockSetting: SETTINGS.castBarDock,
  tabPosSetting: SETTINGS.castBarTabPos,
  tabPadSetting: SETTINGS.castBarTabPad,
  sizeSetting: SETTINGS.castBarSize,
  scaleSetting: SETTINGS.castBarScale,
  elId: "bivouac-castbar",
  tabId: "bivouac-castbar-tab",
  optional: false,
});

/** Optional second Cast Bar (e.g. NPCs vs party) — its own scene roster + a world
 *  "off/edge" dock; it shares the primary's size / tab-position / tab-padding. */
export const castBar2 = new CastBar({
  flag: FLAGS.castBar2,
  dockSetting: SETTINGS.castBar2Dock,
  tabPosSetting: SETTINGS.castBarTabPos,
  tabPadSetting: SETTINGS.castBarTabPad,
  sizeSetting: SETTINGS.castBarSize,
  scaleSetting: SETTINGS.castBar2Scale,
  elId: "bivouac-castbar-2",
  tabId: "bivouac-castbar-tab-2",
  optional: true,
});

/** Both bars, for mount/refresh fan-out. */
export const castBars = [castBar, castBar2];
