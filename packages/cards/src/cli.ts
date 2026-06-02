import { AMPLIFICATION_DB, validateAmplificationDb } from "./amplificationDb.js";
import { CARD_CATALOG } from "./catalog.js";
import { validateCatalog } from "./validation.js";
import { VOTE_EVENT_DB, validateVoteEventDb } from "./voteEventDb.js";

const result = validateCatalog(CARD_CATALOG);
const ampResult = validateAmplificationDb(AMPLIFICATION_DB);
const voteResult = validateVoteEventDb(VOTE_EVENT_DB);

const allErrors = [...result.errors, ...ampResult.errors, ...voteResult.errors];
if (allErrors.length > 0) {
  console.error(allErrors.join("\n"));
  process.exit(1);
}

console.log(
  `Validated ${CARD_CATALOG.length} cards, ${AMPLIFICATION_DB.length} amplifications, ${VOTE_EVENT_DB.length} vote events.`
);
