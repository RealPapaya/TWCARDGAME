import { applyXpAndComputeLevelUps, type AiDifficulty, type AiTheme, type DevTestMatchSetup, type RewardSummary } from "@twcardgame/shared";
import type { MenuScreen } from "./types.js";

export const menuLabel = "Dev Test";

type OnBinder = <T extends EventTarget>(
  target: T | null | undefined,
  type: string,
  key: string,
  listener: (event: Event) => void,
  options?: AddEventListenerOptions
) => void;

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
        <label>Target card only <input id="dev-test-target-card" placeholder="TW001" /></label>
        <label>Custom hand CSV <input id="dev-test-hand" placeholder="TW001,TW002,S001" /></label>
        <label>Player board CSV <input id="dev-test-player-board" placeholder="TW010,TW011" /></label>
        <label>Opponent board CSV <input id="dev-test-opponent-board" placeholder="TW020,TW021" /></label>
        <label>Player HP <input id="dev-test-player-hp" type="number" value="30" /></label>
        <label>Opponent HP <input id="dev-test-opponent-hp" type="number" value="30" /></label>
        <label>Player mana current <input id="dev-test-player-mana-current" type="number" value="10" /></label>
        <label>Player mana max <input id="dev-test-player-mana-max" type="number" value="10" /></label>
        <label>Opponent mana current <input id="dev-test-opponent-mana-current" type="number" value="10" /></label>
        <label>Opponent mana max <input id="dev-test-opponent-mana-max" type="number" value="10" /></label>
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
  opts.on(document.querySelector<HTMLButtonElement>("#dev-test-reward"), "click", "dev-test-reward", () => {
    opts.showReward(readDevTestRewardSummary(opts.getAiTheme(), opts.getAiDifficulty()));
  });
}

function readDevTestMatchSetup(): DevTestMatchSetup {
  const targetCard = readInputValue("dev-test-target-card").trim();
  const handCardIds = targetCard ? [targetCard] : readCsvInput("dev-test-hand");
  const activeSeatValue = readInputValue("dev-test-active-seat");
  return {
    handCardIds,
    playerBoardCardIds: readCsvInput("dev-test-player-board"),
    opponentBoardCardIds: readCsvInput("dev-test-opponent-board"),
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
    turnNumber: readNumberInput("dev-test-turn-number", 1),
    activeSeat: activeSeatValue === "player2" ? "player2" : "player1"
  };
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

function readInputValue(id: string): string {
  const element = document.getElementById(id);
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element.value : "";
}
