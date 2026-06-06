import { CARD_CATALOG, type CardDefinition } from "@twcardgame/cards";
import { applyXpAndComputeLevelUps, type AiDifficulty, type AiTheme, type DevTestMatchSetup, type RewardSummary } from "@twcardgame/shared";
import { assetUrl, escapeAttr, escapeHtml } from "../ui.js";
import type { MenuScreen } from "./types.js";

export const menuLabel = "Dev Test";

type OnBinder = <T extends EventTarget>(
  target: T | null | undefined,
  type: string,
  key: string,
  listener: (event: Event) => void,
  options?: AddEventListenerOptions
) => void;

type DevCardSlot = "hand" | "playerBoard" | "opponentBoard";

type DevCardSlotConfig = {
  title: string;
  searchLabel: string;
  max: number;
  minionOnly: boolean;
  emptyText: string;
};

const devCardSlots: Record<DevCardSlot, DevCardSlotConfig> = {
  hand: {
    title: "Hand cards",
    searchLabel: "Search cards to add to hand",
    max: 10,
    minionOnly: false,
    emptyText: "No hand cards selected."
  },
  playerBoard: {
    title: "Player board",
    searchLabel: "Search minions to add to player board",
    max: 7,
    minionOnly: true,
    emptyText: "No player minions selected."
  },
  opponentBoard: {
    title: "Opponent board",
    searchLabel: "Search minions to add to opponent board",
    max: 7,
    minionOnly: true,
    emptyText: "No opponent minions selected."
  }
};

const devCardSlotOrder: DevCardSlot[] = ["hand", "playerBoard", "opponentBoard"];
const selectedDevCards: Record<DevCardSlot, string[]> = {
  hand: [],
  playerBoard: [],
  opponentBoard: []
};
const devCardRarities = ["COMMON", "RARE", "EPIC", "LEGENDARY"] as const;

export function renderDevTestPanel(busy: boolean): string {
  const screens: MenuScreen[] = ["main", "battle", "ai", "deckEditor", "collection", "shop", "profile", "friends", "leaderboard"];
  return `
    <section class="screen dev-test-screen" data-screen="test">
      <h2>Developer Test Mode</h2>
      <button data-menu-screen="main">Back</button>

      <fieldset>
        <legend>Jump to screen</legend>
        <select id="dev-test-screen">
          ${screens.map((screen) => `<option value="${screen}">${screen}</option>`).join("")}
        </select>
        <button id="dev-test-jump" type="button">Jump</button>
      </fieldset>

      <fieldset>
        <legend>PvE match setup</legend>
        <div class="dev-test-card-selectors">
          ${devCardSlotOrder.map(renderDevCardSelector).join("")}
        </div>
        <label>Player HP <input id="dev-test-player-hp" type="number" value="30" /></label>
        <label>Opponent HP <input id="dev-test-opponent-hp" type="number" value="30" /></label>
        <label>Player mana current <input id="dev-test-player-mana-current" type="number" value="10" /></label>
        <label>Player mana max <input id="dev-test-player-mana-max" type="number" value="10" /></label>
        <label>Opponent mana current <input id="dev-test-opponent-mana-current" type="number" value="10" /></label>
        <label>Opponent mana max <input id="dev-test-opponent-mana-max" type="number" value="10" /></label>
        <label class="dev-test-toggle"><input id="dev-test-player-infinite-mana" type="checkbox" /> Player infinite mana</label>
        <label class="dev-test-toggle"><input id="dev-test-opponent-infinite-mana" type="checkbox" /> Opponent infinite mana</label>
        <label>Turn number <input id="dev-test-turn-number" type="number" value="1" /></label>
        <label>Active seat
          <select id="dev-test-active-seat">
            <option value="player1">player1</option>
            <option value="player2">player2</option>
          </select>
        </label>
        <button id="dev-test-start-pve" type="button" ${busy ? "disabled" : ""}>Start PvE Test Match</button>
      </fieldset>

      <fieldset>
        <legend>Reward screen</legend>
        <label>Result
          <select id="dev-test-reward-result">
            <option value="win">win</option>
            <option value="loss">loss</option>
          </select>
        </label>
        <label>Mode
          <select id="dev-test-reward-mode">
            <option value="pve">pve</option>
            <option value="pvp">pvp</option>
          </select>
        </label>
        <label>Source
          <select id="dev-test-reward-source">
            <option value="pve_first">pve_first</option>
            <option value="pve_repeat">pve_repeat</option>
            <option value="pvp">pvp</option>
            <option value="none">none</option>
          </select>
        </label>
        <label>XP before <input id="dev-test-xp-before" type="number" value="0" /></label>
        <label>XP gained <input id="dev-test-xp-gained" type="number" value="100" /></label>
        <label>XP after <input id="dev-test-xp-after" type="number" placeholder="auto" /></label>
        <label>Level before <input id="dev-test-level-before" type="number" value="1" /></label>
        <label>Level after <input id="dev-test-level-after" type="number" placeholder="auto" /></label>
        <label>Level-ups CSV <input id="dev-test-level-ups" placeholder="auto, or 2:100,3:100" /></label>
        <label>Gold before <input id="dev-test-gold-before" type="number" value="0" /></label>
        <label>Gold gained <input id="dev-test-gold-gained" type="number" placeholder="auto" /></label>
        <label>Gold after <input id="dev-test-gold-after" type="number" placeholder="auto" /></label>
        <label>First victory gold <input id="dev-test-gold-first" type="number" value="50" /></label>
        <label>Level-up gold <input id="dev-test-gold-level" type="number" placeholder="auto" /></label>
        <button id="dev-test-reward" type="button">Show Reward Screen</button>
      </fieldset>
    </section>
  `;
}

export function bindDevTestActions(opts: {
  on: OnBinder;
  jump: (target: MenuScreen) => void;
  startPve: (setup: DevTestMatchSetup) => void;
  showReward: (summary: RewardSummary) => void;
  getAiTheme: () => AiTheme;
  getAiDifficulty: () => AiDifficulty;
}): void {
  opts.on(document.querySelector<HTMLButtonElement>("#dev-test-jump"), "click", "dev-test-jump", () => {
    const target = document.querySelector<HTMLSelectElement>("#dev-test-screen")?.value as MenuScreen | undefined;
    if (target) opts.jump(target);
  });
  opts.on(document.querySelector<HTMLButtonElement>("#dev-test-start-pve"), "click", "dev-test-start-pve", () => {
    opts.startPve(readDevTestMatchSetup());
  });
  const screen = document.querySelector<HTMLElement>(".dev-test-screen");
  opts.on(screen, "input", "dev-test-card-search", (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : undefined;
    const slot = parseDevCardSlot(input?.dataset.devCardSearch);
    if (slot) updateDevCardSelector(slot);
  });
  opts.on(screen, "change", "dev-test-card-filter", (event) => {
    const select = event.target instanceof HTMLSelectElement ? event.target : undefined;
    const slot = parseDevCardSlot(select?.dataset.devCardFilter);
    if (slot) updateDevCardSelector(slot);
  });
  opts.on(screen, "click", "dev-test-card-selector-click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : undefined;
    const addButton = target?.closest<HTMLButtonElement>("[data-dev-add-card]");
    if (addButton) {
      const slot = parseDevCardSlot(addButton.dataset.devSlot);
      const cardId = addButton.dataset.devAddCard;
      if (slot && cardId) addDevCard(slot, cardId);
      return;
    }
    const removeButton = target?.closest<HTMLButtonElement>("[data-dev-remove-card]");
    if (removeButton) {
      const slot = parseDevCardSlot(removeButton.dataset.devSlot);
      const index = Number.parseInt(removeButton.dataset.devRemoveCard ?? "", 10);
      if (slot && Number.isFinite(index)) removeDevCard(slot, index);
    }
  });
  opts.on(document.querySelector<HTMLButtonElement>("#dev-test-reward"), "click", "dev-test-reward", () => {
    opts.showReward(readDevTestRewardSummary(opts.getAiTheme(), opts.getAiDifficulty()));
  });
}

function readDevTestMatchSetup(): DevTestMatchSetup {
  const activeSeatValue = readInputValue("dev-test-active-seat");
  return {
    handCardIds: [...selectedDevCards.hand],
    playerBoardCardIds: [...selectedDevCards.playerBoard],
    opponentBoardCardIds: [...selectedDevCards.opponentBoard],
    playerHp: readNumberInput("dev-test-player-hp", 30),
    opponentHp: readNumberInput("dev-test-opponent-hp", 30),
    playerMana: {
      current: readNumberInput("dev-test-player-mana-current", 10),
      max: readNumberInput("dev-test-player-mana-max", 10)
    },
    opponentMana: {
      current: readNumberInput("dev-test-opponent-mana-current", 10),
      max: readNumberInput("dev-test-opponent-mana-max", 10)
    },
    infiniteMana: {
      player1: readCheckedInput("dev-test-player-infinite-mana"),
      player2: readCheckedInput("dev-test-opponent-infinite-mana")
    },
    turnNumber: readNumberInput("dev-test-turn-number", 1),
    activeSeat: activeSeatValue === "player2" ? "player2" : "player1"
  };
}

function renderDevCardSelector(slot: DevCardSlot): string {
  const config = devCardSlots[slot];
  return `
    <section class="dev-card-selector" data-dev-card-selector="${slot}">
      <div class="dev-card-selector-header">
        <h3>${escapeHtml(config.title)}</h3>
        <span id="dev-test-count-${slot}" class="dev-card-count">${selectedDevCards[slot].length}/${config.max}</span>
      </div>
      <label class="dev-card-search-label" for="dev-test-search-${slot}">
        <span>${escapeHtml(config.searchLabel)}</span>
        <input id="dev-test-search-${slot}" data-dev-card-search="${slot}" type="search" autocomplete="off" placeholder="Name, ID, category" />
      </label>
      <div class="dev-card-filters">
        ${renderDevCardTypeFilter(slot)}
        <label>
          <span>Category</span>
          <select id="dev-test-category-${slot}" data-dev-card-filter="${slot}">
            <option value="all">All</option>
            ${devCardCategories(slot).map((category) => `<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Rarity</span>
          <select id="dev-test-rarity-${slot}" data-dev-card-filter="${slot}">
            <option value="all">All</option>
            ${devCardRarities.map((rarity) => `<option value="${rarity}">${rarity}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Cost</span>
          <select id="dev-test-cost-${slot}" data-dev-card-filter="${slot}">
            <option value="all">All</option>
            <option value="0-2">0-2</option>
            <option value="3-5">3-5</option>
            <option value="6-10">6+</option>
          </select>
        </label>
      </div>
      <div id="dev-test-selected-${slot}" class="dev-selected-cards">
        ${renderSelectedDevCards(slot)}
      </div>
      <div id="dev-test-result-summary-${slot}" class="dev-card-result-summary">
        ${renderDevCardResultSummary(slot, "")}
      </div>
      <div id="dev-test-results-${slot}" class="dev-card-results">
        ${renderDevCardResults(slot)}
      </div>
    </section>
  `;
}

function renderDevCardTypeFilter(slot: DevCardSlot): string {
  if (devCardSlots[slot].minionOnly) {
    return `
      <label>
        <span>Type</span>
        <select id="dev-test-type-${slot}" data-dev-card-filter="${slot}" disabled>
          <option value="MINION">MINION</option>
        </select>
      </label>
    `;
  }
  return `
    <label>
      <span>Type</span>
      <select id="dev-test-type-${slot}" data-dev-card-filter="${slot}">
        <option value="all">All</option>
        <option value="MINION">MINION</option>
        <option value="NEWS">NEWS</option>
      </select>
    </label>
  `;
}

function renderSelectedDevCards(slot: DevCardSlot): string {
  const selected = selectedDevCards[slot];
  if (selected.length === 0) return `<p class="dev-card-empty">${escapeHtml(devCardSlots[slot].emptyText)}</p>`;
  return selected
    .map((cardId, index) => {
      const card = cardById(cardId);
      return `
        <div class="dev-selected-card" data-dom-key="dev-selected-${slot}-${index}-${escapeAttr(cardId)}">
          <span class="dev-selected-card-name">${escapeHtml(card?.name ?? cardId)}</span>
          <span class="dev-selected-card-meta">${escapeHtml(card?.id ?? cardId)}${card ? ` - ${card.cost}` : ""}</span>
          <button type="button" data-dev-slot="${slot}" data-dev-remove-card="${index}" aria-label="Remove ${escapeAttr(card?.name ?? cardId)}">Remove</button>
        </div>
      `;
    })
    .join("");
}

function renderDevCardResultSummary(slot: DevCardSlot, query: string): string {
  const total = filteredDevCards(slot, query).length;
  return `${total} matching cards`;
}

function renderDevCardResults(slot: DevCardSlot): string {
  const config = devCardSlots[slot];
  const full = selectedDevCards[slot].length >= config.max;
  const query = readInputValue(`dev-test-search-${slot}`);
  const cards = filteredDevCards(slot, query);
  if (cards.length === 0) return `<p class="dev-card-empty">No matching cards.</p>`;
  return cards.map((card) => renderDevCardResult(slot, card, full)).join("");
}

function renderDevCardResult(slot: DevCardSlot, card: CardDefinition, full: boolean): string {
  const addDisabled = full ? "disabled" : "";
  return `
    <article class="dev-card-result" data-dom-key="dev-card-result-${slot}-${escapeAttr(card.id)}">
      <img src="${escapeAttr(assetUrl(card.image))}" alt="" loading="lazy" />
      <div class="dev-card-result-body">
        <strong>${escapeHtml(card.name)}</strong>
        <span>${escapeHtml(card.id)} - ${escapeHtml(card.type)} - ${escapeHtml(card.category)}</span>
      </div>
      <span class="dev-card-cost">${card.cost}</span>
      <button type="button" data-dev-slot="${slot}" data-dev-add-card="${escapeAttr(card.id)}" ${addDisabled}>Add</button>
    </article>
  `;
}

function filteredDevCards(slot: DevCardSlot, query: string): CardDefinition[] {
  const normalized = query.trim().toLowerCase();
  const type = readInputValue(`dev-test-type-${slot}`) || (devCardSlots[slot].minionOnly ? "MINION" : "all");
  const category = readInputValue(`dev-test-category-${slot}`) || "all";
  const rarity = readInputValue(`dev-test-rarity-${slot}`) || "all";
  const costRange = readInputValue(`dev-test-cost-${slot}`) || "all";
  return CARD_CATALOG
    .filter((card) => !devCardSlots[slot].minionOnly || card.type === "MINION")
    .filter((card) => type === "all" || card.type === type)
    .filter((card) => category === "all" || card.category === category)
    .filter((card) => rarity === "all" || card.rarity === rarity)
    .filter((card) => costMatches(card.cost, costRange))
    .filter((card) => {
      if (!normalized) return true;
      return [card.id, card.name, card.category, card.type].some((part) => part.toLowerCase().includes(normalized));
    })
    .sort(compareDevCards);
}

function devCardCategories(slot: DevCardSlot): string[] {
  return [...new Set(CARD_CATALOG
    .filter((card) => !devCardSlots[slot].minionOnly || card.type === "MINION")
    .map((card) => card.category))]
    .sort((a, b) => a.localeCompare(b));
}

function costMatches(cost: number, range: string): boolean {
  if (range === "0-2") return cost >= 0 && cost <= 2;
  if (range === "3-5") return cost >= 3 && cost <= 5;
  if (range === "6-10") return cost >= 6;
  return true;
}

function compareDevCards(a: CardDefinition, b: CardDefinition): number {
  return a.cost - b.cost || a.id.localeCompare(b.id);
}

function addDevCard(slot: DevCardSlot, cardId: string): void {
  const card = cardById(cardId);
  const config = devCardSlots[slot];
  if (!card) return;
  if (config.minionOnly && card.type !== "MINION") return;
  if (selectedDevCards[slot].length >= config.max) return;
  selectedDevCards[slot].push(cardId);
  updateDevCardSelector(slot);
}

function removeDevCard(slot: DevCardSlot, index: number): void {
  if (index < 0 || index >= selectedDevCards[slot].length) return;
  selectedDevCards[slot].splice(index, 1);
  updateDevCardSelector(slot);
}

function updateDevCardSelector(slot: DevCardSlot): void {
  const search = document.querySelector<HTMLInputElement>(`#dev-test-search-${slot}`)?.value ?? "";
  const selected = document.querySelector<HTMLElement>(`#dev-test-selected-${slot}`);
  const results = document.querySelector<HTMLElement>(`#dev-test-results-${slot}`);
  const summary = document.querySelector<HTMLElement>(`#dev-test-result-summary-${slot}`);
  const count = document.querySelector<HTMLElement>(`#dev-test-count-${slot}`);
  if (selected) selected.innerHTML = renderSelectedDevCards(slot);
  if (summary) summary.textContent = renderDevCardResultSummary(slot, search);
  if (results) results.innerHTML = renderDevCardResults(slot);
  if (count) count.textContent = `${selectedDevCards[slot].length}/${devCardSlots[slot].max}`;
}

function parseDevCardSlot(value: string | undefined): DevCardSlot | undefined {
  return value && Object.prototype.hasOwnProperty.call(devCardSlots, value) ? value as DevCardSlot : undefined;
}

function cardById(cardId: string): CardDefinition | undefined {
  return CARD_CATALOG.find((card) => card.id === cardId);
}

function readDevTestRewardSummary(aiTheme: AiTheme, aiDifficulty: AiDifficulty): RewardSummary {
  const result = readInputValue("dev-test-reward-result") === "loss" ? "loss" : "win";
  const mode = readInputValue("dev-test-reward-mode") === "pvp" ? "pvp" : "pve";
  const sourceInput = readInputValue("dev-test-reward-source");
  const xpBefore = readNumberInput("dev-test-xp-before", 0);
  const xpGained = readNumberInput("dev-test-xp-gained", 0);
  const levelBefore = readNumberInput("dev-test-level-before", 1);
  const computedProgress = applyXpAndComputeLevelUps(xpBefore, levelBefore, xpGained);
  const explicitLevelUps = readInputValue("dev-test-level-ups").trim() ? parseDevTestLevelUps() : undefined;
  const levelUps = explicitLevelUps ?? computedProgress.levelUps;
  const goldBefore = readNumberInput("dev-test-gold-before", 0);
  const firstVictory = readNumberInput("dev-test-gold-first", 0);
  const levelGold = readOptionalNumberInput("dev-test-gold-level") ?? levelUps.reduce((sum, item) => sum + item.goldAwarded, 0);
  const goldGained = readOptionalNumberInput("dev-test-gold-gained") ?? firstVictory + levelGold;
  return {
    result,
    mode,
    source: (["pve_first", "pve_repeat", "pvp", "none"].includes(sourceInput) ? sourceInput : "none") as RewardSummary["source"],
    aiTheme: mode === "pve" ? aiTheme : null,
    aiDifficulty: mode === "pve" ? aiDifficulty : null,
    xp: {
      before: xpBefore,
      after: readOptionalNumberInput("dev-test-xp-after") ?? computedProgress.xpAfter,
      gained: xpGained
    },
    level: {
      before: levelBefore,
      after: readOptionalNumberInput("dev-test-level-after") ?? computedProgress.levelAfter
    },
    levelUps,
    gold: {
      before: goldBefore,
      after: readOptionalNumberInput("dev-test-gold-after") ?? goldBefore + goldGained,
      gained: goldGained,
      breakdown: {
        ...(firstVictory > 0 ? { firstVictory } : {}),
        ...(levelGold > 0 ? { levelUps: levelGold } : {})
      }
    }
  };
}

function parseDevTestLevelUps(): Array<{ level: number; goldAwarded: number }> {
  return readCsvInput("dev-test-level-ups")
    .map((entry) => {
      const [levelRaw, goldRaw] = entry.split(":");
      const level = Number.parseInt(levelRaw ?? "", 10);
      const goldAwarded = Number.parseInt(goldRaw ?? "0", 10);
      if (!Number.isFinite(level)) return undefined;
      return { level, goldAwarded: Number.isFinite(goldAwarded) ? goldAwarded : 0 };
    })
    .filter((entry): entry is { level: number; goldAwarded: number } => Boolean(entry));
}

function readCsvInput(id: string): string[] {
  return readInputValue(id)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function readNumberInput(id: string, fallback: number): number {
  const value = Number.parseInt(readInputValue(id), 10);
  return Number.isFinite(value) ? value : fallback;
}

function readOptionalNumberInput(id: string): number | undefined {
  const raw = readInputValue(id).trim();
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

function readCheckedInput(id: string): boolean {
  const element = document.getElementById(id);
  return element instanceof HTMLInputElement ? element.checked : false;
}

function readInputValue(id: string): string {
  const element = document.getElementById(id);
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element.value : "";
}
