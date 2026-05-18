import { CARD_CATALOG } from "@twcardgame/cards";
import { validateDeck } from "@twcardgame/rules";
import { describe, expect, it } from "vitest";
import { createAccountDeckStoreFromEnv, defaultDeckIds, devAccountDeckStore, resolvePlayerSetup } from "./accounts.js";

describe("account deck resolution", () => {
  it("keeps the dev fallback when Supabase credentials are missing", () => {
    expect(createAccountDeckStoreFromEnv({}).enabled).toBe(false);
  });

  it("uses a valid explicit dev deck", async () => {
    const deckIds = defaultDeckIds();
    const setup = await resolvePlayerSetup("session-1234", { userId: "dev-user", displayName: "Dev", deckIds }, devAccountDeckStore);

    expect(setup).toEqual({ userId: "dev-user", displayName: "Dev", deckIds });
  });

  it("falls back to a legal deck in dev mode when no saved deck is provided", async () => {
    const setup = await resolvePlayerSetup("session-1234", {}, devAccountDeckStore);

    expect(setup.userId).toBe("session-1234");
    expect(setup.displayName).toBe("Player sess");
    expect(validateDeck(setup.deckIds, CARD_CATALOG).valid).toBe(true);
  });
});
