/**
 * A player asking the GM to change their own plate — the real `handlePlateRequest`
 * from src/plate-requests.ts against a stubbed world.
 *
 * This is the one place in Bivouac that acts on a message from ANOTHER client, so
 * the checks below are mostly about refusal: every field arrives from outside and
 * the only field that cannot be verified is the sender's identity claim. What the
 * GM re-derives — the scene, the plate, and whether the claimed user is playing
 * that plate's character — is what keeps the ceiling at "a player can do to their
 * own plate what they could already do".
 */
import { handlePlateRequest, requestPlateAction } from "./.build/plate-requests.mjs";

globalThis.foundry = { utils: { deepClone: (o) => structuredClone(o) } };

/** A scene whose cast-bar flags are readable and writable. */
function scene(id, flags = {}) {
  const store = { ...flags };
  return {
    id,
    store,
    getFlag: (_m, k) => store[k],
    setFlag: async (_m, k, v) => {
      store[k] = v;
      return v;
    },
  };
}
const plate = (id, uuid, extra = {}) => ({
  id,
  uuid,
  art: "profile",
  exited: false,
  hidden: false,
  nameHidden: false,
  ...extra,
});

/**
 * users:   [{id, character?}]
 * actors:  { "Actor.a1": {id: "a1"} }  — what fromUuidSync resolves
 */
function world({ users = [], actors = {}, activeGM = true, scenes = [] } = {}) {
  const umap = new Map(users.map((u) => [u.id, u]));
  globalThis.game = {
    user: { id: "gm", isActiveGM: activeGM, isGM: true },
    users: { get: (id) => umap.get(id) ?? null, activeGM: activeGM ? { id: "gm" } : null, contents: users },
    scenes: { get: (id) => scenes.find((s) => s.id === id) ?? null },
  };
  globalThis.canvas = { scene: scenes[0] ?? null };
  globalThis.fromUuidSync = (uuid) => actors[uuid] ?? null;
}

/** The standard table: Alice plays a1, Bob plays a2, and both are on bar 1. */
function table(overrides = {}) {
  const s = scene("scn1", {
    castBar: {
      visible: true,
      speakerId: null,
      plates: [plate("p1", "Actor.a1"), plate("p2", "Actor.a2")],
    },
  });
  world({
    users: [
      { id: "u1", active: true, character: { id: "a1" } },
      { id: "u2", active: true, character: { id: "a2" } },
      { id: "u3", active: true }, // no character assigned
    ],
    actors: { "Actor.a1": { id: "a1" }, "Actor.a2": { id: "a2" } },
    scenes: [s],
    ...overrides,
  });
  return s;
}
const req = (over = {}) => ({
  type: "plate-request",
  sceneId: "scn1",
  flag: "castBar",
  plateId: "p1",
  action: "exited",
  value: true,
  userId: "u1",
  ...over,
});
const bar = (s, flag = "castBar") => s.store[flag];

const results = [];
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}  → ${JSON.stringify(got)}`);
  if (!ok) console.log(`        wanted ${JSON.stringify(want)}`);
}

console.log("\n1. A player's own plate — the two things they may set");
{
  const s = table();
  check("leave the conversation", await handlePlateRequest(req()), "");
  check("…written to the flag", bar(s).plates[0].exited, true);
  check("rejoin", await handlePlateRequest(req({ value: false })), "");
  check("…written back", bar(s).plates[0].exited, false);
}
{
  const s = table();
  check("start speaking", await handlePlateRequest(req({ action: "speaker" })), "");
  check("…sets the speaker", bar(s).speakerId, "p1");
  check("stop speaking", await handlePlateRequest(req({ action: "speaker", value: false })), "");
  check("…clears it", bar(s).speakerId, null);
}
{
  // The request carries the DESIRED state, so a repeat is not an inversion.
  const s = table();
  await handlePlateRequest(req());
  check("a repeated request writes nothing new", await handlePlateRequest(req()), "");
  check("…and the state stands", bar(s).plates[0].exited, true);
}

console.log("\n2. Refusals — someone else's plate");
{
  const s = table();
  check("Alice cannot move Bob's plate", await handlePlateRequest(req({ plateId: "p2" })), "not the requester's character");
  check("…nothing written", bar(s).plates[1].exited, false);
  check(
    "a user playing nothing cannot move any plate",
    await handlePlateRequest(req({ userId: "u3" })),
    "requester plays no character",
  );
  check("an unknown user", await handlePlateRequest(req({ userId: "ghost" })), "requester plays no character");
  check("the speaker action is gated the same way", await handlePlateRequest(req({ action: "speaker", plateId: "p2" })), "not the requester's character");
  check("…so the speaker is untouched", bar(s).speakerId, null);
}

console.log("\n3. Refusals — malformed or out of range");
{
  const s = table();
  const cases = [
    ["not our message", { type: "something-else" }, "malformed"],
    ["no message", null, "malformed"],
    ["an action that is not self-service", req({ action: "hidden" }), "malformed"],
    ["…nor a plate mutation", req({ action: "remove" }), "malformed"],
    ["a non-boolean value", req({ value: "yes" }), "malformed"],
    ["a missing plate id", req({ plateId: 7 }), "malformed"],
    ["an arbitrary scene flag", req({ flag: "layout" }), "malformed"],
    ["a flag that is not a bar", req({ flag: "castBar3" }), "malformed"],
    ["an unknown scene", req({ sceneId: "nope" }), "unknown scene"],
    ["an unknown plate", req({ plateId: "p9" }), "unknown plate"],
  ];
  for (const [name, msg, want] of cases) check(name, await handlePlateRequest(msg), want);
  check("nothing was written by any of them", JSON.stringify(bar(s)).includes('"exited":true'), false);
}

console.log("\n4. Exactly one writer");
{
  const s = table();
  world({
    users: [{ id: "u1", active: true, character: { id: "a1" } }],
    actors: { "Actor.a1": { id: "a1" } },
    scenes: [s],
    activeGM: true,
  });
  globalThis.game.user.isActiveGM = false; // a second, non-active GM client
  check("a non-active GM applies nothing", await handlePlateRequest(req()), "not the active GM");
  check("…and writes nothing", bar(s).plates[0].exited, false);
}

console.log("\n5. Sending a request needs somebody to send it to");
{
  const s = table();
  const sent = [];
  globalThis.game.user = { id: "u1" };
  globalThis.game.socket = { emit: (ch, m) => sent.push([ch, m]) };
  check("with a GM connected, it goes out", requestPlateAction("castBar", "p1", "exited", true), true);
  check("…on the module's channel", sent[0][0], "module.bivouac");
  check("…carrying the scene, plate, action and value", [sent[0][1].sceneId, sent[0][1].plateId, sent[0][1].action, sent[0][1].value], ["scn1", "p1", "exited", true]);
  check("…and the sender's own id", sent[0][1].userId, "u1");

  globalThis.game.users = { get: () => null, activeGM: null, contents: [{ id: "u1", active: true, isGM: false }] };
  check("with no GM connected, nothing is sent", requestPlateAction("castBar", "p1", "exited", true), false);
  check("…and the socket was not touched", sent.length, 1);
  void s;
}

const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} checks passed`);
if (bad) process.exitCode = 1;
