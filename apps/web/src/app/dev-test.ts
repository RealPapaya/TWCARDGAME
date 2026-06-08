import { AMPLIFICATION_DB, CARD_CATALOG, VOTE_EVENT_DB, type CardDefinition } from "@twcardgame/cards";
import {
  AMPLIFICATION_TIERS,
  applyXpAndComputeLevelUps,
  type AiDifficulty,
  type AiTheme,
  type AmplificationTier,
  type DevTestMatchSetup,
  type Phase,
  type RewardSummary
} from "@twcardgame/shared";
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
type DevAmplificationSlot = "turn6" | "turn14";

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
const devPhaseOptions: Array<{ value: Phase; label: string }> = [
  { value: "NORMAL_PLAY", label: "Normal play" },
  { value: "AMPLIFICATION_PHASE", label: "Amplification" },
  { value: "VOTING_PHASE", label: "Vote event" }
];

const DEV_SETTINGS_KEY = "twcardgame.devtest.v1";
const devInput: Record<string, string> = {};
const devChecked: Record<string, boolean> = {};

try {
  const raw = typeof window !== "undefined" ? window.localStorage?.getItem(DEV_SETTINGS_KEY) : null;
  if (raw) {
    const parsed = JSON.parse(raw) as { inputs?: Record<string, string>; checked?: Record<string, boolean>; cards?: Record<DevCardSlot, string[]> };
    Object.assign(devInput, parsed.inputs ?? {});
    Object.assign(devChecked, parsed.checked ?? {});
    const savedCards = parsed.cards;
    if (savedCards) {
      for (const slot of devCardSlotOrder) {
        const arr = savedCards[slot];
        if (Array.isArray(arr)) selectedDevCards[slot] = arr.filter((id): id is string => typeof id === "string");
      }
    }
  }
} catch {
  // ignore localStorage errors
}

function persistDevSettings(): void {
  try {
    window.localStorage.setItem(DEV_SETTINGS_KEY, JSON.stringify({
      inputs: devInput,
      checked: devChecked,
      cards: {
        hand: [...selectedDevCards.hand],
        playerBoard: [...selectedDevCards.playerBoard],
        opponentBoard: [...selectedDevCards.opponentBoard]
      }
    }));
  } catch {
    // ignore
  }
}

function sv(id: string, def: string): string {
  return devInput[id] ?? def;
}

function sc(id: string, def = false): boolean {
  return devChecked[id] ?? def;
}

function applySelectedToOptions(optionsHtml: string, savedValue: string | undefined): string {
  if (!savedValue) return optionsHtml;
  const escaped = escapeAttr(savedValue);
  const cleared = optionsHtml.replace(/ selected(?=>|\s)/g, "");
  return cleared.replace(`value="${escaped}"`, `value="${escaped}" selected`);
}

export function renderDevTestPanel(busy: boolean): string {
  const screens: MenuScreen[] = ["main", "battle", "ai", "deckEditor", "collection", "shop", "profile", "friends", "leaderboard"];
  return `
    <section class="screen dev-test-screen" data-screen="test">
      <div class="dev-test-header">
        <h2>Developer Test Mode</h2>
        <button data-menu-screen="main">Back</button>
      </div>

      <div class="dev-test-dashboard">
        <fieldset class="dev-test-panel dev-test-jump-panel">
          <legend>Jump</legend>
          ${renderSelectControl("dev-test-screen", "Jump Screen", screens.map((screen) => `<option value="${screen}">${screen}</option>`).join(""))}
          <button id="dev-test-jump" type="button">Jump</button>
        </fieldset>

        <fieldset class="dev-test-panel dev-test-match-panel">
          <legend>PvE setup</legend>
          <div class="dev-test-compact-grid">
            ${renderSelectControl("dev-test-turn-preset", "Preset", `<option value="custom">Custom</option><option value="turn6">Turn 6 amp</option><option value="turn14">Turn 14 amp</option><option value="turn20">Turn 20 vote</option><option value="normal">Turn 1 normal</option>`)}
            ${renderSliderControl("dev-test-turn-number", "Turn", 1, 100, 1)}
            ${renderSelectControl("dev-test-phase", "Phase", devPhaseOptions.map((phase) => `<option value="${phase.value}">${phase.label}</option>`).join(""))}
            ${renderSelectControl("dev-test-active-seat", "Active", `<option value="player1">player1</option><option value="player2">player2</option>`)}
            ${renderSliderControl("dev-test-player-hp", "Player HP", 1, 99, 1)}
            ${renderSliderControl("dev-test-opponent-hp", "Opponent HP", 1, 99, 1)}
            ${renderSliderControl("dev-test-player-mana-current", "P mana", 0, 30, 1)}
            ${renderSliderControl("dev-test-player-mana-max", "P max", 0, 30, 1)}
            ${renderSliderControl("dev-test-opponent-mana-current", "O mana", 0, 30, 1)}
            ${renderSliderControl("dev-test-opponent-mana-max", "O max", 0, 30, 1)}
            ${renderSelectControl("dev-test-amp-tier-turn6", "增幅1等級", renderAmplificationTierOptions(AMPLIFICATION_TIERS[0]))}
            ${renderSelectControl("dev-test-amp-tier-turn14", "增幅2等級", renderAmplificationTierOptions(AMPLIFICATION_TIERS[1]))}
            ${renderSelectControl("dev-test-amp-id-turn6", "增幅1內容", renderAmplificationOptions(AMPLIFICATION_TIERS[0]), true)}
            ${renderSelectControl("dev-test-amp-id-turn14", "增幅2內容", renderAmplificationOptions(AMPLIFICATION_TIERS[1]), true)}
            ${renderSelectControl("dev-test-vote-event", "事件", renderVoteEventOptions(), true)}
            <label class="dev-test-control-box dev-test-toggle"><input id="dev-test-player-infinite-mana" type="checkbox" ${sc("dev-test-player-infinite-mana") ? "checked" : ""} /> <span class="dev-test-label-text">P infinite</span></label>
            <label class="dev-test-control-box dev-test-toggle"><input id="dev-test-opponent-infinite-mana" type="checkbox" ${sc("dev-test-opponent-infinite-mana") ? "checked" : ""} /> <span class="dev-test-label-text">O infinite</span></label>
          </div>
          <button id="dev-test-start-pve" type="button" ${busy ? "disabled" : ""}>Start PvE Test Match</button>
        </fieldset>
      </div>

      <div class="dev-test-card-selectors">
        ${devCardSlotOrder.map(renderDevCardSelector).join("")}
      </div>

      <details class="dev-test-reward-details">
        <summary>Reward screen</summary>
        <div class="dev-test-reward-grid">
          ${renderSelectControl("dev-test-reward-result", "Result", `<option value="win">win</option><option value="loss">loss</option>`)}
          ${renderSelectControl("dev-test-reward-mode", "Mode", `<option value="pve">pve</option><option value="pvp">pvp</option>`)}
          ${renderSelectControl("dev-test-reward-source", "Source", `<option value="pve_first">pve_first</option><option value="pve_repeat">pve_repeat</option><option value="pvp">pvp</option><option value="none">none</option>`)}
          ${renderSliderControl("dev-test-xp-before", "XP before", 0, 5000, 1)}
          ${renderSliderControl("dev-test-xp-gained", "XP gained", 0, 5000, 1)}
          ${renderAutoSliderControl("dev-test-xp-after", "XP after", 0, 10000, 1)}
          ${renderSliderControl("dev-test-level-before", "Level before", 1, 100, 1)}
          ${renderAutoSliderControl("dev-test-level-after", "Level after", 1, 100, 1)}
          ${renderTextControl("dev-test-level-ups", "Level-ups CSV", "auto, or 2:100,3:100", true)}
          ${renderSliderControl("dev-test-gold-before", "Gold before", 0, 5000, 1)}
          ${renderAutoSliderControl("dev-test-gold-gained", "Gold gained", 0, 5000, 1)}
          ${renderAutoSliderControl("dev-test-gold-after", "Gold after", 0, 10000, 1)}
          ${renderSliderControl("dev-test-gold-first", "First gold", 0, 1000, 1)}
          ${renderAutoSliderControl("dev-test-gold-level", "Level gold", 0, 5000, 1)}
          <button id="dev-test-reward" type="button">Show Reward Screen</button>
        </div>
      </details>
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
  opts.on(screen, "change", "dev-test-flow-controls", (event) => {
    const select = event.target instanceof HTMLSelectElement ? event.target : undefined;
    if (select?.id === "dev-test-turn-preset") applyDevTurnPreset(select.value);
    if (select?.id === "dev-test-phase") syncDevPhaseDefaults();
    if (select?.id === "dev-test-amp-tier-turn6") updateDevAmplificationOptions("turn6");
    if (select?.id === "dev-test-amp-tier-turn14") updateDevAmplificationOptions("turn14");
  });
  opts.on(screen, "input", "dev-test-turn-input", (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : undefined;
    if (input?.id === "dev-test-turn-number") setInputValue("dev-test-turn-preset", "custom");
  });
  opts.on(screen, "input", "dev-test-range-input", (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : undefined;
    if (input && input.type === "range") {
      const display = document.getElementById(`${input.id}-val`);
      if (display) display.textContent = input.value;
      if (input.id === "dev-test-turn-number") setInputValue("dev-test-turn-preset", "custom");
    }
  });
  opts.on(screen, "change", "dev-test-auto-toggle", (event) => {
    const checkbox = event.target instanceof HTMLInputElement ? event.target : undefined;
    if (checkbox && checkbox.id.endsWith("-auto")) {
      const sliderId = checkbox.id.replace("-auto", "");
      const slider = document.getElementById(sliderId) as HTMLInputElement | null;
      if (slider) slider.disabled = checkbox.checked;
    }
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
  opts.on(screen, "input", "dev-test-persist-input", (event) => {
    const el = event.target;
    if (el instanceof HTMLInputElement) {
      if (el.type === "checkbox") {
        devChecked[el.id] = el.checked;
      } else {
        devInput[el.id] = el.value;
      }
      persistDevSettings();
    }
  });
  opts.on(screen, "change", "dev-test-persist-change", (event) => {
    const el = event.target;
    if (el instanceof HTMLSelectElement) {
      devInput[el.id] = el.value;
      persistDevSettings();
    } else if (el instanceof HTMLInputElement && el.type === "checkbox") {
      devChecked[el.id] = el.checked;
      persistDevSettings();
    }
  });
}

function readDevTestMatchSetup(): DevTestMatchSetup {
  const activeSeatValue = readInputValue("dev-test-active-seat");
  const phase = readDevTestPhase();
  return {
    handCardIds: [...selectedDevCards.hand],
    playerBoardCardIds: [...selectedDevCards.playerBoard],
    opponentBoardCardIds: [...selectedDevCards.opponentBoard],
    playerHp: readNumberInput("dev-test-player-hp", 1),
    opponentHp: readNumberInput("dev-test-opponent-hp", 1),
    playerMana: {
      current: readNumberInput("dev-test-player-mana-current", 1),
      max: readNumberInput("dev-test-player-mana-max", 1)
    },
    opponentMana: {
      current: readNumberInput("dev-test-opponent-mana-current", 1),
      max: readNumberInput("dev-test-opponent-mana-max", 1)
    },
    infiniteMana: {
      player1: readCheckedInput("dev-test-player-infinite-mana"),
      player2: readCheckedInput("dev-test-opponent-infinite-mana")
    },
    turnNumber: readNumberInput("dev-test-turn-number", 1),
    activeSeat: activeSeatValue === "player2" ? "player2" : "player1",
    phase,
    amplificationTiers: {
      turn6: readAmplificationTier("dev-test-amp-tier-turn6"),
      turn14: readAmplificationTier("dev-test-amp-tier-turn14")
    },
    amplificationIds: {
      turn6: readAmplificationId("turn6"),
      turn14: readAmplificationId("turn14")
    },
    voteEventId: readVoteEventId()
  };
}

function renderAmplificationTierOptions(selected: AmplificationTier): string {
  return AMPLIFICATION_TIERS
    .map((tier) => `<option value="${escapeAttr(tier)}" ${tier === selected ? "selected" : ""}>${escapeHtml(tier)}</option>`)
    .join("");
}

function renderAmplificationOptions(tier: AmplificationTier, selectedId?: string): string {
  const options = AMPLIFICATION_DB.filter((entry) => entry.tier === tier);
  const selected = selectedId && options.some((entry) => entry.id === selectedId) ? selectedId : options[0]?.id;
  return options
    .map((entry) => {
      const label = `${entry.name} (${entry.id})`;
      return `<option value="${escapeAttr(entry.id)}" ${entry.id === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function renderVoteEventOptions(selectedId?: string): string {
  const selected = selectedId && VOTE_EVENT_DB.some((event) => event.id === selectedId) ? selectedId : VOTE_EVENT_DB[0]?.id;
  return VOTE_EVENT_DB
    .map((event) => {
      const label = `${event.name} (${event.id})`;
      return `<option value="${escapeAttr(event.id)}" ${event.id === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
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
          <button type="button" data-dev-slot="${slot}" data-dev-remove-card="${index}" aria-label="Remove ${escapeAttr(card?.name ?? cardId)}">x</button>
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
  persistDevSettings();
}

function removeDevCard(slot: DevCardSlot, index: number): void {
  if (index < 0 || index >= selectedDevCards[slot].length) return;
  selectedDevCards[slot].splice(index, 1);
  updateDevCardSelector(slot);
  persistDevSettings();
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

function updateDevAmplificationOptions(slot: DevAmplificationSlot): void {
  const tierId = slot === "turn6" ? "dev-test-amp-tier-turn6" : "dev-test-amp-tier-turn14";
  const selectId = slot === "turn6" ? "dev-test-amp-id-turn6" : "dev-test-amp-id-turn14";
  const select = document.getElementById(selectId);
  if (!(select instanceof HTMLSelectElement)) return;
  const previous = select.value;
  select.innerHTML = renderAmplificationOptions(readAmplificationTier(tierId), previous);
}

function applyDevTurnPreset(value: string): void {
  if (value === "turn6") {
    setInputValue("dev-test-turn-number", "6");
    setInputValue("dev-test-phase", "AMPLIFICATION_PHASE");
    return;
  }
  if (value === "turn14") {
    setInputValue("dev-test-turn-number", "14");
    setInputValue("dev-test-phase", "AMPLIFICATION_PHASE");
    return;
  }
  if (value === "turn20") {
    setInputValue("dev-test-turn-number", "20");
    setInputValue("dev-test-phase", "VOTING_PHASE");
    return;
  }
  if (value === "normal") {
    setInputValue("dev-test-turn-number", "1");
    setInputValue("dev-test-phase", "NORMAL_PLAY");
  }
}

function syncDevPhaseDefaults(): void {
  const phase = readInputValue("dev-test-phase");
  const turn = readNumberInput("dev-test-turn-number", 1);
  if (phase === "AMPLIFICATION_PHASE" && turn !== 6 && turn !== 14) {
    setInputValue("dev-test-turn-number", "6");
    setInputValue("dev-test-turn-preset", "turn6");
  }
  if (phase === "VOTING_PHASE" && turn !== 20) {
    setInputValue("dev-test-turn-number", "20");
    setInputValue("dev-test-turn-preset", "turn20");
  }
  if (phase === "NORMAL_PLAY") setInputValue("dev-test-turn-preset", "custom");
}

function readDevTestPhase(): Phase {
  const phase = readInputValue("dev-test-phase");
  if (phase === "AMPLIFICATION_PHASE" || phase === "VOTING_PHASE") return phase;
  return "NORMAL_PLAY";
}

function readAmplificationTier(id: string): AmplificationTier {
  const value = readInputValue(id) as AmplificationTier;
  return AMPLIFICATION_TIERS.includes(value) ? value : AMPLIFICATION_TIERS[0];
}

function readAmplificationId(slot: DevAmplificationSlot): string | undefined {
  const id = readInputValue(slot === "turn6" ? "dev-test-amp-id-turn6" : "dev-test-amp-id-turn14");
  return AMPLIFICATION_DB.some((entry) => entry.id === id) ? id : undefined;
}

function readVoteEventId(): string | undefined {
  const id = readInputValue("dev-test-vote-event");
  return VOTE_EVENT_DB.some((event) => event.id === id) ? id : undefined;
}

function cardById(cardId: string): CardDefinition | undefined {
  return CARD_CATALOG.find((card) => card.id === cardId);
}

function readDevTestRewardSummary(aiTheme: AiTheme, aiDifficulty: AiDifficulty): RewardSummary {
  const result = readInputValue("dev-test-reward-result") === "loss" ? "loss" : "win";
  const mode = readInputValue("dev-test-reward-mode") === "pvp" ? "pvp" : "pve";
  const sourceInput = readInputValue("dev-test-reward-source");
  const xpBefore = readNumberInput("dev-test-xp-before", 1);
  const xpGained = readNumberInput("dev-test-xp-gained", 1);
  const levelBefore = readNumberInput("dev-test-level-before", 1);
  const computedProgress = applyXpAndComputeLevelUps(xpBefore, levelBefore, xpGained);
  const explicitLevelUps = readInputValue("dev-test-level-ups").trim() ? parseDevTestLevelUps() : undefined;
  const levelUps = explicitLevelUps ?? computedProgress.levelUps;
  const goldBefore = readNumberInput("dev-test-gold-before", 1);
  const firstVictory = readNumberInput("dev-test-gold-first", 1);
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
  const autoCheckbox = document.getElementById(`${id}-auto`) as HTMLInputElement | null;
  if (autoCheckbox && autoCheckbox.checked) return undefined;
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

function setInputValue(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
    element.value = value;
    if (element instanceof HTMLInputElement && element.type === "range") {
      const display = document.getElementById(`${id}-val`);
      if (display) display.textContent = value;
    }
    devInput[id] = value;
    persistDevSettings();
  }
}

function renderSliderControl(
  id: string,
  label: string,
  min: number,
  max: number,
  defaultValue: number,
  isWide = false
): string {
  const value = sv(id, String(defaultValue));
  const wideClass = isWide ? "dev-test-wide" : "";
  return `
    <div class="dev-test-control-box ${wideClass}">
      <div class="dev-test-label-row">
        <span class="dev-test-label-text">${escapeHtml(label)}</span>
        <span class="dev-test-value-box" id="${id}-val">${value}</span>
      </div>
      <input id="${id}" type="range" min="${min}" max="${max}" value="${value}" />
    </div>
  `;
}

function renderAutoSliderControl(
  id: string,
  label: string,
  min: number,
  max: number,
  defaultValue: number,
  isWide = false
): string {
  const value = sv(id, String(defaultValue));
  const isAuto = sc(`${id}-auto`, true);
  const wideClass = isWide ? "dev-test-wide" : "";
  return `
    <div class="dev-test-control-box ${wideClass}">
      <div class="dev-test-label-row">
        <span class="dev-test-label-text">${escapeHtml(label)}</span>
        <div class="dev-test-auto-row">
          <span class="dev-test-value-box" id="${id}-val">${value}</span>
          <label class="dev-test-checkbox-box">
            <input type="checkbox" id="${id}-auto" ${isAuto ? "checked" : ""} />
            <span>Auto</span>
          </label>
        </div>
      </div>
      <input id="${id}" type="range" min="${min}" max="${max}" value="${value}" ${isAuto ? "disabled" : ""} />
    </div>
  `;
}

function renderSelectControl(
  id: string,
  label: string,
  optionsHtml: string,
  isWide = false
): string {
  const wideClass = isWide ? "dev-test-wide" : "";
  const restored = applySelectedToOptions(optionsHtml, devInput[id]);
  return `
    <div class="dev-test-control-box ${wideClass}">
      <div class="dev-test-label-row">
        <span class="dev-test-label-text">${escapeHtml(label)}</span>
      </div>
      <select id="${id}">${restored}</select>
    </div>
  `;
}

function renderTextControl(
  id: string,
  label: string,
  placeholder: string,
  isWide = false
): string {
  const wideClass = isWide ? "dev-test-wide" : "";
  return `
    <div class="dev-test-control-box ${wideClass}">
      <div class="dev-test-label-row">
        <span class="dev-test-label-text">${escapeHtml(label)}</span>
      </div>
      <input id="${id}" type="text" placeholder="${escapeAttr(placeholder)}" />
    </div>
  `;
}
