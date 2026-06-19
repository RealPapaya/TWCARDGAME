import {
  claimPublicMatch,
  createPrivateChallenge,
  emptyLobbyState,
  joinPrivateByCode,
  releasePrivateRoom,
  type LobbyStorageState
} from "./lobbyState.js";

const STORAGE_KEY = "lobby";

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

    if (url.pathname === "/matchmaking/public" && request.method === "POST") {
      const state = await this.load();
      const result = claimPublicMatch(state, Date.now(), () => `public:${crypto.randomUUID()}`);
      await this.save(state);
      return Response.json(result, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/private" && request.method === "POST") {
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

  private async load(): Promise<LobbyStorageState> {
    return (await this.state.storage.get<LobbyStorageState>(STORAGE_KEY)) ?? emptyLobbyState();
  }

  private async save(state: LobbyStorageState): Promise<void> {
    await this.state.storage.put(STORAGE_KEY, state);
  }
}
