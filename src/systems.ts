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
import { customStatRows, customStatSetting, readCustomPath } from "./custom-stats";


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
  /** Set on a GM-defined row: its `label` is a literal the GM typed, not an i18n
   *  key, and its toggle setting has no `BIVOUAC.Settings.…` entry to derive a
   *  name from. Renderers can keep calling `game.i18n.localize(label)` either way
   *  — Foundry returns an unknown key unchanged — but `statSettingKey` cannot,
   *  which is what this flag is for. */
  custom?: boolean;
  /** Literal hint for a custom row's toggle (the path it reads), for the same
   *  reason as `custom`: there is no i18n entry to derive one from. */
  hint?: string;
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

/** What a pinned feature can show beyond its name. Every field is optional and
 *  may be null — same contract as `StatDef.read`: a system that has no equivalent
 *  returns null for that field and the renderer simply omits it, rather than the
 *  renderer knowing which systems have what. */
export interface ItemInfo {
  /** Charges / uses remaining. `max` is null when the system doesn't cap it, or
   *  expresses the cap as a formula we deliberately don't evaluate. */
  uses?: { value: number; max: number | null } | null;
  /** Already-localized reference strings, taken from the system's own prepared
   *  labels where it has them — never composed here, or Bivouac would end up
   *  owning a second, worse copy of the system's formatting. */
  activation?: string | null;
  range?: string | null;
  formula?: string | null;
  /** Attack bonus, pre-signed by the system ("+5") — the sheet's ROLL column. */
  attack?: string | null;
}

/** One ability row — the six-across strip a GM reads a monster off. */
export interface StatBlockAbility {
  key: string;
  /** Localized abbreviation ("STR"). */
  label: string;
  score: number | null;
  mod: number | null;
  save: number | null;
  proficient: boolean;
}

/** A named list of trait values (resistances, immunities, …), pre-localized. */
export interface StatBlockTrait {
  key: string;
  label: string;
  values: string[];
}

/** The at-a-glance readout for an actor. Every field is optional and nullable on
 *  the same terms as `StatDef.read`: absent means "this system/actor has no such
 *  thing", and the renderer omits the block rather than showing a zero. */
export interface StatBlock {
  ac?: number | null;
  hp?: { value: number; max: number | null; temp?: number | null } | null;
  /** Already-localized and joined ("Walk 30 ft, Fly 60 ft"). */
  speed?: string | null;
  senses?: string | null;
  /** "CR 5" / "Level 7" — whichever this actor has. */
  rank?: string | null;
  prof?: number | null;
  abilities?: StatBlockAbility[];
  traits?: StatBlockTrait[];
}

export interface SystemAdapter {
  /** Matches `game.system.id`. `generic` is the fallback for anything else. */
  id: string;
  /** i18n key for the settings dropdown. */
  label: string;
  stats: StatDef[];
  /** Reference detail for a pinned Item. Optional: an adapter that doesn't
   *  implement it just means pins stay name-only on that system. */
  itemInfo?(item: Record<string, unknown>): ItemInfo | null;
  /** The full at-a-glance readout for the Mini Sheet. Optional: an adapter
   *  without one falls back to the `stats` rows alone. */
  statblock?(doc: Record<string, unknown>): StatBlock | null;
}

/** Localize a CONFIG entry that may be a bare i18n key, an already-localized
 *  string (dnd5e `preLocalize`s most tables at init), or a `{label}` object.
 *  `game.i18n.localize` returns an unknown key unchanged, so this is safe on all
 *  three without having to know which we got. */
function cfgLabel(v: unknown): string {
  const raw = typeof v === "string" ? v : ((v as { label?: unknown })?.label ?? "");
  return typeof raw === "string" ? game.i18n.localize(raw) : "";
}

/** `CONFIG.DND5E`, or an empty object — read through `globalThis` so this file
 *  never assumes the system is present. */
function dnd5eConfig(): Record<string, unknown> {
  return ((globalThis as { CONFIG?: Record<string, unknown> }).CONFIG?.DND5E ?? {}) as Record<string, unknown>;
}

/** A trait list (`system.traits.<key>`) as localized strings. The value is a Set
 *  in the current schema and an Array in older data, and `custom` is a
 *  semicolon-joined free-text field the GM typed — all three are folded in. */
function dnd5eTrait(
  s: Record<string, unknown>,
  key: string,
  labelKey: string,
  table: Record<string, unknown>,
): StatBlockTrait | null {
  const t = at(s, `traits.${key}`) as { value?: unknown; custom?: unknown } | undefined;
  if (!t) return null;
  const raw = t.value;
  const list = raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw : [];
  const values = list.map((k) => cfgLabel(table[String(k)]) || String(k)).filter(Boolean);
  if (typeof t.custom === "string") {
    for (const c of t.custom.split(";").map((x) => x.trim()).filter(Boolean)) values.push(c);
  }
  return values.length ? { key, label: game.i18n.localize(labelKey), values } : null;
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

/** A non-empty display string, or null. Systems leave prepared labels as `""` (or
 *  drop them entirely) when they don't apply, and an empty chip is worse than no
 *  chip. */
function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
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
  /**
   * Verified against the installed dnd5e 5.3.3 (`dnd5e.mjs`), not from memory:
   *
   *  • `system.uses.value` is DERIVED — `max ? clamp(max - spent, 0, max) : 0`.
   *    The `: 0` is the trap: an item with no uses at all reports `value: 0`, so
   *    reading `value` alone would show every passive feature as "0 left". A real
   *    positive `max` is the only honest test for "this item has charges".
   *  • The prepared labels live on the ITEM, not under `system`, and are built by
   *    `Item5e#_prepareLabels` (dnd5e.mjs:23528) from the item's activities:
   *      – `labels.damages` is an ARRAY of `{formula, label, damageType}`
   *        (dnd5e.mjs:12475). **`labels.damage` is an ACTIVITY field, not an item
   *        one** — reading it off the item is how the first cut of this silently
   *        came back empty for every weapon.
   *      – `labels.attacks` is `[{toHit, modifier}]`, and the first entry is
   *        `Object.assign`ed onto the item (dnd5e.mjs:23559), so `labels.toHit`
   *        ("+5", pre-signed at dnd5e.mjs:28168) is readable directly.
   *      – `labels.activation` / `labels.range` arrive the same way, from
   *        `labels.activations[0]`.
   *    Taking these means Bivouac never re-implements dnd5e's formatting.
   */
  itemInfo: (it) => {
    const max = num(at(sys(it), "uses.max"));
    const value = num(at(sys(it), "uses.value"));
    const labels = (it.labels ?? {}) as Record<string, unknown>;
    // `formula` over `label`: the latter appends the damage type in words
    // ("1d8 + 3 Bludgeoning"), which is too long for a pin. Several damage parts
    // are all rolled together, so they join with "+" the way you'd read them.
    const damages = Array.isArray(labels.damages) ? (labels.damages as Record<string, unknown>[]) : [];
    const formula = damages.map((d) => str(d.formula)).filter(Boolean).join(" + ");
    return {
      uses: max != null && max > 0 && value != null ? { value, max } : null,
      activation: str(labels.activation),
      range: str(labels.range),
      formula: formula || null,
      attack: str(labels.toHit),
    };
  },
  /**
   * The at-a-glance readout. Verified against dnd5e 5.3.3; two shapes here are
   * NOT what an older memory of the system would suggest:
   *
   *  • **`system.abilities.<k>.save` is an OBJECT** — the system computes
   *    `abl.save.value = abl.mod + abl.saveBonus` (dnd5e.mjs). Reading `.save`
   *    directly would hand the renderer an object, not a number. The plain-number
   *    form is kept as a fallback for older data.
   *  • **Movement and senses are FLAT on the actor** (`attributes.movement.walk`,
   *    `attributes.senses.darkvision`). The `movementLabels` / `sensesLabels`
   *    getters that look ideal for this belong to the RACE item's data model —
   *    `sensesLabels` reads `this.senses.ranges[k]`, which an actor doesn't have —
   *    so the labels are composed here from the same CONFIG tables instead.
   */
  statblock: (d) => {
    const s = sys(d);
    const C = dnd5eConfig();
    const table = (k: string): Record<string, unknown> => (C[k] ?? {}) as Record<string, unknown>;

    const abilities: StatBlockAbility[] = [];
    for (const [key, cfg] of Object.entries(table("abilities"))) {
      const a = at(s, `abilities.${key}`) as Record<string, unknown> | undefined;
      if (!a) continue;
      abilities.push({
        key,
        label: cfgLabel((cfg as { abbreviation?: unknown })?.abbreviation ?? cfg) || key.toUpperCase(),
        score: num(a.value),
        mod: num(a.mod),
        save: num(at(a, "save.value")) ?? num(a.save),
        proficient: !!a.proficient,
      });
    }

    // "Walk 30 ft, Fly 60 ft" — only the movements the actor actually has.
    const mv = at(s, "attributes.movement") as Record<string, unknown> | undefined;
    const mvUnits = typeof mv?.units === "string" ? mv.units : "";
    const speed = mv
      ? Object.entries(table("movementTypes"))
          .map(([k, cfg]) => {
            const v = num(mv[k]);
            return v ? `${cfgLabel(cfg)} ${v}${mvUnits ? ` ${mvUnits}` : ""}`.trim() : null;
          })
          .filter(Boolean)
          .join(", ")
      : "";

    const se = at(s, "attributes.senses") as Record<string, unknown> | undefined;
    const seUnits = typeof se?.units === "string" ? se.units : "";
    const senseList = se
      ? Object.entries(table("senses"))
          .map(([k, lbl]) => {
            const v = num(se[k]);
            return v ? `${cfgLabel(lbl)} ${v}${seUnits ? ` ${seUnits}` : ""}`.trim() : null;
          })
          .filter(Boolean)
      : [];
    if (typeof se?.special === "string" && se.special.trim()) senseList.push(se.special.trim());

    // NPCs carry a challenge rating, characters a level — show whichever exists.
    const cr = at(s, "details.cr");
    const level = num(at(s, "details.level"));
    const rank =
      cr != null && cr !== ""
        ? `${game.i18n.localize("BIVOUAC.StatBlock.CR")} ${cr}`
        : level != null
          ? `${game.i18n.localize("BIVOUAC.StatBlock.Level")} ${level}`
          : null;

    const hpValue = num(at(s, "attributes.hp.value"));
    const traits = [
      dnd5eTrait(s, "dr", "BIVOUAC.StatBlock.Resistances", table("damageTypes")),
      dnd5eTrait(s, "di", "BIVOUAC.StatBlock.Immunities", table("damageTypes")),
      dnd5eTrait(s, "dv", "BIVOUAC.StatBlock.Vulnerabilities", table("damageTypes")),
      dnd5eTrait(s, "ci", "BIVOUAC.StatBlock.ConditionImmunities", table("conditionTypes")),
    ].filter((t): t is StatBlockTrait => !!t);

    return {
      ac: num(at(s, "attributes.ac.value")),
      hp: hpValue == null ? null : { value: hpValue, max: num(at(s, "attributes.hp.max")), temp: num(at(s, "attributes.hp.temp")) },
      speed: speed || null,
      senses: senseList.join(", ") || null,
      rank,
      prof: num(at(s, "attributes.prof")),
      abilities,
      traits,
    };
  },
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
  /**
   * Verified against the installed daggerheart 2.7.1 (`build/daggerheart.js`):
   *
   *  • Item charges live at `system.resource.{value,max,type,recovery}` — NOT a
   *    `uses` block like dnd5e's.
   *  • `type` is what says the item has a resource at all; the system itself
   *    guards on it (`x.system.resource.type && …`) before touching the rest.
   *  • `max` may be a FORMULA STRING, not a number — the system runs it through
   *    `Roll.replaceFormulaData(item.system.resource.max, actor.getRollData())`.
   *    We deliberately don't evaluate it (that needs actor roll data and can
   *    throw), so a formula cap reads as "no numeric max" and the pin shows the
   *    bare remaining count rather than a wrong or crashing one.
   *
   * Activation / range / formula are null: Daggerheart keeps those on an item's
   * ACTIONS rather than as prepared labels, and picking "the" action out of a
   * list would be a guess. Per-field null is the contract, so those chips are
   * simply absent here instead of wrong.
   */
  itemInfo: (it) => {
    const res = at(sys(it), "resource") as Record<string, unknown> | undefined;
    const value = res?.type ? num(res.value) : null;
    return {
      uses: value == null ? null : { value, max: num(res?.max) },
      activation: null,
      range: null,
      formula: null,
      attack: null,
    };
  },
  /**
   * Daggerheart's at-a-glance readout. Deliberately much thinner than dnd5e's,
   * because the system genuinely has less of this shape — no ability *scores*
   * (traits are flat modifiers), no movement rate, no senses, no damage
   * resistance table. Inventing rows to fill the same layout would be worse than
   * showing fewer, so the renderer just omits what comes back null.
   *
   * Traits are `system.traits.<id>.value` — a flat modifier, so they render as
   * the modifier with no score and no save. Paths follow the same v2.7 model the
   * stat rows above were verified against.
   */
  statblock: (d) => {
    const s = sys(d);
    const abilities: StatBlockAbility[] = [];
    const traitObj = at(s, "traits");
    if (traitObj && typeof traitObj === "object") {
      for (const [key, v] of Object.entries(traitObj as Record<string, unknown>)) {
        const mod = num((v as Record<string, unknown>)?.value);
        if (mod == null) continue;
        abilities.push({ key, label: key.slice(0, 3).toUpperCase(), score: null, mod, save: null, proficient: false });
      }
    }
    const hp = num(at(s, "resources.hitPoints.value"));
    const level = num(at(s, "levelData.level.current")) ?? num(at(s, "level.current")) ?? num(at(s, "tier"));
    return {
      // Evasion on a character, difficulty on an adversary — the same "number to
      // beat" the stat row already resolves this way.
      ac: num(at(s, "evasion")) ?? num(at(s, "difficulty")),
      // Reversed: Daggerheart counts damage MARKED upward toward a maximum, so
      // this is not remaining HP. The renderer labels it from the stat rows.
      hp: hp == null ? null : { value: hp, max: num(at(s, "resources.hitPoints.max")) },
      speed: null,
      senses: null,
      rank: level == null ? null : `${game.i18n.localize("BIVOUAC.StatBlock.Level")} ${level}`,
      prof: null,
      abilities,
      traits: [],
    };
  },
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

/** GM-defined rows, as `StatDef`s. A custom row is just a `StatDef` whose `read`
 *  walks a user-typed path — the whole feature is possible because the read side
 *  was already a one-function contract. */
function customStats(): StatDef[] {
  return customStatRows().map((r) => ({
    key: `custom_${r.id}`,
    setting: customStatSetting(r.id),
    label: r.name, // a literal; see `custom` on StatDef
    icon: r.icon,
    custom: true,
    hint: r.maxPath ? `system.${r.path} / system.${r.maxPath}` : `system.${r.path}`,
    read: (d) => {
      const v = readCustomPath(d, r.path);
      if (v == null) return null;
      // An empty max path means "not a pool" — `undefined`, so `formatStat`
      // prints the bare number. A max path that doesn't resolve gives null,
      // which formats the same way rather than inventing a denominator.
      const max = r.maxPath ? readCustomPath(d, r.maxPath) : undefined;
      return { value: v, max, reverse: r.reverse };
    },
  }));
}

/**
 * The adapter in force. Auto-detects from `game.system.id` by default — the
 * world already knows what it's running, so a manual picker would just be one
 * more thing to get wrong. The setting exists as an OVERRIDE, for forcing the
 * generic (no stats) or for a system that's a reskin of one we support.
 *
 * GM-defined rows are APPENDED to whatever the adapter exposes, rather than
 * replacing it: a 5e table that wants Spell Save DC alongside the built-in four
 * gets both. Under `generic` — whose list is empty — they end up being the only
 * source, which is exactly what an unsupported system needs, with no special case
 * for it here.
 *
 * NB: read lazily, never cached — the per-stat settings are registered from this
 * at `init`, so changing it requires a reload (the setting says so).
 */
export function activeAdapter(): SystemAdapter {
  const choice = String(game.settings.get(MODULE_ID, SETTINGS.castSystem) ?? "auto");
  const base = adapterFor(choice === "auto" ? String(game.system?.id ?? "") : choice);
  const custom = customStats();
  return custom.length ? { ...base, stats: [...base.stats, ...custom] } : base;
}

/** i18n key for a stat's gating setting, matching the `BIVOUAC.Settings.<Pascal>`
 *  convention the hand-written settings already use. */
export function statSettingKey(stat: StatDef, part: "Name" | "Hint"): string {
  return `BIVOUAC.Settings.${stat.setting[0].toUpperCase()}${stat.setting.slice(1)}.${part}`;
}

/** The stats to actually show for a document: those the active adapter can read
 *  off it AND that the GM has enabled. Shared by the Cast Bar plate overlay and
 *  the Mini Sheet tile — the DATA is common, the markup is each renderer's own. */
export function visibleStats(doc: Record<string, unknown>): { stat: StatDef; val: StatValue }[] {
  const out: { stat: StatDef; val: StatValue }[] = [];
  for (const stat of activeAdapter().stats) {
    const val = stat.read(doc);
    if (val && game.settings.get(MODULE_ID, stat.setting)) out.push({ stat, val });
  }
  return out;
}

/** How a stat reads on screen: a pool shows `value/max`, everything else the
 *  bare number. Kept here so both renderers format identically. */
export function formatStat(val: StatValue): string {
  return typeof val.max === "number" ? `${val.value}/${val.max}` : `${val.value}`;
}

/** Reference detail for a pinned Item under the active adapter, or null when the
 *  system has no adapter support for it. Same shape of call as `visibleStats` —
 *  the renderer asks, and shows whatever comes back. */
export function itemInfoFor(item: Record<string, unknown>): ItemInfo | null {
  return activeAdapter().itemInfo?.(item) ?? null;
}

/** The at-a-glance readout for an actor under the active adapter, or null.
 *  Defensive: this reaches further into a system's data than anything else here,
 *  and a schema change between versions must degrade the tile, not break it. */
export function statblockFor(doc: Record<string, unknown>): StatBlock | null {
  try {
    return activeAdapter().statblock?.(doc) ?? null;
  } catch (err) {
    console.warn("bivouac | statblock read failed", err);
    return null;
  }
}
