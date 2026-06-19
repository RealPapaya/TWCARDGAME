import { GameDurableObject, type Env } from "./GameDurableObject.js";

// The Durable Object class must be exported from the Worker entry so Wrangler can
// bind it (see wrangler.jsonc `durable_objects` + `migrations`).
export { GameDurableObject };

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

/**
 * Worker front door. It only routes — one match == one Durable Object, addressed
 * by `idFromName("<mode>:<room>")`. PvP-by-room-code is the Phase 0 flow: two
 * tabs hitting `wss://…/pvp?room=ABC` land in the same DO and play.
 *
 * Public matchmaking (joinOrCreate semantics) and PvE bot pacing are later
 * phases — see docs/cloudflare-migration-roadmap.md §6 (Phase 1/2).
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

    if (/^\/pve\/?$/.test(url.pathname)) {
      return Response.json(
        { ok: false, error: "PvE (bot) is not yet migrated to the realtime worker (roadmap Phase 1)." },
        { status: 501, headers: CORS_HEADERS }
      );
    }

    if (/^\/pvp\/?$/.test(url.pathname)) {
      const room = url.searchParams.get("room") || url.searchParams.get("joinCode") || crypto.randomUUID();
      const id = env.GAME_ROOM.idFromName(`pvp:${room}`);
      const stub = env.GAME_ROOM.get(id);
      // Normalise the room param so the DO sees a stable identity regardless of
      // whether the caller passed `room` or `joinCode`.
      const forward = new URL(request.url);
      forward.searchParams.set("room", room);
      return stub.fetch(new Request(forward.toString(), request));
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  }
};
