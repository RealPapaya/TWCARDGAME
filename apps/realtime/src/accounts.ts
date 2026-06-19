import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import { createSupabaseServerClient, getAuthenticatedUser, getOwnedDeck, listUserCollection } from "@twcardgame/db";
import { validateDeck } from "@twcardgame/rules";
import { defaultDeckIds } from "./decks.js";
import type { PlayerSetup } from "./GameSession.js";
import type { RealtimeEnv } from "./matchServices.js";

/**
 * Join-time identity + deck resolution — the Durable Object port of
 * apps/server/src/accounts.ts. Like its origin it is env-gated: with Supabase
 * configured it resolves the signed-in user's owned, legal deck; without it (the
 * PoC / room-code flow) it validates any explicit deck and otherwise falls back
 * to the dev deck. Crucially it runs `validateDeck` on BOTH paths so an illegal
 * deck can never enter a match (the old DO read the raw `?deck=` param unchecked).
 */

export interface JoinOptions {
  userId?: string;
  displayName?: string;
  deckIds?: string[];
  /** A saved deck id (Supabase path). */
  deckId?: string;
  /** Supabase access token (JWT) identifying the player (Supabase path). */
  accessToken?: string;
}

export interface AccountStore {
  enabled: boolean;
  resolvePlayerSetup(sessionId: string, options: JoinOptions): Promise<PlayerSetup>;
}

/** Dev/PoC store (port of devAccountDeckStore): validate the explicit deck, else default. */
export const devAccountStore: AccountStore = {
  enabled: false,
  async resolvePlayerSetup(sessionId, options) {
    const explicit = options.deckIds ?? [];
    const deckIds = explicit.length > 0 && validateDeck(explicit, CARD_CATALOG).valid ? explicit : defaultDeckIds();
    return {
      userId: options.userId || sessionId,
      displayName: options.displayName || `Player ${sessionId.slice(0, 4)}`,
      deckIds
    };
  }
};

export function createAccountStore(env: RealtimeEnv): AccountStore {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return devAccountStore;

  const client = createSupabaseServerClient({ url, serviceRoleKey });
  return {
    enabled: true,
    async resolvePlayerSetup(sessionId, options) {
      // A connection without auth context (e.g. a quick room-code PoC join) stays
      // playable via the dev path rather than being rejected.
      if (!options.accessToken || !options.deckId) {
        return devAccountStore.resolvePlayerSetup(sessionId, options);
      }
      const user = await getAuthenticatedUser(client, options.accessToken);
      const deck = await getOwnedDeck(client, { userId: user.id, deckId: options.deckId });
      const collection = await listUserCollection(client, { userId: user.id, cardCatalogVersion: CARD_CATALOG_VERSION });
      const validation = validateDeck(
        deck.card_ids,
        CARD_CATALOG,
        collection.map((card) => ({ cardId: card.card_id, quantity: card.quantity }))
      );
      if (!validation.valid) throw new Error(`Deck ${deck.id} is illegal: ${validation.errors.join(" ")}`);

      return {
        userId: user.id,
        displayName: resolveDisplayName(options.displayName, user.user_metadata),
        deckIds: deck.card_ids
      };
    }
  };
}

function resolveDisplayName(input: string | undefined, metadata: Record<string, unknown> | undefined): string {
  if (input) return input;
  const metaName = metadata?.display_name ?? metadata?.name;
  return typeof metaName === "string" && metaName.trim() ? metaName : "Player";
}
