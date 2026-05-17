import { CARD_CATALOG } from "./catalog.js";
import { validateCatalog } from "./validation.js";

const result = validateCatalog(CARD_CATALOG);

if (!result.valid) {
  console.error(result.errors.join("\n"));
  process.exit(1);
}

console.log(`Validated ${CARD_CATALOG.length} cards.`);
