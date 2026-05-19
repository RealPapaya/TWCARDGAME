import { monitor } from "@colyseus/monitor";
import { Server } from "colyseus";
import { BotRoom } from "./BotRoom.js";
import { GameRoom } from "./GameRoom.js";
import { lookupRoomIdByJoinCode, normalizeJoinCode } from "./privateRooms.js";

const port = Number(process.env.PORT ?? 2567);

const gameServer = new Server({
  gracefullyShutdown: true,
  express: (app) => {
    app.get("/health", (_req: unknown, res: { json: (body: unknown) => void }) => {
      res.json({
        ok: true,
        service: "twcardgame-v2-server",
        supabase: {
          configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
        }
      });
    });
    app.get(
      "/private-rooms/:code",
      (req: { params: { code: string } }, res: { status: (code: number) => { json: (body: unknown) => void }; json: (body: unknown) => void }) => {
        const code = normalizeJoinCode(req.params.code ?? "");
        const roomId = lookupRoomIdByJoinCode(code);
        if (!roomId) {
          res.status(404).json({ ok: false, error: "Room not found." });
          return;
        }
        res.json({ ok: true, roomId, joinCode: code });
      }
    );
    app.use("/colyseus", monitor());
  }
});

gameServer.define("pvp", GameRoom).filterBy(["joinCode"]);
gameServer.define("pve", BotRoom);
gameServer.onBeforeShutdown(() => {
  gameServer.removeRoomType("pvp");
  gameServer.removeRoomType("pve");
  console.log("TWCARDGAME v2 server is draining rooms.");
});

await gameServer.listen(port);
console.log(`TWCARDGAME v2 Colyseus server listening on ws://localhost:${port}`);
