import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type GameTransportKind = "realtime" | "colyseus";

export const gameTransportKind: GameTransportKind =
  import.meta.env.VITE_GAME_TRANSPORT === "colyseus" ? "colyseus" : "realtime";

export const defaultServerUrl =
  import.meta.env.VITE_REALTIME_URL ||
  import.meta.env.VITE_COLYSEUS_URL ||
  (gameTransportKind === "colyseus" ? inferColyseusUrl() : inferRealtimeUrl());
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

function inferColyseusUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const hostname = formatHostnameForUrl(location.hostname || "localhost");
  return `${protocol}//${hostname}:2567`;
}

function inferRealtimeUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const hostname = formatHostnameForUrl(location.hostname || "localhost");
  return `${protocol}//${hostname}:8787`;
}

function formatHostnameForUrl(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
}
