/**
 * Load test: headless Colyseus clients driving concurrent PvE matches.
 *
 * Each virtual client `joinOrCreate`s a `pve` room (BotRoom — one client + one
 * bot, so one client == one room), submits its mulligan, then ends its turn
 * once per turn until the match finishes or a per-match timeout fires.
 *
 * Server memory / CPU under load is read separately from Fly metrics
 * (`fly metrics` / dashboard) — see docs/phase6-production-launch.md.
 *
 * Prerequisite: a running Colyseus server (npm run dev:server, or a deployed
 * Fly URL).
 *
 * Config (env vars):
 *   LOAD_TEST_URL          ws/wss endpoint        (default ws://localhost:2567)
 *   LOAD_TEST_ROOMS        concurrent matches     (default 25)
 *   LOAD_TEST_DURATION_MS  per-match timeout      (default 60000)
 *   LOAD_TEST_RAMP_MS      stagger between joins  (default 25)
 *
 * Usage: node e2e/load-test.mjs
 */

import { Client } from "@colyseus/sdk";

const URL = process.env.LOAD_TEST_URL || "ws://localhost:2567";
const ROOMS = Math.max(1, parseInt(process.env.LOAD_TEST_ROOMS ?? "25", 10));
const DURATION_MS = Math.max(5_000, parseInt(process.env.LOAD_TEST_DURATION_MS ?? "60000", 10));
const RAMP_MS = Math.max(0, parseInt(process.env.LOAD_TEST_RAMP_MS ?? "25", 10));

const HUMAN_SEAT = "player1"; // BotRoom always seats the joining client as player1.

const stats = {
  attempted: 0,
  joined: 0,
  completed: 0,
  timedOut: 0,
  errors: 0,
  latencies: [] // ms: endTurn sent -> next publicSync with advanced actionSeq
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs a single virtual client through one PvE match. Always resolves. */
async function runClient(index) {
  stats.attempted++;
  const client = new Client(URL);
  let room;
  let commandCounter = 0;
  let mulliganSent = false;
  let lastEndedTurn = -1;
  let pendingSend = null; // { actionSeq, sentAtMs }
  let resolveMatch;
  const matchDone = new Promise((resolve) => {
    resolveMatch = resolve;
  });

  const nextCommandId = (tag) => `load-${index}-${tag}-${++commandCounter}`;
  const send = (command, expectedActionSeq) => {
    room.send("command", { commandId: nextCommandId(command.type), expectedActionSeq, command });
  };

  try {
    room = await client.joinOrCreate("pve", { displayName: `load-${index}` });
    stats.joined++;

    let mySeat = HUMAN_SEAT;
    room.onMessage("seat", (msg) => {
      if (msg && typeof msg.seat === "string") mySeat = msg.seat;
    });
    // Consumed by the real client; registered here only to silence the SDK's
    // "onMessage() not registered" warnings.
    room.onMessage("bot", () => {});
    room.onMessage("events", () => {});
    room.onMessage("hand", () => {});

    room.onMessage("publicSync", (msg) => {
      if (!msg) return;
      const { status, activeSeat, turnNumber, actionSeq, result } = msg;

      if (pendingSend && typeof actionSeq === "number" && actionSeq > pendingSend.actionSeq) {
        stats.latencies.push(Date.now() - pendingSend.sentAtMs);
        pendingSend = null;
      }

      if (status === "finished" || status === "abandoned" || result) {
        stats.completed++;
        resolveMatch();
        return;
      }

      if (status === "mulligan" && !mulliganSent) {
        mulliganSent = true;
        send({ type: "submitMulligan", replaceHandInstanceIds: [] }, actionSeq ?? 0);
        return;
      }

      if (status === "in_progress" && activeSeat === mySeat && turnNumber !== lastEndedTurn) {
        lastEndedTurn = turnNumber;
        pendingSend = { actionSeq: actionSeq ?? 0, sentAtMs: Date.now() };
        send({ type: "endTurn" }, actionSeq ?? 0);
      }
    });

    room.onError((code, message) => {
      stats.errors++;
      console.error(`[client ${index}] room error ${code}: ${message}`);
      resolveMatch();
    });
    room.onLeave(() => resolveMatch());

    const timeout = sleep(DURATION_MS).then(() => "timeout");
    const outcome = await Promise.race([matchDone.then(() => "done"), timeout]);
    if (outcome === "timeout") stats.timedOut++;
  } catch (error) {
    stats.errors++;
    console.error(`[client ${index}] ${error?.message ?? error}`);
  } finally {
    try {
      await room?.leave();
    } catch {
      /* already closed */
    }
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

(async function main() {
  console.log(`Load test → ${URL}  (${ROOMS} concurrent rooms, ${DURATION_MS}ms per-match cap)`);
  const started = Date.now();

  const runners = [];
  for (let i = 0; i < ROOMS; i++) {
    runners.push(runClient(i));
    if (RAMP_MS > 0) await sleep(RAMP_MS);
  }
  await Promise.all(runners);

  const elapsedMs = Date.now() - started;
  const sorted = [...stats.latencies].sort((a, b) => a - b);
  const joinRate = stats.attempted ? ((stats.joined / stats.attempted) * 100).toFixed(1) : "0.0";

  console.log("\n════════════ Load Test Results ════════════");
  console.log(`  Elapsed:           ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`  Rooms attempted:   ${stats.attempted}`);
  console.log(`  Rooms joined:      ${stats.joined}  (${joinRate}% connect success)`);
  console.log(`  Matches completed: ${stats.completed}`);
  console.log(`  Matches timed out: ${stats.timedOut}`);
  console.log(`  Errors:            ${stats.errors}`);
  console.log(`  Command RTT:       p50 ${percentile(sorted, 50)}ms  p95 ${percentile(sorted, 95)}ms  max ${sorted.at(-1) ?? 0}ms  (n=${sorted.length})`);
  console.log("═══════════════════════════════════════════\n");

  const ok = stats.joined === stats.attempted && stats.errors === 0;
  process.exit(ok ? 0 : 1);
})();
