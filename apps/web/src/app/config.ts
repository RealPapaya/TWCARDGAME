import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const defaultServerUrl = import.meta.env.VITE_COLYSEUS_URL || "ws://localhost:2567";

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
