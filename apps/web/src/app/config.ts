import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The Cloudflare realtime Worker is the only transport (the Colyseus client was
// removed in the Phase 3 cut — see docs/cloudflare-migration-roadmap.md §A).
export const defaultServerUrl = import.meta.env.VITE_REALTIME_URL || inferRealtimeUrl();
export const betaDbResetEnabled = import.meta.env.VITE_BETA_DB_RESET_ENABLED === "true";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const forceDevAuth = isLocalDevHost() && new URLSearchParams(location.search).get("auth") === "dev";

export const supabase: SupabaseClient | undefined =
  !forceDevAuth && supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : undefined;

export function isLocalDevHost(): boolean {
  return ["localhost", "127.0.0.1", "0.0.0.0", ""].includes(location.hostname);
}

export function serverHttpUrl(serverUrl = defaultServerUrl): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.origin;
}

function inferRealtimeUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const hostname = formatHostnameForUrl(location.hostname || "localhost");
  return `${protocol}//${hostname}:8787`;
}

function formatHostnameForUrl(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
}
