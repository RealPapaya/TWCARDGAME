// Live PvE smoke test against `wrangler dev`. Confirms the Durable Object seats
// the human vs the bot, the bot auto-mulligans on its DO Alarm, the match reaches
// in_progress, and the bot actually takes a turn (real alarm pacing). It does NOT
// play to completion — bot pacing uses multi-second real delays; the full-game
// logic is covered deterministically in BotGameSession.test.ts.
//   node apps/realtime/poc/smoke-pve.mjs        (expects wrangler dev on :8787)

const BASE = process.env.BASE || "ws://127.0.0.1:8787";
const sessionId = "pve-smoke-" + Math.floor(Date.now() / 1000);

const c = { ws: null, seat: null, bot: null, hand: null, pub: null, events: [] };
const ws = new WebSocket(`${BASE}/pve?sessionId=${sessionId}&name=Tester&difficulty=normal`);
c.ws = ws;
ws.addEventListener("message", (ev) => {
  const { type, payload } = JSON.parse(ev.data);
  if (type === "seat") c.seat = payload.seat;
  else if (type === "bot") c.bot = payload;
  else if (type === "hand") c.hand = payload.cards;
  else if (type === "publicSync") c.pub = payload;
  else if (type === "events") c.events.push(...payload);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, label, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await wait(100);
  }
  throw new Error("timeout waiting for: " + label);
}
function send(command) {
  ws.send(JSON.stringify({
    type: "command",
    payload: { commandId: `h-${Math.random().toString(36).slice(2)}`, expectedActionSeq: c.pub?.actionSeq ?? 0, command }
  }));
}

try {
  await until(() => ws.readyState === 1, "socket open");
  await until(() => c.seat === "player1" && c.bot?.seat === "player2", "seat + bot identity");
  await until(() => c.hand?.length === 3, "hand dealt");
  await until(() => c.pub?.status === "mulligan", "mulligan phase");

  send({ type: "submitMulligan", replaceHandInstanceIds: [] });
  // Bot auto-mulligans on its alarm (~1s) → match goes in_progress.
  await until(() => c.pub?.status === "in_progress", "in_progress (bot auto-mulliganed)");

  // If it's the human's turn, pass so the bot gets priority.
  if (c.pub.activeSeat === "player1") send({ type: "endTurn" });

  // The bot should take its turn within a few alarm ticks: either a player2 game
  // event or the turn advancing back past the bot.
  await until(
    () => c.events.some((e) => e.seat === "player2") || (c.pub?.turnNumber ?? 0) >= 3,
    "bot took a turn"
  );

  const botEvents = c.events.filter((e) => e.seat === "player2").map((e) => e.type);
  console.log(`PASS — seat=${c.seat}, bot=${c.bot.difficulty}, status=${c.pub.status}, turn=${c.pub.turnNumber}, botEvents=${botEvents.slice(0, 6).join(",")}`);
  ws.close();
  process.exit(0);
} catch (err) {
  console.error("FAIL —", err.message, "\n  ", { seat: c.seat, bot: c.bot, hand: c.hand?.length, status: c.pub?.status, turn: c.pub?.turnNumber });
  process.exit(1);
}
