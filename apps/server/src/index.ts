import { monitor } from "@colyseus/monitor";
import { Server } from "colyseus";
import { GameRoom } from "./GameRoom.js";

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
    app.use("/colyseus", monitor());
  }
});

gameServer.define("pvp", GameRoom);
gameServer.onBeforeShutdown(() => {
  gameServer.removeRoomType("pvp");
  console.log("TWCARDGAME v2 server is draining PvP rooms.");
});

await gameServer.listen(port);
console.log(`TWCARDGAME v2 Colyseus server listening on ws://localhost:${port}`);
