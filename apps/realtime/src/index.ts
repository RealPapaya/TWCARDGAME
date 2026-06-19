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

    const modeMatch = url.pathname.match(/^\/(pvp|pve)\/?$/);
    if (modeMatch) {
      const mode = modeMatch[1];
      // PvE is single-human, so default to a unique room per connection; PvP
      // matches by shared room code / join code.
      const room =
        url.searchParams.get("room") ||
        (mode === "pvp" ? url.searchParams.get("joinCode") : null) ||
        crypto.randomUUID();
      const id = env.GAME_ROOM.idFromName(`${mode}:${room}`);
      const stub = env.GAME_ROOM.get(id);
      // Normalise room + mode so the DO sees a stable identity and knows its kind.
      const forward = new URL(request.url);
      forward.searchParams.set("room", room);
      forward.searchParams.set("mode", mode);
      return stub.fetch(new Request(forward.toString(), request));
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  }
};
