import { monitor } from "@colyseus/monitor";
import { Server } from "colyseus";
import { createSupabaseServerClient, resetBetaDatabase } from "@twcardgame/db";
import { BotRoom } from "./BotRoom.js";
import { GameRoom } from "./GameRoom.js";
import { logger } from "./logger.js";
import { lookupRoomIdByJoinCode, normalizeJoinCode } from "./privateRooms.js";

const port = Number.parseInt(process.env.PORT || "2567", 10);
const host = process.env.HOST || "0.0.0.0";
const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const betaDbResetEnabled = process.env.BETA_DB_RESET_ENABLED === "true";
const betaDbResetToken = process.env.BETA_DB_RESET_TOKEN;

type HeaderValue = string | string[] | undefined;
type RequestLike = {
  method?: string;
  headers: Record<string, HeaderValue>;
  on(event: "data", listener: (chunk: Buffer | string) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
};
type ResponseLike = {
  setHeader(name: string, value: string): void;
  sendStatus(code: number): void;
  status(code: number): ResponseLike;
  json(body: unknown): void;
};
type NextLike = () => void;

process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", { reason });
});
process.on("uncaughtException", (error) => {
  logger.error("uncaughtException", { error });
  process.exit(1);
});

const gameServer = new Server({
  gracefullyShutdown: true,
  express: (app) => {
    app.use((req: RequestLike, res: ResponseLike, next: NextLike) => {
      res.setHeader("access-control-allow-origin", process.env.WEB_ORIGIN || "*");
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type,x-reset-token");
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      next();
    });
    app.get("/health", (_req: unknown, res: { json: (body: unknown) => void }) => {
      res.json({
        ok: true,
        service: "twcardgame",
        supabase: {
          configured: supabaseConfigured,
          // Presence-only diagnostics — never expose the values. Lets a redeploy
          // reveal exactly which env var Railway is failing to inject.
          hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
          hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
        },
        rewards: {
          enabled: supabaseConfigured
        }
      });
    });
    app.post("/admin/beta-reset-db", async (req: RequestLike, res: ResponseLike) => {
      if (!betaDbResetEnabled) {
        res.status(404).json({ ok: false, error: "Beta DB reset is disabled." });
        return;
      }
      if (!supabaseConfigured) {
        res.status(503).json({ ok: false, error: "Supabase service role is not configured." });
        return;
      }
      try {
        const body = await readJsonBody(req);
        const token = headerString(req.headers["x-reset-token"]) ?? (typeof body.token === "string" ? body.token : "");
        if (!betaDbResetToken || token !== betaDbResetToken) {
          res.status(403).json({ ok: false, error: "Invalid reset token." });
          return;
        }
        const client = createSupabaseServerClient({
          url: process.env.SUPABASE_URL!,
          serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!
        });
        const result = await resetBetaDatabase(client);
        logger.warn("admin.betaResetDb.completed", { deletedAuthUsers: result.deletedAuthUsers });
        res.json({ ok: true, result });
      } catch (error) {
        logger.error("admin.betaResetDb.failed", { error });
        res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "DB reset failed." });
      }
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
  logger.info("server.shutdown.draining");
});

await gameServer.listen(port, host);
logger.info("server.listen", { host, port, supabaseConfigured, rewardsEnabled: supabaseConfigured });

function headerString(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readJsonBody(req: RequestLike): Promise<Record<string, unknown>> {
  const raw = await new Promise<string>((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 1024) reject(new Error("Request body is too large."));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}
