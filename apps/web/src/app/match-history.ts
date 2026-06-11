import { AI_THEMES, type AiDifficulty, type Seat } from "@twcardgame/shared";
import type { MatchHistoryRow } from "./types.js";

/** Whether a recorded match was against another human (`pvp`) or the AI (`pve`). */
export type MatchKind = "pvp" | "pve";
export type MatchOutcome = "win" | "loss" | "draw";

export interface MatchStats {
  wins: number;
  losses: number;
  draws: number;
  total: number;
}

/**
 * A match_history row's created_at is set by the server to the match START time,
 * while finished_at is the END time. Legacy rows (recorded before start-time
 * tracking) have created_at defaulted to the insert time, so the two timestamps
 * are nearly identical — we treat any span below this as "no real duration".
 */
const LEGACY_DURATION_THRESHOLD_MS = 3_000;

const DIFFICULTY_LABELS: Record<AiDifficulty, string> = {
  easy: "簡單",
  normal: "普通",
  hard: "困難"
};

const AI_THEME_NAMES: Record<string, string> = Object.fromEntries(
  AI_THEMES.map((theme) => [theme.id, theme.name])
);

export function matchKind(row: MatchHistoryRow): MatchKind {
  return row.is_vs_ai ? "pve" : "pvp";
}

/** Which seat the viewing user occupied in this row, if they were a participant. */
export function mySeatInRow(row: MatchHistoryRow, userId: string | undefined): Seat | undefined {
  if (!userId) return undefined;
  if (row.player1_user_id === userId) return "player1";
  if (row.player2_user_id === userId) return "player2";
  return undefined;
}

export function matchOutcome(row: MatchHistoryRow, userId: string | undefined): MatchOutcome {
  if (!row.winner_seat) return "draw";
  const seat = mySeatInRow(row, userId);
  if (seat && row.winner_seat === seat) return "win";
  if (seat) return "loss";
  return "draw";
}

/** Tally wins/losses/draws for a single match kind (PvP or PvE). */
export function computeMatchStats(
  rows: MatchHistoryRow[],
  userId: string | undefined,
  kind: MatchKind
): MatchStats {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const row of rows) {
    if (matchKind(row) !== kind) continue;
    const outcome = matchOutcome(row, userId);
    if (outcome === "win") wins++;
    else if (outcome === "loss") losses++;
    else draws++;
  }
  return { wins, losses, draws, total: wins + losses + draws };
}

export function difficultyLabel(difficulty: AiDifficulty | string | null | undefined): string {
  if (!difficulty) return "";
  return DIFFICULTY_LABELS[difficulty as AiDifficulty] ?? "";
}

/** "玩家對戰" for PvP, "電腦對戰 · 困難" for PvE (difficulty appended when known). */
export function matchTypeLabel(row: MatchHistoryRow): string {
  if (!row.is_vs_ai) return "玩家對戰";
  const difficulty = difficultyLabel(row.ai_difficulty);
  return difficulty ? `電腦對戰 · ${difficulty}` : "電腦對戰";
}

/** The opponent's display name: AI persona for PvE, the other player's name for PvP. */
export function opponentLabel(row: MatchHistoryRow, userId: string | undefined): string {
  if (row.is_vs_ai) {
    const name = row.ai_theme ? AI_THEME_NAMES[row.ai_theme] : undefined;
    return name ?? "電腦 AI";
  }
  const seat = mySeatInRow(row, userId);
  const opponent =
    seat === "player1" ? row.players_view?.player2
    : seat === "player2" ? row.players_view?.player1
    : undefined;
  const name = opponent?.displayName?.trim();
  return name || "對手";
}

/** Real elapsed time in ms, or null for legacy rows that never recorded a start time. */
export function matchDurationMs(row: MatchHistoryRow): number | null {
  if (!row.created_at || !row.finished_at) return null;
  const start = Date.parse(row.created_at);
  const end = Date.parse(row.finished_at);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const ms = end - start;
  return ms >= LEGACY_DURATION_THRESHOLD_MS ? ms : null;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Number of turns played, recovered from the stored final state. */
export function matchTurns(row: MatchHistoryRow): number | null {
  const raw = row.turn_view?.number;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Combined length: "08:32 · 12 回合", "12 回合" (legacy), or "—" when nothing is known. */
export function matchLengthLabel(row: MatchHistoryRow): string {
  const parts: string[] = [];
  const ms = matchDurationMs(row);
  if (ms != null) parts.push(formatDuration(ms));
  const turns = matchTurns(row);
  if (turns != null) parts.push(`${turns} 回合`);
  return parts.length ? parts.join(" · ") : "—";
}
