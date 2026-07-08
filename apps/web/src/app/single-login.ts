import type { SupabaseClient } from "@supabase/supabase-js";

const LOGIN_CLIENT_ID_KEY = "twcardgame:login-client-id";

export type LoginWindowClaim = {
  status: "claimed" | "conflict";
  activeClientId?: string | null;
  activeAt?: string | null;
};

let fallbackClientId: string | undefined;

export function loginClientId(): string {
  try {
    const stored = localStorage.getItem(LOGIN_CLIENT_ID_KEY);
    if (stored && stored.length >= 8) return stored;
    const next = createLoginClientId();
    localStorage.setItem(LOGIN_CLIENT_ID_KEY, next);
    return next;
  } catch {
    fallbackClientId ??= createLoginClientId();
    return fallbackClientId;
  }
}

export async function claimLoginWindow(supabase: SupabaseClient, takeover: boolean): Promise<LoginWindowClaim> {
  const { data, error } = await supabase.rpc("claim_login_window", {
    p_client_id: loginClientId(),
    p_takeover: takeover
  });
  if (error) throw error;
  return normalizeClaim(data);
}

export async function keepLoginWindow(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("keep_login_window", {
    p_client_id: loginClientId()
  });
  if (error) throw error;
  return data === true;
}

export async function releaseLoginWindow(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("release_login_window", {
    p_client_id: loginClientId()
  });
  if (error) throw error;
}

function normalizeClaim(data: unknown): LoginWindowClaim {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return { status: "conflict" };
  const value = row as Record<string, unknown>;
  return {
    status: value.status === "claimed" ? "claimed" : "conflict",
    activeClientId: typeof value.active_client_id === "string" ? value.active_client_id : null,
    activeAt: typeof value.active_at === "string" ? value.active_at : null
  };
}

function createLoginClientId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
