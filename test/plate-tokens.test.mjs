/**
 * Drive the REAL reconcile pass from src/plate-tokens.ts against a stubbed
 * Foundry world. Bundled first with esbuild, so this exercises the shipped
 * logic rather than a paraphrase of it.
 */
import { syncPlateTokens, sweepPlateTokens } from "./.build/plate-tokens.mjs";

let uid = 0;
const nid = (p) => `${p}${++uid}`;

globalThis.CONST = { TOKEN_DISPLAY_MODES: { NONE: 0 } };
globalThis.foundry = { utils: { deepClone: (o) => structuredClone(o) } };

function makeWorld({ actors = [], scenes = [], setting = true, activeGM = true }) {
  const actorMap = new Map(actors.map((a) => [a.id, a]));
  globalThis.game = {
    user: { isActiveGM: activeGM },
    settings: { get: (_m, k) => (k === "castPlateTokens" ? setting : undefined) },
    actors: { get: (id) => actorMap.get(id) },
    scenes,
  };
  globalThis.canvas = { scene: scenes[0] ?? null };
}

function actor(id, name) {
  return {
    id,
    name,
    async getTokenDocument(data) {
      return { toObject: () => ({ ...data, actorId: id, name }) };
    },
  };
}

/** tokens: [{actorId, managed?}] ; plates: {bar1:[uuid], bar2:[uuid]} */
function scene(name, tokens, plates = {}) {
  const s = {
    id: nid("scn"),
    name,
    dimensions: { size: 100 },
    tokens: tokens.map((t) => ({
      id: nid("tok"),
      actorId: t.actorId,
      getFlag: (_m, k) => (k === "plateToken" ? (t.managed ? true : undefined) : undefined),
    })),
    getFlag: (_m, k) => {
      const list = k === "castBar" ? plates.bar1 : k === "castBar2" ? plates.bar2 : null;
      return list ? { visible: true, speakerId: null, plates: list.map((u) => ({ id: nid("p"), uuid: u })) } : undefined;
    },
    created: [],
    deleted: [],
    async createEmbeddedDocuments(_t, data) {
      s.created.push(...data);
      for (const d of data)
        s.tokens.push({
          id: nid("tok"),
          actorId: d.actorId,
          getFlag: (_m, k) => (k === "plateToken" ? d.flags?.bivouac?.plateToken === true : undefined),
        });
    },
    async deleteEmbeddedDocuments(_t, ids) {
      s.deleted.push(...ids);
      s.tokens = s.tokens.filter((t) => !ids.includes(t.id));
    },
  };
  return s;
}

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const summarise = (s) =>
  s.tokens.map((t) => `${t.actorId}${t.getFlag("bivouac", "plateToken") ? "*" : ""}`).sort().join(",") || "(none)";

/* ------------------------------------------------------------------ cases */

console.log("\n1. A plate with no token gets one parked");
{
  const s = scene("A", [], { bar1: ["Actor.a1"] });
  makeWorld({ actors: [actor("a1", "Alice")], scenes: [s] });
  await syncPlateTokens();
  check("one token created", s.created.length === 1, `created=${s.created.length}`);
  check("hidden", s.created[0]?.hidden === true);
  check("sight disabled", s.created[0]?.sight?.enabled === false);
  check("carries the marker flag", s.created[0]?.flags?.bivouac?.plateToken === true);
  check("parked in the padding corner", s.created[0]?.x === 0 && s.created[0]?.y === 0);
}

console.log("\n2. Rule 1 — an actor with a REAL token gets nothing added");
{
  const s = scene("B", [{ actorId: "a1" }], { bar1: ["Actor.a1"] });
  makeWorld({ actors: [actor("a1", "Alice")], scenes: [s] });
  await syncPlateTokens();
  check("nothing created", s.created.length === 0, `created=${s.created.length}`);
  check("real token untouched", s.deleted.length === 0);
}

console.log("\n3. Rule 1 — a real token appearing WITHDRAWS ours");
{
  const s = scene("C", [{ actorId: "a1", managed: true }, { actorId: "a1" }], { bar1: ["Actor.a1"] });
  makeWorld({ actors: [actor("a1", "Alice")], scenes: [s] });
  await syncPlateTokens();
  check("ours deleted", s.deleted.length === 1, `deleted=${s.deleted.length}`);
  check("the real one survives", summarise(s) === "a1", summarise(s));
}

console.log("\n4. Rule 2 — a plate removed deletes ONLY ours");
{
  const s = scene("D", [{ actorId: "a1", managed: true }, { actorId: "a2" }], { bar1: [] });
  makeWorld({ actors: [actor("a1", "A"), actor("a2", "B")], scenes: [s] });
  await syncPlateTokens();
  check("ours gone, the GM's kept", summarise(s) === "a2", summarise(s));
}

console.log("\n5. Rule 3 — the same actor plated twice shares ONE token");
{
  const s = scene("E", [], { bar1: ["Actor.a1", "Actor.a1"], bar2: ["Actor.a1"] });
  makeWorld({ actors: [actor("a1", "A")], scenes: [s] });
  await syncPlateTokens();
  check("exactly one created", s.created.length === 1, `created=${s.created.length}`);
}

console.log("\n6. Both bars are read");
{
  const s = scene("F", [], { bar1: ["Actor.a1"], bar2: ["Actor.a2"] });
  makeWorld({ actors: [actor("a1", "A"), actor("a2", "B")], scenes: [s] });
  await syncPlateTokens();
  check("one per bar", s.created.length === 2, `created=${s.created.length}`);
  check("parked side by side", s.created[1]?.x === 100, `x=${s.created[1]?.x}`);
}

console.log("\n7. Non-actor and unresolvable plates are skipped");
{
  const s = scene("G", [], {
    bar1: ["Item.i1", "Compendium.dnd5e.monsters.Actor.x1", "Scene.s1.Token.t1.Actor.a9", "Actor.ghost", "Actor.a1"],
  });
  makeWorld({ actors: [actor("a1", "A")], scenes: [s] });
  await syncPlateTokens();
  check("only the world actor is parked", s.created.length === 1, `created=${s.created.length}`);
  check("and it is the right one", s.created[0]?.actorId === "a1");
}

console.log("\n8. Duplicates of ours are pruned back to one");
{
  const s = scene("H", [
    { actorId: "a1", managed: true },
    { actorId: "a1", managed: true },
    { actorId: "a1", managed: true },
  ], { bar1: ["Actor.a1"] });
  makeWorld({ actors: [actor("a1", "A")], scenes: [s] });
  await syncPlateTokens();
  check("two deleted, one kept", s.deleted.length === 2 && summarise(s) === "a1*", `${s.deleted.length} / ${summarise(s)}`);
}

console.log("\n9. Idempotent — a second pass is a no-op");
{
  const s = scene("I", [], { bar1: ["Actor.a1", "Actor.a2"] });
  makeWorld({ actors: [actor("a1", "A"), actor("a2", "B")], scenes: [s] });
  await syncPlateTokens();
  const afterFirst = { c: s.created.length, d: s.deleted.length };
  await syncPlateTokens();
  await syncPlateTokens();
  check("no further writes", s.created.length === afterFirst.c && s.deleted.length === afterFirst.d,
    `created ${afterFirst.c}→${s.created.length}, deleted ${afterFirst.d}→${s.deleted.length}`);
}

console.log("\n10. Setting off — the active scene is withdrawn from");
{
  const s = scene("J", [{ actorId: "a1", managed: true }, { actorId: "a2" }], { bar1: ["Actor.a1"] });
  makeWorld({ actors: [actor("a1", "A")], scenes: [s], setting: false });
  await syncPlateTokens();
  check("ours removed, GM's kept", summarise(s) === "a2", summarise(s));
  check("nothing created while off", s.created.length === 0);
}

console.log("\n10b. An UNREADABLE setting does nothing — it is not off");
{
  // Once the setting became default-on, reporting an unreadable setting as off
  // would have deleted a scene's worth of parked tokens and recreated them on
  // the next pass. Unknown must mean wait.
  const s = scene("J2", [{ actorId: "a1", managed: true }], { bar1: ["Actor.a1"] });
  makeWorld({ actors: [actor("a1", "A")], scenes: [s] });
  globalThis.game.settings.get = () => {
    throw new Error("not registered yet");
  };
  await syncPlateTokens();
  check("nothing deleted", s.deleted.length === 0, `deleted=${s.deleted.length}`);
  check("nothing created", s.created.length === 0, `created=${s.created.length}`);
  check("the parked token is left alone", summarise(s) === "a1*", summarise(s));
}

console.log("\n11. Sweep clears EVERY scene, ours only");
{
  const s1 = scene("K1", [{ actorId: "a1", managed: true }, { actorId: "a2" }]);
  const s2 = scene("K2", [{ actorId: "a3", managed: true }]);
  const s3 = scene("K3", [{ actorId: "a4" }]);
  makeWorld({ actors: [], scenes: [s1, s2, s3] });
  await sweepPlateTokens();
  check("scene 1 keeps the GM's", summarise(s1) === "a2", summarise(s1));
  check("scene 2 emptied", summarise(s2) === "(none)", summarise(s2));
  check("scene 3 untouched", s3.deleted.length === 0);
}

console.log("\n12. Only the ACTIVE GM writes");
{
  const s = scene("L", [], { bar1: ["Actor.a1"] });
  makeWorld({ actors: [actor("a1", "A")], scenes: [s], activeGM: false });
  await syncPlateTokens();
  await sweepPlateTokens();
  check("a non-active-GM client writes nothing", s.created.length === 0 && s.deleted.length === 0);
}

console.log("\n13. An unlinked token of the actor still counts as real");
{
  // An unlinked token keeps its source actorId, so rule 1 must see it.
  const s = scene("M", [{ actorId: "a1" }], { bar1: ["Actor.a1"] });
  makeWorld({ actors: [actor("a1", "A")], scenes: [s] });
  await syncPlateTokens();
  check("no duplicate parked", s.created.length === 0);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED: " + failed.map((f) => f.name).join("; "));
  process.exitCode = 1;
}
