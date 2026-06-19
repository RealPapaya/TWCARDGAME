import type { PublicGameState, PublicPlayer } from "@twcardgame/shared";

export function projectRealtimeState(state: PublicGameState): any {
  return {
    matchId: state.matchId,
    schemaVersion: state.schemaVersion,
    cardCatalogVersion: state.cardCatalogVersion,
    status: state.status,
    phase: state.phase,
    turn: state.turn,
    player1: projectPlayer(state.players.player1),
    player2: projectPlayer(state.players.player2),
    pendingPromptId: state.pendingPrompt?.promptId ?? "",
    pendingPromptSeat: state.pendingPrompt?.seat ?? "",
    pendingPromptKind: state.pendingPrompt?.kind ?? "",
    specialPhase: projectSpecialPhase(state.specialPhase),
    result: state.result,
    resultWinnerSeat: state.result?.winnerSeat ?? "",
    resultReason: state.result?.reason ?? "",
    boardLimit: state.boardLimit,
    activeEnvironmentId: state.activeEnvironment?.id ?? "",
    activeEnvironmentName: state.activeEnvironment?.name ?? "",
    activeEnvironmentRemainingTurns: state.activeEnvironment?.remainingTurns ?? 0
  };
}

function projectPlayer(player: PublicPlayer): any {
  return {
    ...player,
    reconnectUntilMs: player.reconnectUntilMs ?? -1,
    board: [...player.board],
    amplificationId: player.amplification?.id ?? "",
    amplificationName: player.amplification?.name ?? "",
    amplificationTier: player.amplification?.tier ?? "",
    augments: [...(player.augments ?? [])]
  };
}

function projectSpecialPhase(sp: PublicGameState["specialPhase"]): any {
  return {
    phaseDeadlineAtMs: sp?.phaseDeadlineAtMs ?? 0,
    ampSelectedP1: sp?.amplificationSelected?.player1 ?? false,
    ampSelectedP2: sp?.amplificationSelected?.player2 ?? false,
    ampRerollUsedP1: sp?.amplificationRerollUsed?.player1 ?? false,
    ampRerollUsedP2: sp?.amplificationRerollUsed?.player2 ?? false,
    ampRerollRemainingP1: sp?.amplificationRerollRemaining?.player1 ?? 0,
    ampRerollRemainingP2: sp?.amplificationRerollRemaining?.player2 ?? 0,
    voteSubmittedP1: sp?.voteSubmitted?.player1 ?? false,
    voteSubmittedP2: sp?.voteSubmitted?.player2 ?? false,
    voteWeightP1: sp?.voteWeights?.player1 ?? 0,
    voteWeightP2: sp?.voteWeights?.player2 ?? 0,
    voteEvents: (sp?.voteEvents ?? []).map((event) => ({
      id: event.id,
      name: event.name,
      option0: event.options[0] ?? "",
      option1: event.options[1] ?? "",
      option2: event.options[2] ?? ""
    }))
  };
}
