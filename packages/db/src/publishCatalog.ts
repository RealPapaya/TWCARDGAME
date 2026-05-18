import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import { createSupabaseServerClient, publishCardCatalogSnapshot } from "./index.js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to publish the catalog.");
  process.exit(1);
}

const client = createSupabaseServerClient({ url, serviceRoleKey });
await publishCardCatalogSnapshot(client, {
  version: CARD_CATALOG_VERSION,
  cards: CARD_CATALOG
});

console.log(`Published card catalog ${CARD_CATALOG_VERSION} (${CARD_CATALOG.length} cards).`);
