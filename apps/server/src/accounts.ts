import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import { createSupabaseServerClient, getAuthenticatedUser, getOwnedDeck, listUserCollection } from "@twcardgame/db";
import { validateDeck } from "@twcardgame/rules";
import type { DevTestMatchSetup } from "@twcardgame/shared";

export interface JoinOptions {
  userId?: string;
  displayName?: string;
  deckIds?: string[];
  deckId?: string;
  accessToken?: string;
  devTest?: DevTestMatchSetup;
}

export interface PlayerSetup {
  userId: string;
  displayName: string;
  deckIds: string[];
  devTest?: DevTestMatchSetup;
}

export interface AccountDeckStore {
  enabled: boolean;
  resolvePlayerSetup(sessionId: string, options: JoinOptions): Promise<PlayerSetup>;
}

export function createAccountDeckStoreFromEnv(env: NodeJS.ProcessEnv = process.env): AccountDeckStore {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return devAccountDeckStore;

  const client = createSupabaseServerClient({ url, serviceRoleKey });
  return {
    enabled: true,
    async resolvePlayerSetup(_sessionId, options) {
      const user = await getAuthenticatedUser(client, options.accessToken ?? "");
      const deckId = options.deckId;
      if (!deckId) throw new Error("A saved deck id is required to join matchmaking.");

      const deck = await getOwnedDeck(client, { userId: user.id, deckId });
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

export const devAccountDeckStore: AccountDeckStore = {
  enabled: false,
  async resolvePlayerSetup(sessionId, options) {
    const explicitDeck = options.deckIds ?? [];
    const deckIds = validateDeck(explicitDeck, CARD_CATALOG).valid ? explicitDeck : defaultDeckIds();
    return {
      userId: options.userId || sessionId,
      displayName: options.displayName || `Player ${sessionId.slice(0, 4)}`,
      deckIds
    };
  }
};

export async function resolvePlayerSetup(
  sessionId: string,
  options: JoinOptions,
  accountStore: AccountDeckStore
): Promise<PlayerSetup> {
  return accountStore.resolvePlayerSetup(sessionId, options);
}

export function defaultDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}

function resolveDisplayName(input: string | undefined, metadata: Record<string, unknown> | undefined): string {
  if (input) return input;
  const metaName = metadata?.display_name ?? metadata?.name;
  return typeof metaName === "string" && metaName.trim() ? metaName : "Player";
}
