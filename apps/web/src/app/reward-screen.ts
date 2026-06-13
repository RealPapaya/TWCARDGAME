import {
  AI_THEMES,
  getXPRequiredForLevel,
  MAX_LEVEL,
  type AiDifficulty,
  type AiTheme,
  type RewardSummary
} from "@twcardgame/shared";
import type { ClientViewState, RewardAnimationState } from "./types.js";

const XP_TWEEN_PER_LEVEL_MS = 700;
const LEVEL_UP_FLASH_MS = 220;
const GOLD_TWEEN_MIN_MS = 600;
const GOLD_TWEEN_MAX_MS = 1500;
const GOLD_TWEEN_PER_GOLD_MS = 8;

// Difficulty labels match the v2 setup screen (普通級/專家級/大師級 in
// renderAiBattleSetupScreen).
const DIFFICULTY_LABELS: Record<AiDifficulty, string> = {
  easy: "普通級",
  normal: "專家級",
  hard: "大師級"
};

let animationFrameId: number | undefined;
let activeAnimation:
  | {
      summary: RewardSummary;
      startedAtMs: number;
      // Pre-computed timeline (cumulative ms) of stage transitions:
      // entries are (level number reached, time at which the bar finishes
      // filling for that step). The last entry is the final xp level.
      xpSteps: Array<{ atMs: number; level: number; xpInto: number; xpRequired: number; flash: boolean }>;
      xpEndMs: number;
      goldStartMs: number;
      goldEndMs: number;
      onFrame: () => void;
    }
  | undefined;

export function renderRewardOverlay(view: ClientViewState): string {
  const status = view.publicSync?.status ?? view.state?.status;
  if (status !== "finished" && status !== "abandoned") return "";
  const summary = view.rewardSummary;
  const win = summary?.result === "win";
  const titleText = win ? "VICTORY" : "DEFEAT";
  const titleClass = win ? "reward-title win" : "reward-title loss";

  // Either drive from the live anim state (in progress) or from the summary's
  // "before" snapshot (no summary yet → zero defaults).
  const anim = view.rewardAnim ?? initialAnimState(summary);
  const fillPct = anim.displayedXpRequired > 0
    ? Math.min(100, Math.round((anim.displayedXpIntoLevel / anim.displayedXpRequired) * 100 * 100) / 100)
    : 0;

  const sourceText = renderSourceText(summary);
  const goldSourceText = renderGoldSourceText(summary);
  const stageClass = anim.stage === "xp" ? "stage-xp" : anim.stage === "gold" ? "stage-gold" : "stage-done";

  return `
    <section class="result-overlay reward-overlay ${stageClass}" data-testid="result-overlay">
      <div class="result-content reward-content">
        <h2 class="result-text ${titleClass}">${titleText}</h2>

        <div class="reward-section reward-xp-section">
          <div class="reward-section-label">經驗值</div>
          <div class="reward-level-row">
            <span class="reward-level-chip" id="reward-level-chip">Lv ${anim.displayedLevel}</span>
            <span class="reward-xp-readout" id="reward-xp-readout">${anim.displayedXpIntoLevel} / ${anim.displayedXpRequired}</span>
          </div>
          <div class="reward-xp-bar-track">
            <div class="reward-xp-bar-fill" id="reward-xp-bar-fill" style="width: ${fillPct}%"></div>
          </div>
          <div class="reward-source reward-xp-source" id="reward-xp-source">${escapeText(sourceText)}</div>
        </div>

        <div class="reward-section reward-gold-section">
          <div class="reward-section-label">金幣</div>
          <div class="reward-gold-counter"><img class="reward-gold-icon" src="/images/ui/Coin.webp" alt="" /><span id="reward-gold-counter">${anim.displayedGold}</span></div>
          <div class="reward-source reward-gold-source" id="reward-gold-source">${escapeText(goldSourceText)}</div>
        </div>

        <button id="reward-continue" class="reward-continue" data-testid="back-to-lobby" ${anim.stage === "done" ? "" : "disabled"}>
          ${anim.stage === "done" ? "返回大廳" : "略過"}
        </button>
      </div>
    </section>
  `;
}

export function initialAnimState(summary: RewardSummary | undefined): RewardAnimationState {
  if (!summary) {
    return { stage: "done", displayedLevel: 1, displayedXpIntoLevel: 0, displayedXpRequired: getXPRequiredForLevel(1), displayedGold: 0 };
  }
  return {
    stage: "xp",
    displayedLevel: summary.level.before,
    displayedXpIntoLevel: summary.xp.before,
    displayedXpRequired: getXPRequiredForLevel(summary.level.before),
    displayedGold: summary.gold.before
  };
}

/**
 * Drives the XP+gold animation off requestAnimationFrame. Mutates view.rewardAnim
 * in place and re-renders selected DOM nodes — the overlay shell is rendered once.
 * Safe to call repeatedly; previous animations are cancelled.
 */
export function startRewardAnimation(view: ClientViewState, onFrame: () => void): void {
  cancelRewardAnimation();
  const summary = view.rewardSummary;
  if (!summary) {
    view.rewardAnim = { stage: "done", displayedLevel: 1, displayedXpIntoLevel: 0, displayedXpRequired: getXPRequiredForLevel(1), displayedGold: 0 };
    onFrame();
    return;
  }

  // If the player is a loser (zero everywhere) skip straight to done state.
  if (summary.xp.gained === 0 && summary.gold.gained === 0 && summary.levelUps.length === 0) {
    view.rewardAnim = {
      stage: "done",
      displayedLevel: summary.level.before,
      displayedXpIntoLevel: summary.xp.before,
      displayedXpRequired: getXPRequiredForLevel(summary.level.before),
      displayedGold: summary.gold.before
    };
    onFrame();
    return;
  }

  view.rewardAnim = initialAnimState(summary);

  // Build the XP step timeline. Each entry is "fill the bar to xpRequired
  // for level N, optionally flash, then advance to level N+1".
  const xpSteps: Array<{ atMs: number; level: number; xpInto: number; xpRequired: number; flash: boolean }> = [];
  let cursor = 0;
  let level = summary.level.before;
  // Step 1..K: fill the bar to full at each intermediate level, flash, advance.
  for (const lu of summary.levelUps) {
    cursor += XP_TWEEN_PER_LEVEL_MS;
    xpSteps.push({ atMs: cursor, level, xpInto: getXPRequiredForLevel(level), xpRequired: getXPRequiredForLevel(level), flash: true });
    cursor += LEVEL_UP_FLASH_MS;
    level = lu.level;
    xpSteps.push({ atMs: cursor, level, xpInto: 0, xpRequired: getXPRequiredForLevel(level), flash: false });
  }
  // Final step: fill to xpAfter at the final level.
  cursor += XP_TWEEN_PER_LEVEL_MS;
  xpSteps.push({
    atMs: cursor,
    level: summary.level.after,
    xpInto: summary.xp.after,
    xpRequired: getXPRequiredForLevel(summary.level.after),
    flash: false
  });

  const xpEndMs = cursor;
  const goldDelta = summary.gold.gained;
  const goldDurationMs = Math.max(
    GOLD_TWEEN_MIN_MS,
    Math.min(GOLD_TWEEN_MAX_MS, goldDelta * GOLD_TWEEN_PER_GOLD_MS)
  );
  const goldStartMs = xpEndMs + 150;
  const goldEndMs = goldStartMs + (goldDelta > 0 ? goldDurationMs : 0);

  activeAnimation = {
    summary,
    startedAtMs: performance.now(),
    xpSteps,
    xpEndMs,
    goldStartMs,
    goldEndMs,
    onFrame
  };

  scheduleFrame(view);
}

function scheduleFrame(view: ClientViewState): void {
  animationFrameId = requestAnimationFrame(() => tick(view));
}

function tick(view: ClientViewState): void {
  const anim = activeAnimation;
  const state = view.rewardAnim;
  if (!anim || !state) {
    animationFrameId = undefined;
    return;
  }

  const elapsed = performance.now() - anim.startedAtMs;
  applyAnimationFrame(view, elapsed);
  patchOverlayDom(view);

  const finished = elapsed >= anim.goldEndMs;
  if (finished) {
    state.stage = "done";
    patchOverlayDom(view);
    animationFrameId = undefined;
    activeAnimation = undefined;
    anim.onFrame();
    return;
  }
  scheduleFrame(view);
}

function applyAnimationFrame(view: ClientViewState, elapsedMs: number): void {
  const anim = activeAnimation;
  const state = view.rewardAnim;
  if (!anim || !state) return;
  const summary = anim.summary;

  if (elapsedMs < anim.xpEndMs) {
    state.stage = "xp";
    let prev: { atMs: number; level: number; xpInto: number; xpRequired: number; flash: boolean } | undefined;
    for (const step of anim.xpSteps) {
      if (elapsedMs >= step.atMs) {
        prev = step;
        continue;
      }
      const lastLevel = prev?.level ?? summary.level.before;
      const lastXpInto = prev?.xpInto ?? summary.xp.before;
      const lastAt = prev?.atMs ?? 0;
      const span = step.atMs - lastAt;
      const t = span > 0 ? Math.min(1, Math.max(0, (elapsedMs - lastAt) / span)) : 1;
      const eased = easeOutCubic(t);
      // If we just stepped past a level-up flash (prev.flash === true), the
      // bar visually "resets" — start displaying the new level immediately.
      if (prev?.flash && step.level !== lastLevel) {
        state.displayedLevel = step.level;
        state.displayedXpRequired = step.xpRequired;
        state.displayedXpIntoLevel = Math.round(step.xpInto * eased);
      } else if (prev && step.level !== lastLevel) {
        state.displayedLevel = step.level;
        state.displayedXpRequired = step.xpRequired;
        state.displayedXpIntoLevel = Math.round(step.xpInto * eased);
      } else {
        state.displayedLevel = lastLevel;
        state.displayedXpRequired = getXPRequiredForLevel(lastLevel);
        state.displayedXpIntoLevel = Math.round(lastXpInto + (step.xpInto - lastXpInto) * eased);
      }
      return;
    }
    // Past the last step → land on final values.
    state.displayedLevel = summary.level.after;
    state.displayedXpRequired = getXPRequiredForLevel(summary.level.after);
    state.displayedXpIntoLevel = summary.xp.after;
    return;
  }

  // Gold phase.
  state.stage = "gold";
  state.displayedLevel = summary.level.after;
  state.displayedXpRequired = getXPRequiredForLevel(summary.level.after);
  state.displayedXpIntoLevel = summary.xp.after;

  if (elapsedMs >= anim.goldEndMs) {
    state.displayedGold = summary.gold.after;
    return;
  }
  const goldSpan = anim.goldEndMs - anim.goldStartMs;
  const tg = goldSpan > 0 ? Math.min(1, Math.max(0, (elapsedMs - anim.goldStartMs) / goldSpan)) : 1;
  const eased = easeOutCubic(tg);
  state.displayedGold = Math.round(summary.gold.before + summary.gold.gained * eased);
}

function patchOverlayDom(view: ClientViewState): void {
  const state = view.rewardAnim;
  if (!state) return;
  const chip = document.getElementById("reward-level-chip");
  if (chip) chip.textContent = `Lv ${state.displayedLevel}`;
  const readout = document.getElementById("reward-xp-readout");
  if (readout) readout.textContent = `${state.displayedXpIntoLevel} / ${state.displayedXpRequired}`;
  const fill = document.getElementById("reward-xp-bar-fill") as HTMLElement | null;
  if (fill) {
    const pct = state.displayedXpRequired > 0
      ? Math.min(100, (state.displayedXpIntoLevel / state.displayedXpRequired) * 100)
      : 0;
    fill.style.width = `${pct}%`;
  }
  const gold = document.getElementById("reward-gold-counter");
  if (gold) gold.textContent = String(state.displayedGold);
  const overlay = document.querySelector(".reward-overlay");
  if (overlay) {
    overlay.classList.remove("stage-xp", "stage-gold", "stage-done");
    overlay.classList.add(`stage-${state.stage}`);
  }
  if (state.stage === "done" && state.displayedLevel >= MAX_LEVEL) {
    const cap = document.getElementById("reward-xp-readout");
    if (cap) cap.textContent = "MAX";
  }
  const button = document.getElementById("reward-continue") as HTMLButtonElement | null;
  if (button) {
    button.disabled = state.stage !== "done";
    button.textContent = state.stage === "done" ? "返回大廳" : "略過";
  }
}

export function cancelRewardAnimation(): void {
  if (animationFrameId !== undefined) cancelAnimationFrame(animationFrameId);
  animationFrameId = undefined;
  activeAnimation = undefined;
}

export function skipRewardAnimation(view: ClientViewState, onFrame: () => void): void {
  const anim = activeAnimation;
  const summary = view.rewardSummary;
  cancelRewardAnimation();
  if (!summary || !view.rewardAnim) {
    if (view.rewardAnim) view.rewardAnim.stage = "done";
    onFrame();
    return;
  }
  view.rewardAnim = {
    stage: "done",
    displayedLevel: summary.level.after,
    displayedXpIntoLevel: summary.xp.after,
    displayedXpRequired: getXPRequiredForLevel(summary.level.after),
    displayedGold: summary.gold.after
  };
  patchOverlayDom(view);
  if (anim) anim.onFrame();
  onFrame();
}

export function resetRewardScreen(view: ClientViewState): void {
  cancelRewardAnimation();
  view.rewardSummary = undefined;
  view.rewardAnim = undefined;
}

function renderSourceText(summary: RewardSummary | undefined): string {
  if (!summary || summary.result !== "win") return "";
  const diagnostic = renderRewardDiagnostic(summary);
  if (diagnostic) return diagnostic;
  switch (summary.source) {
    case "pve_first":
      return `首勝 · ${themeName(summary.aiTheme)}（${difficultyLabel(summary.aiDifficulty)}）+${summary.xp.gained} XP`;
    case "pve_repeat":
      return `挑戰勝利 · ${themeName(summary.aiTheme)}（${difficultyLabel(summary.aiDifficulty)}）+${summary.xp.gained} XP`;
    case "pvp":
      return `對戰勝利 +${summary.xp.gained} XP`;
    default:
      return "";
  }
}

function renderRewardDiagnostic(summary: RewardSummary): string {
  if (summary.source !== "none") return "";
  switch (summary.diagnostic) {
    case "rewards_disabled":
      return "No rewards were granted: server Supabase rewards are disabled.";
    case "rpc_failed":
      return "No rewards were granted: reward database RPC failed. Check server logs.";
    case "missing_reward_summary":
      return "No rewards were granted: server did not send a reward summary.";
    default:
      return "";
  }
}

function renderGoldSourceText(summary: RewardSummary | undefined): string {
  if (!summary || summary.gold.gained === 0) return "";
  const parts: string[] = [];
  const match = summary.gold.breakdown.matchWin;
  const first = summary.gold.breakdown.firstVictory;
  const level = summary.gold.breakdown.levelUps;
  if (match) parts.push(`對戰獎勵 +${match}`);
  if (first) parts.push(`首勝獎勵 +${first}`);
  if (level) parts.push(`升級獎勵 +${level}`);
  return parts.join("　·　");
}

function themeName(theme: AiTheme | null): string {
  if (!theme) return "";
  return AI_THEMES.find((entry) => entry.id === theme)?.name ?? theme;
}

function difficultyLabel(difficulty: AiDifficulty | null): string {
  if (!difficulty) return "";
  return DIFFICULTY_LABELS[difficulty];
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
