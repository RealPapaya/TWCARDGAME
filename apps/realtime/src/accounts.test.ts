import { describe, expect, it } from "vitest";
import { createAccountStore, devAccountStore } from "./accounts.js";
import { isHumanUser, type RealtimeEnv } from "./matchServices.js";

const SUPABASE_ENV: RealtimeEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key"
};

const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const VICTIM_UUID = "44444444-4444-4444-8444-444444444444";

describe("createAccountStore — unauthenticated fallback", () => {
  it("downgrades a connection with no access token to a non-human guest id", async () => {
    const store = createAccountStore(SUPABASE_ENV);
    expect(store.enabled).toBe(true);

    // A client connecting WITHOUT an accessToken but spoofing ?userId=<a real
    // account UUID> must not have that UUID honoured — otherwise it could credit
    // rewards to an arbitrary account and bypass deck-ownership checks.
    const setup = await store.resolvePlayerSetup(SESSION_ID, { userId: VICTIM_UUID });

    expect(setup.userId).not.toBe(VICTIM_UUID);
    expect(setup.userId.startsWith("guest:")).toBe(true);
    // The reward/finalize path keys off isHumanUser (UUID shape), so a guest id
    // can never earn XP/gold or be attributed in match history.
    expect(isHumanUser(setup.userId)).toBe(false);
  });

  it("downgrades when an access token is present but no deckId is selected", async () => {
    const store = createAccountStore(SUPABASE_ENV);
    const setup = await store.resolvePlayerSetup(SESSION_ID, {
      accessToken: "some-token",
      userId: VICTIM_UUID
    });
    expect(isHumanUser(setup.userId)).toBe(false);
    expect(setup.userId.startsWith("guest:")).toBe(true);
  });
});

describe("devAccountStore (no Supabase configured)", () => {
  it("falls back to the default deck when no explicit deck is given", async () => {
    const setup = await devAccountStore.resolvePlayerSetup(SESSION_ID, {});
    expect(setup.deckIds.length).toBeGreaterThan(0);
  });
});
