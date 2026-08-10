/**
 * Bivouac — per-system stat adapters.
 *
 * Every stat Bivouac shows used to be hard-coded dnd5e. This is the one place
 * that knows a game system's data shape: the Cast Bar (and anything later, e.g.
 * a mini sheet tile) renders whatever the ACTIVE adapter exposes, rather than a
 * fixed set of four.
 *
 * A stat's `read` returns `null` whenever it doesn't apply — wrong system, wrong
 * actor type, or simply absent — and the caller skips that row. That's what lets
 * one adapter serve several actor types (a Daggerheart adversary has no Hope, an
 * NPC may have no thresholds) without any per-type branching upstream.
 */
import { MODULE_ID, SETTINGS } from "./constants";


/** A value ready to display, plus the context needed to render it honestly. */
export interface StatValue {
  value: number;
  /** Present when the stat is a pool; rendered as `value/max`. */
  max?: number | null;
  /** True when a HIGHER number is WORSE — Daggerheart marks damage upward, so
   *  its Hit Points and Stress count toward a limit rather than down from one.
   *  Rendering can lean on this instead of assuming dnd5e's "bigger is better". */
  reverse?: boolean;
}

export interface StatDef {
  key: string;
  /** The world setting that gates this stat. The dnd5e four deliberately keep
   *  their ORIGINAL keys so existing worlds do not silently lose their choices;
   *  new stats follow the same `castStat…` convention. i18n is derived from it:
   *  `BIVOUAC.Settings.<Pascal>.Name`. */
  setting: string;
  /** i18n key for the tooltip / label. */
  label: string;
  /** Font Awesome icon class. */
  icon: string;
  read(doc: Record<string, unknown>): StatValue | null;
}

export interface SystemAdapter {
  /** Matches `game.system.id`. `generic` is the fallback for anything else. */
  id: string;
  /** i18n key for the settings dropdown. */
  label: string;
  stats: StatDef[];
}

/** Coerce to a finite number, or null — every path below is `unknown` at runtime
 *  because a system can change its schema between versions. */
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function sys(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc.system ?? {}) as Record<string, unknown>;
}

/** Walk a dotted path, returning undefined rather than throwing on a gap. */
function at(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

/* -------------------------------------------- D&D 5e -------------------- */
/** The original four, unchanged — these are the paths the Cast Bar always used. */
const dnd5e: SystemAdapter = {
  id: "dnd5e",
  label: "BIVOUAC.Settings.CastSystem.Dnd5e",
  stats: [
    {
      key: "hp",
      setting: "castStatHP",
      label: "BIVOUAC.Stats.HP",
      icon: "fa-heart",
      read: (d) => {
        const v = num(at(sys(d), "attributes.hp.value"));
        return v == null ? null : { value: v, max: num(at(sys(d), "attributes.hp.max")) };
      },
    },
    {
      key: "ac",
      setting: "castStatAC",
      label: "BIVOUAC.Stats.AC",
      icon: "fa-shield-halved",
      read: (d) => {
        const v = num(at(sys(d), "attributes.ac.value"));
        return v == null ? null : { value: v };
      },
    },
    {
      key: "pp",
      setting: "castStatPP",
      label: "BIVOUAC.Stats.PP",
      icon: "fa-eye",
      read: (d) => {
        const v = num(at(sys(d), "skills.prc.passive"));
        return v == null ? null : { value: v };
      },
    },
    {
      key: "inv",
      setting: "castStatInv",
      label: "BIVOUAC.Stats.Inv",
      icon: "fa-mask",
      read: (d) => {
        const v = num(at(sys(d), "skills.inv.passive"));
        return v == null ? null : { value: v };
      },
    },
  ],
};

/* -------------------------------------------- Daggerheart -------------- */
/**
 * Verified against Foundryborne/daggerheart v2.7.2 (branch `v14`), system id
 * `daggerheart` — `module/data/actor/character.mjs`, `creature.mjs` and
 * `config/resourceConfig.mjs`. Do not "tidy" these paths from memory; the shapes
 * below are deliberate:
 *
 *  • Pools live in `system.resources.<id>.{value,max}`, a TypedObject keyed by
 *    resource id — NOT flat attributes. `max` is `null` in source data when the
 *    resource uses its default, and is filled in during data preparation.
 *  • `hitPoints` and `stress` are declared `reverse: true`: `value` counts damage
 *    or stress MARKED, so it rises toward `max`. Showing it as if it were dnd5e's
 *    remaining HP would invert the meaning, which is why `StatValue.reverse`
 *    exists.
 *  • `hope` is not reversed and has no default max (uncapped unless set).
 *  • The defensive stat is `system.evasion` on a character, but adversaries use
 *    `system.difficulty` instead — both are read, whichever resolves.
 *  • `armorScore` is derived (`persisted: false`) from equipped armor.
 *  • There is no passive Perception or Investigation in Daggerheart at all.
 */
const daggerheart: SystemAdapter = {
  id: "daggerheart",
  label: "BIVOUAC.Settings.CastSystem.Daggerheart",
  stats: [
    {
      key: "dhHp",
      setting: "castStatDhHp",
      label: "BIVOUAC.Stats.DhHP",
      icon: "fa-heart",
      read: (d) => {
        const v = num(at(sys(d), "resources.hitPoints.value"));
        return v == null ? null : { value: v, max: num(at(sys(d), "resources.hitPoints.max")), reverse: true };
      },
    },
    {
      key: "dhStress",
      setting: "castStatDhStress",
      label: "BIVOUAC.Stats.DhStress",
      icon: "fa-bolt",
      read: (d) => {
        const v = num(at(sys(d), "resources.stress.value"));
        return v == null ? null : { value: v, max: num(at(sys(d), "resources.stress.max")), reverse: true };
      },
    },
    {
      key: "dhHope",
      setting: "castStatDhHope",
      label: "BIVOUAC.Stats.DhHope",
      icon: "fa-star",
      read: (d) => {
        const v = num(at(sys(d), "resources.hope.value"));
        return v == null ? null : { value: v, max: num(at(sys(d), "resources.hope.max")) };
      },
    },
    {
      key: "dhEvasion",
      setting: "castStatDhEvasion",
      label: "BIVOUAC.Stats.DhEvasion",
      icon: "fa-person-running",
      read: (d) => {
        // Characters have `evasion`; adversaries express the same idea as
        // `difficulty`. Whichever the actor carries is the number to beat.
        const v = num(at(sys(d), "evasion")) ?? num(at(sys(d), "difficulty"));
        return v == null ? null : { value: v };
      },
    },
    {
      key: "dhArmor",
      setting: "castStatDhArmor",
      label: "BIVOUAC.Stats.DhArmor",
      icon: "fa-shield-halved",
      read: (d) => {
        const v = num(at(sys(d), "armorScore.value"));
        return v == null ? null : { value: v, max: num(at(sys(d), "armorScore.max")) };
      },
    },
  ],
};

/* -------------------------------------------- generic ------------------ */
/** Anything unrecognised: no stats, so the overlay simply doesn't appear rather
 *  than showing zeroes read from paths that don't exist. */
const generic: SystemAdapter = {
  id: "generic",
  label: "BIVOUAC.Settings.CastSystem.Generic",
  stats: [],
};

export const ADAPTERS: readonly SystemAdapter[] = [dnd5e, daggerheart, generic];

/** The adapter for a system id, or the generic fallback. */
export function adapterFor(id: string): SystemAdapter {
  return ADAPTERS.find((a) => a.id === id) ?? generic;
}

/**
 * The adapter in force. Auto-detects from `game.system.id` by default — the
 * world already knows what it's running, so a manual picker would just be one
 * more thing to get wrong. The setting exists as an OVERRIDE, for forcing the
 * generic (no stats) or for a system that's a reskin of one we support.
 *
 * NB: read lazily, never cached — the per-stat settings are registered from this
 * at `init`, so changing it requires a reload (the setting says so).
 */
export function activeAdapter(): SystemAdapter {
  const choice = String(game.settings.get(MODULE_ID, SETTINGS.castSystem) ?? "auto");
  return adapterFor(choice === "auto" ? String(game.system?.id ?? "") : choice);
}

/** i18n key for a stat's gating setting, matching the `BIVOUAC.Settings.<Pascal>`
 *  convention the hand-written settings already use. */
export function statSettingKey(stat: StatDef, part: "Name" | "Hint"): string {
  return `BIVOUAC.Settings.${stat.setting[0].toUpperCase()}${stat.setting.slice(1)}.${part}`;
}
