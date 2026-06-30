import {
  claimPublicMatch,
  createPrivateChallenge,
  emptyLobbyState,
  joinPrivateByCode,
  releasePrivateRoom,
  type LobbyStorageState
} from "./lobbyState.js";
import {
  checkRateLimit,
  emptyRateLimitState,
  type RateLimitRule,
  type RateLimitState
} from "./rateLimit.js";

const STORAGE_KEY = "lobby";
const RATE_LIMIT_KEY = "ratelimit";

/**
 * Per-IP rate rules for the unauthenticated, DO-spawning surface. Generous enough
 * that no human hits them, tight enough to blunt scripted room-creation floods.
 */
const RATE_RULES: Record<string, RateLimitRule> = {
  // Match-creation POSTs (public matchmaking + private challenge).
  matchmaking: { limit: 30, windowMs: 60_000 },
  // WS connects that spawn a fresh game DO (PvE, explicit-room PvP).
  connect: { limit: 60, windowMs: 60_000 }
};

const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type"
};

export class LobbyDurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });

    // Internal (worker → lobby): account one DO-spawning connect against the client IP.
    if (url.pathname === "/ratelimit" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { bucket?: string; key?: string };
      const limited = await this.enforceRateLimit(body.bucket ?? "connect", body.key ?? "unknown");
      if (limited) return limited;
      return Response.json({ allowed: true }, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/matchmaking/public" && request.method === "POST") {
      const limited = await this.enforceRateLimit("matchmaking", clientKey(request));
      if (limited) return limited;
      const state = await this.load();
      const result = claimPublicMatch(state, Date.now(), () => `public:${crypto.randomUUID()}`);
      await this.save(state);
      return Response.json(result, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/private" && request.method === "POST") {
      const limited = await this.enforceRateLimit("matchmaking", clientKey(request));
      if (limited) return limited;
      const state = await this.load();
      const record = createPrivateChallenge(state, Date.now(), () => `private:${crypto.randomUUID()}`);
      await this.save(state);
      return Response.json(record, { headers: JSON_HEADERS });
    }

    const privateMatch = url.pathname.match(/^\/private\/([^/]+)$/);
    if (privateMatch && request.method === "GET") {
      const state = await this.load();
      const record = joinPrivateByCode(state, decodeURIComponent(privateMatch[1]));
      if (!record) return Response.json({ error: "join code not found" }, { status: 404, headers: JSON_HEADERS });
      return Response.json(record, { headers: JSON_HEADERS });
    }

    if (privateMatch && request.method === "DELETE") {
      const state = await this.load();
      const released = releasePrivateRoom(state, decodeURIComponent(privateMatch[1]));
      if (released) await this.save(state);
      return Response.json({ released }, { headers: JSON_HEADERS });
    }

    return Response.json({ error: "not found" }, { status: 404, headers: JSON_HEADERS });
  }

  /** Returns a 429 Response when the bucket+key is over budget, else null (and records the hit). */
  private async enforceRateLimit(bucket: string, key: string): Promise<Response | null> {
    const rule = RATE_RULES[bucket] ?? RATE_RULES.connect;
    const state = await this.loadRateLimits();
    const result = checkRateLimit(state, `${bucket}:${key}`, Date.now(), rule);
    await this.saveRateLimits(state);
    if (result.allowed) return null;
    const retryAfter = Math.ceil(result.retryAfterMs / 1000);
    return Response.json(
      { error: "rate limited", retryAfterMs: result.retryAfterMs },
      { status: 429, headers: { ...JSON_HEADERS, "retry-after": String(retryAfter) } }
    );
  }

  private async load(): Promise<LobbyStorageState> {
    return (await this.state.storage.get<LobbyStorageState>(STORAGE_KEY)) ?? emptyLobbyState();
  }

  private async save(state: LobbyStorageState): Promise<void> {
    await this.state.storage.put(STORAGE_KEY, state);
  }

  private async loadRateLimits(): Promise<RateLimitState> {
    return (await this.state.storage.get<RateLimitState>(RATE_LIMIT_KEY)) ?? emptyRateLimitState();
  }

  private async saveRateLimits(state: RateLimitState): Promise<void> {
    await this.state.storage.put(RATE_LIMIT_KEY, state);
  }
}

/** The caller's IP, forwarded by the Worker (internal hop strips `cf-connecting-ip`). */
function clientKey(request: Request): string {
  return request.headers.get("x-client-ip") || request.headers.get("cf-connecting-ip") || "unknown";
}
