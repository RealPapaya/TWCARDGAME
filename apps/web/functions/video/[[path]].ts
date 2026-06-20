/// <reference types="@cloudflare/workers-types" />
import { serveR2Asset, keyFromRequest, type AssetEnv } from "../_lib/r2.js";

// Pages route: serves every `/video/*` request (mode transition clips) from R2.
export const onRequest: PagesFunction<AssetEnv> = (ctx) =>
  serveR2Asset(ctx, keyFromRequest(ctx.request));
