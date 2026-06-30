import type { DevTestMatchSetup } from "@twcardgame/shared";
import { isDevTestAllowed } from "./devTest.js";
import { GameDurableObject, type Env } from "./GameDurableObject.js";
import { LobbyDurableObject } from "./LobbyDurableObject.js";
import { normalizeJoinCode } from "./lobbyState.js";
import { reconnectKeyFor, verifyReconnectToken, type RealtimeMode } from "./tokens.js";

// The Durable Object class must be exported from the Worker entry so Wrangler can
// bind it (see wrangler.jsonc `durable_objects` + `migrations`).
export { GameDurableObject };
export { LobbyDurableObject };

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

/**
 * Worker front door. It only routes — one match == one Durable Object, addressed
 * by `idFromName("<mode>:<room>")`.
 * - `/pvp?room=ABC` — two tabs with the same room code land in the same DO (Phase 0).
 * - `/pve?difficulty=&theme=` — single human vs the bot; a fresh room per connection.
 *
 * Public matchmaking (joinOrCreate semantics) is a later phase — see
 * docs/cloudflare-migration-roadmap.md §6 (Phase 2).
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "twcardgame-realtime" }, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/matchmaking/public" && request.method === "POST") {
      return withCors(await lobbyFetch(env, "/matchmaking/public", { method: "POST" }));
    }

    if (url.pathname === "/private" && request.method === "POST") {
      return withCors(await lobbyFetch(env, "/private", { method: "POST" }));
    }

    // Localhost-only dev-test PvE: stage a scripted board in a fresh DO, then the
    // client connects to it like a normal /pve room. Mirrors the server's
    // BotRoom dev-test path; the gate fails closed on a deployed (public) Worker.
    if (url.pathname === "/pve/devtest" && request.method === "POST") {
      if (!isDevTestAllowed(request)) {
        return new Response("Dev-test mode is only available from localhost.", { status: 403, headers: CORS_HEADERS });
      }
      let body: { devTest?: DevTestMatchSetup };
      try {
        body = (await request.json()) as { devTest?: DevTestMatchSetup };
      } catch {
        return new Response("Invalid dev-test request body.", { status: 400, headers: CORS_HEADERS });
      }
      if (!body?.devTest) {
        return new Response("Missing dev-test setup.", { status: 400, headers: CORS_HEADERS });
      }
      const room = crypto.randomUUID();
      const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(`pve:${room}`));
      const staged = await stub.fetch("https://do/devtest-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body.devTest)
      });
      if (!staged.ok) return new Response("Failed to stage dev-test match.", { status: 502, headers: CORS_HEADERS });
      return withCors(Response.json({ room }));
    }

    const privateMatch = url.pathname.match(/^\/private\/([^/]+)$/);
    if (privateMatch && (request.method === "GET" || request.method === "DELETE")) {
      return withCors(await lobbyFetch(env, `/private/${privateMatch[1]}`, { method: request.method }));
    }

    const modeMatch = url.pathname.match(/^\/(pvp|pve)\/?$/);
    if (modeMatch) {
      const mode = modeMatch[1] as RealtimeMode;
      const token = url.searchParams.get("token") || url.searchParams.get("reconnectToken");
      const key = token ? await reconnectKeyFor(env.RECONNECT_TOKEN_SECRET ?? env.SUPABASE_SERVICE_ROLE_KEY) : null;
      const decodedToken = token ? await verifyReconnectToken(token, key, Date.now()) : null;
      if (token && (!decodedToken || decodedToken.mode !== mode)) {
        return new Response("Invalid reconnect token.", { status: 400, headers: CORS_HEADERS });
      }

      const joinCode = url.searchParams.get("joinCode");
      let room = decodedToken?.room || url.searchParams.get("room");
      if (!room && mode === "pvp" && joinCode) {
        room = await lookupPrivateRoom(env, joinCode);
        if (!room) return new Response("Join code not found.", { status: 404, headers: CORS_HEADERS });
      }
      if (!room) {
        room = mode === "pvp" ? (await claimPublicRoom(env)).room : crypto.randomUUID();
      }
      // PvE is single-human, so default to a unique room per connection; PvP
      // defaults to Lobby DO matchmaking unless a room / private join code /
      // reconnect token chooses a specific match.
      const id = env.GAME_ROOM.idFromName(`${mode}:${room}`);
      const stub = env.GAME_ROOM.get(id);
      // Normalise room + mode so the DO sees a stable identity and knows its kind.
      const forward = new URL(request.url);
      forward.searchParams.set("room", room);
      forward.searchParams.set("mode", mode);
      if (decodedToken) forward.searchParams.set("sessionId", decodedToken.sessionId);
      if (joinCode) forward.searchParams.set("joinCode", normalizeJoinCode(joinCode));
      return stub.fetch(new Request(forward.toString(), request));
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  }
};

async function claimPublicRoom(env: Env): Promise<{ room: string; status: "waiting" | "matched" }> {
  const response = await lobbyFetch(env, "/matchmaking/public", { method: "POST" });
  if (!response.ok) throw new Error(`Lobby matchmaking failed: ${response.status}`);
  return (await response.json()) as { room: string; status: "waiting" | "matched" };
}

async function lookupPrivateRoom(env: Env, joinCode: string): Promise<string | null> {
  const response = await lobbyFetch(env, `/private/${encodeURIComponent(normalizeJoinCode(joinCode))}`, { method: "GET" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Private room lookup failed: ${response.status}`);
  const payload = (await response.json()) as { room: string };
  return payload.room;
}

async function lobbyFetch(env: Env, path: string, init: RequestInit): Promise<Response> {
  const id = env.LOBBY.idFromName("global");
  return env.LOBBY.get(id).fetch(`https://lobby${path}`, init);
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
