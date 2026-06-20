/// <reference types="@cloudflare/workers-types" />
import { serveR2Asset, keyFromRequest, type AssetEnv } from "../_lib/r2.js";

// Pages route: serves every `/images/*` request from the R2 bucket. The web
// sources reference these paths root-relative and unchanged (Phase 4).
export const onRequest: PagesFunction<AssetEnv> = (ctx) =>
  serveR2Asset(ctx, keyFromRequest(ctx.request));
