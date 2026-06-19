// Live two-client smoke test against `wrangler dev`. Confirms the Durable Object
// seats two players, creates the match, delivers private hands, and reaches
// in_progress after both mulligan. Uses Node's global WebSocket (Node >= 22).
//   node apps/realtime/poc/smoke.mjs            (expects wrangler dev on :8787)
//   BASE=ws://127.0.0.1:8787 node apps/realtime/poc/smoke.mjs

const BASE = process.env.BASE || "ws://127.0.0.1:8787";
const ROOM = "smoke-" + Math.floor(Date.now() / 1000);

function mkClient(sessionId, name) {
  const ws = new WebSocket(`${BASE}/pvp?room=${ROOM}&sessionId=${sessionId}&name=${name}`);
  const state = { ws, seat: null, hand: null, pub: null, sessionId };
  ws.addEventListener("message", (ev) => {
    const { type, payload } = JSON.parse(ev.data);
    if (type === "seat") state.seat = payload.seat;
    else if (type === "hand") state.hand = payload.cards;
    else if (type === "publicSync") state.pub = payload;
  });
  return state;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, label, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await wait(50);
  }
  throw new Error("timeout waiting for: " + label);
}
function send(c, command) {
  c.ws.send(JSON.stringify({
    type: "command",
    payload: { commandId: `${c.seat}-${Math.random().toString(36).slice(2)}`, expectedActionSeq: c.pub?.actionSeq ?? 0, command }
  }));
}

const a = mkClient("A", "Alice");
const b = mkClient("B", "Bob");

try {
  await until(() => a.ws.readyState === 1 && b.ws.readyState === 1, "both sockets open");
  await until(() => a.seat && b.seat, "both seats assigned");
  await until(() => a.hand?.length === 3 && b.hand?.length === 3, "both hands dealt (match created)");
  await until(() => a.pub?.status === "mulligan", "mulligan phase");

  // Confirm hands are private (no shared instance ids).
  const aIds = new Set(a.hand.map((c) => c.instanceId));
  const overlap = b.hand.filter((c) => aIds.has(c.instanceId));
  if (overlap.length) throw new Error("hand privacy leak: shared instance ids");

  send(a, { type: "submitMulligan", replaceHandInstanceIds: [] });
  send(b, { type: "submitMulligan", replaceHandInstanceIds: [] });
  await until(() => a.pub?.status === "in_progress" && b.pub?.status === "in_progress", "in_progress after mulligan");

  console.log(`PASS — seats ${a.seat}/${b.seat}, hands private, status=${a.pub.status}, active=${a.pub.activeSeat}, turn=${a.pub.turnNumber}`);
  a.ws.close();
  b.ws.close();
  process.exit(0);
} catch (err) {
  console.error("FAIL —", err.message, "\n  a:", { seat: a.seat, hand: a.hand?.length, status: a.pub?.status }, "\n  b:", { seat: b.seat, hand: b.hand?.length, status: b.pub?.status });
  process.exit(1);
}
