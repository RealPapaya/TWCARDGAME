import { Client, type Room } from "@colyseus/sdk";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { CARD_CATALOG, CARD_CATALOG_VERSION, type CardDefinition } from "@twcardgame/cards";
import type {
  ClientCommandMessage,
  GameCommand,
  GameEvent,
  GameStatus,
  HandCardView,
  PublicMinion,
  PublicPlayer,
  Seat,
  TargetRef
} from "@twcardgame/shared";
import { GameStateSchema } from "./schema.js";
import "./styles.css";

type ClientViewState = {
  room?: Room;
  mySeat?: Seat;
  hand: HandCardView[];
  state?: any;
  publicSync?: {
    status?: GameStatus;
    activeSeat?: Seat;
    turnNumber?: number;
    actionSeq?: number;
    result?: any;
    players?: Partial<Record<Seat, PublicPlayer>>;
  };
  presence: Map<Seat, { connected: boolean; reconnectUntilMs?: number }>;
  rejectedHandIds: Set<string>;
  selectedHandId?: string;
  mulliganSelection: Set<string>;
  selectedAttackerId?: string;
  selectedTarget?: TargetRef;
  events: GameEvent[];
  eventStatus?: GameStatus;
  toast?: string;
  joining: boolean;
  joinError?: string;
  accountLoading: boolean;
  accountError?: string;
  accountMessage?: string;
  session?: Session | null;
  profile?: ProfileRow;
  decks: DeckRow[];
  collection: CollectionRow[];
  matchHistory: MatchHistoryRow[];
  selectedDeckId?: string;
  editingDeck?: Partial<DeckRow> & Pick<DeckRow, "name" | "card_ids">;
};

type ResolvedCardView = {
  cardId: string;
  instanceId: string;
  name: string;
  category: string;
  description: string;
  image: string;
  cost: number;
  type: string;
  rarity: string;
  attack?: number;
  health?: number;
};

type ProfileRow = {
  user_id: string;
  display_name: string;
  avatar_url?: string | null;
};

type DeckRow = {
  id: string;
  user_id: string;
  name: string;
  card_catalog_version: string;
  card_ids: string[];
  updated_at?: string;
};

type CollectionRow = {
  card_id: string;
  quantity: number;
};

type MatchHistoryRow = {
  id: string;
  winner_seat?: Seat | null;
  result_reason: string;
  created_at?: string;
  finished_at?: string;
};

const app = document.querySelector<HTMLDivElement>("#app")!;
const defaultServerUrl = import.meta.env.VITE_COLYSEUS_URL || "ws://localhost:2567";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase: SupabaseClient | undefined =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : undefined;
const cardCatalog = new Map<string, CardDefinition>(CARD_CATALOG.map((card) => [card.id, card]));
const seats: Seat[] = ["player1", "player2"];

const view: ClientViewState = {
  hand: [],
  presence: new Map(),
  rejectedHandIds: new Set(),
  mulliganSelection: new Set(),
  events: [],
  joining: false,
  accountLoading: false,
  session: undefined,
  decks: [],
  collection: [],
  matchHistory: []
};

render();
void initializeAccount();

function render(): void {
  const status = readStatus();
  const shellClass = view.state ? "app-shell in-match" : "app-shell";
  app.innerHTML = `
    <main class="${shellClass}">
      ${renderTopbar()}
      ${view.state ? renderGame(status) : renderLanding()}
      ${renderToast()}
    </main>
  `;

  bindStaticActions();
  bindSelectionActions();
}

function renderTopbar(): string {
  const roomLabel = view.room ? `Room ${view.room.roomId} - ${view.mySeat ?? "spectating"}` : "Authoritative PvP";
  const accountMode = Boolean(supabase);
  const displayName = view.profile?.display_name ?? "Player";
  const joinDisabled = view.room || view.joining || (accountMode && (!view.session || !view.selectedDeckId));
  return `
    <section class="topbar">
      <div class="brand-lockup">
        <h1>TWCARDGAME v2</h1>
        <p>${escapeHtml(roomLabel)}</p>
      </div>
      <form id="join-form" class="join" data-testid="join-form">
        <input id="server-url" value="${escapeAttr(defaultServerUrl)}" ${view.room || view.joining ? "disabled" : ""} aria-label="Server URL" />
        <input id="display-name" value="${escapeAttr(displayName)}" ${view.room || view.joining || accountMode ? "disabled" : ""} aria-label="Display name" />
        <button ${joinDisabled ? "disabled" : ""}>${view.joining ? "Joining" : "Join"}</button>
      </form>
    </section>
  `;
}

function renderLanding(): string {
  if (supabase && view.session) return renderAccountLobby();
  if (supabase) return renderAuthPanel();

  return `
    <section class="landing">
      <div class="landing-copy">
        <h2>Battle verification build</h2>
        <p>Start the v2 server, then join a PvP room from two browser windows.</p>
        ${view.joinError ? `<p class="error-text">${escapeHtml(view.joinError)}</p>` : ""}
      </div>
    </section>
  `;
}

function renderAuthPanel(): string {
  return `
    <section class="landing account-landing">
      <div class="account-panel auth-panel">
        <h2>Account Login</h2>
        <p>Sign in to save decks, sync your collection, and record PvP history.</p>
        ${view.accountError ? `<p class="error-text">${escapeHtml(view.accountError)}</p>` : ""}
        ${view.accountMessage ? `<p class="success-text">${escapeHtml(view.accountMessage)}</p>` : ""}
        <form id="auth-form" class="auth-form">
          <input id="auth-email" type="email" autocomplete="email" placeholder="Email" required />
          <input id="auth-password" type="password" autocomplete="current-password" placeholder="Password" required />
          <div class="button-row">
            <button type="submit" data-auth-mode="signin" ${view.accountLoading ? "disabled" : ""}>Sign In</button>
            <button type="button" id="sign-up" ${view.accountLoading ? "disabled" : ""}>Create Account</button>
            <button type="button" id="google-sign-in" ${view.accountLoading ? "disabled" : ""}>Google</button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderAccountLobby(): string {
  const selectedDeck = view.decks.find((deck) => deck.id === view.selectedDeckId);
  return `
    <section class="account-lobby">
      <div class="account-toolbar">
        <div>
          <h2>${escapeHtml(view.profile?.display_name ?? "Player")}</h2>
          <p>${view.collection.length} owned cards - Catalog ${escapeHtml(CARD_CATALOG_VERSION)}</p>
        </div>
        <div class="button-row">
          <button id="sync-collection">Sync Collection</button>
          <button id="new-deck">New Deck</button>
          <button id="refresh-account">Refresh</button>
          <button id="sign-out">Sign Out</button>
        </div>
      </div>
      ${view.accountError ? `<p class="error-text account-status">${escapeHtml(view.accountError)}</p>` : ""}
      ${view.accountMessage ? `<p class="success-text account-status">${escapeHtml(view.accountMessage)}</p>` : ""}
      ${view.joinError ? `<p class="error-text account-status">${escapeHtml(view.joinError)}</p>` : ""}
      <div class="account-grid">
        <section class="account-panel deck-panel">
          <h3>Saved Decks</h3>
          <div class="deck-list">
            ${view.decks.map(renderSavedDeck).join("") || `<p class="muted">No saved decks yet.</p>`}
          </div>
          <p class="muted">${selectedDeck ? `Selected: ${escapeHtml(selectedDeck.name)}` : "Select a legal deck before joining PvP."}</p>
        </section>
        <section class="account-panel editor-panel">
          ${renderDeckEditor()}
        </section>
        <section class="account-panel history-panel">
          <h3>Match History</h3>
          <div class="history-list">
            ${view.matchHistory.map(renderMatchHistoryRow).join("") || `<p class="muted">No completed matches yet.</p>`}
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderSavedDeck(deck: DeckRow): string {
  const selected = deck.id === view.selectedDeckId;
  return `
    <div class="saved-deck ${selected ? "selected" : ""}">
      <button class="deck-select" data-select-deck="${escapeAttr(deck.id)}">
        <strong>${escapeHtml(deck.name)}</strong>
        <span>${deck.card_ids.length} cards</span>
      </button>
      <button data-edit-deck="${escapeAttr(deck.id)}">Edit</button>
      <button class="danger" data-delete-deck="${escapeAttr(deck.id)}">Delete</button>
    </div>
  `;
}

function renderDeckEditor(): string {
  const deck = view.editingDeck;
  const selectedCounts = countCards(deck?.card_ids ?? []);
  const selectedTotal = deck?.card_ids.length ?? 0;
  const cards = CARD_CATALOG.filter((card) => card.collectible !== false);
  const collectionReady = hasCollectionRows();

  return `
    <form id="deck-form" class="deck-editor">
      <div class="editor-heading">
        <h3>${deck?.id ? "Edit Deck" : "New Deck"}</h3>
        <span>${selectedTotal}/30</span>
      </div>
      <input id="deck-name" value="${escapeAttr(deck?.name ?? "New Deck")}" aria-label="Deck name" />
      ${
        collectionReady
          ? ""
          : `<p class="muted">Collection is still syncing. You can build now; Save Deck will confirm ownership with Supabase.</p>`
      }
      <div class="editor-actions">
        <button type="submit" ${selectedTotal !== 30 ? "disabled" : ""}>Save Deck</button>
        <button type="button" id="autofill-deck">Autofill</button>
        <button type="button" id="clear-deck">Clear</button>
      </div>
      <div class="deck-card-list">
        ${cards.map((card) => renderDeckBuilderCard(card, selectedCounts.get(card.id) ?? 0)).join("")}
      </div>
    </form>
  `;
}

function renderDeckBuilderCard(card: CardDefinition, count: number): string {
  const limit = deckCopyLimit(card);
  return `
    <div class="deck-builder-card">
      <button type="button" data-add-card="${escapeAttr(card.id)}" ${count >= limit ? "disabled" : ""} title="Add card">+</button>
      <button type="button" data-remove-card="${escapeAttr(card.id)}" ${count <= 0 ? "disabled" : ""}>-</button>
      <span class="deck-card-name">${escapeHtml(card.name)}</span>
      <span>${count}/${limit}</span>
    </div>
  `;
}

function renderMatchHistoryRow(row: MatchHistoryRow): string {
  const finished = row.finished_at ? new Date(row.finished_at).toLocaleString() : row.id;
  return `
    <div class="history-row">
      <strong>${escapeHtml(row.result_reason)}</strong>
      <span>${escapeHtml(row.winner_seat ?? "no winner")}</span>
      <small>${escapeHtml(finished)}</small>
    </div>
  `;
}

function renderGame(status: GameStatus | ""): string {
  const me = view.mySeat;
  const opponent = me ? otherSeat(me) : "player2";
  const opponentPlayer = readPlayer(opponent);
  const myPlayer = readPlayer(me ?? "player1");
  const activeSeat = readActiveSeat();

  return `
    <section class="status" data-testid="match-status">
      <span>Status: ${escapeHtml(status || "waiting")}</span>
      <span>Turn: ${readTurnNumber()}</span>
      <span>Active: ${escapeHtml(activeSeat || "none")}</span>
      <span>Selected target: ${view.selectedTarget ? escapeHtml(targetLabel(view.selectedTarget)) : "none"}</span>
    </section>
    <section class="battle-surface" data-testid="battle-surface">
      ${renderConnectionBanner()}
      ${renderPlayerArea(opponent, opponentPlayer, "opponent")}
      ${renderCenterLine(activeSeat)}
      ${renderPlayerArea(me ?? "player1", myPlayer, "player")}
      ${renderMulliganOverlay(status)}
      ${renderResultOverlay(status)}
    </section>
    <section class="log" data-testid="event-log">
      ${view.events.map(renderEventLine).join("")}
    </section>
  `;
}

function renderConnectionBanner(): string {
  if (!view.room || hasBothPlayers()) return "";
  return `<div class="match-banner waiting">Waiting for opponent</div>`;
}

function renderPlayerArea(seat: Seat, player: PublicPlayer | undefined, role: "player" | "opponent"): string {
  const isMe = seat === view.mySeat;
  const active = readActiveSeat() === seat;
  const board = Array.from(player?.board ?? []);
  const connected = player?.connected ?? true;
  const handCount = role === "player" ? view.hand.length : player?.handCount ?? 0;
  const areaClasses = ["player-area", "player", role, isMe ? "me" : "", active ? "active-turn" : "", connected ? "" : "disconnected"]
    .filter(Boolean)
    .join(" ");

  return `
    <section class="${areaClasses}" data-seat="${seat}" data-testid="${role}-area">
      <div class="status-cluster">
        ${renderHero(seat, player, role)}
        ${renderMana(player?.mana?.current ?? 0, player?.mana?.max ?? 0, role)}
        <div class="pile-row">
          <div class="deck-pile" title="Deck">${player?.deckCount ?? 0}</div>
          <div class="graveyard-pile" title="Graveyard">${player?.graveyardCount ?? 0}</div>
        </div>
      </div>
      ${role === "opponent" ? renderOpponentHand(handCount) : ""}
      <div class="board" data-testid="${role}-board">
        ${board.map((minion) => renderMinion(seat, minion)).join("") || renderEmptySlots()}
      </div>
      ${role === "player" ? renderPlayerHand() : ""}
      ${!connected ? `<div class="disconnect-pill">Reconnecting</div>` : ""}
    </section>
  `;
}

function renderHero(seat: Seat, player: PublicPlayer | undefined, role: "player" | "opponent"): string {
  const target = targetAttr({ type: "HERO", side: seat });
  const hp = player?.hero?.hp ?? 0;
  const maxHp = player?.hero?.maxHp ?? 0;
  const name = player?.displayName || seat;
  const heroClasses = ["hero", role === "player" ? "player-hero" : "opponent-hero", isTargetHighlighted({ type: "HERO", side: seat }) ? "valid-target" : ""]
    .filter(Boolean)
    .join(" ");

  return `
    <button class="${heroClasses}" data-target='${target}' data-testid="${role}-hero" data-seat="${seat}">
      <span class="avatar" aria-hidden="true"></span>
      <strong>${escapeHtml(name)}</strong>
      <span class="hero-hp">HP ${hp}/${maxHp}</span>
      <span class="hero-mana">Mana ${player?.mana?.current ?? 0}/${player?.mana?.max ?? 0}</span>
      <span class="hero-meta">Hand ${player?.handCount ?? 0} - Deck ${player?.deckCount ?? 0}</span>
    </button>
  `;
}

function renderMana(current: number, max: number, role: "player" | "opponent"): string {
  const crystals = Array.from({ length: 10 }, (_, index) => {
    const crystalClass = index < current ? `mana-crystal ${role}-crystal active` : index < max ? "mana-crystal spent" : "mana-crystal locked";
    return `<span class="${crystalClass}" aria-hidden="true"></span>`;
  }).join("");

  return `
    <div class="mana-container ${role === "player" ? "frame-style" : ""}" data-testid="${role}-mana">
      ${crystals}
      <span class="mana-text">Mana ${current}/${max}</span>
    </div>
  `;
}

function renderOpponentHand(count: number): string {
  return `
    <div class="hand opponent-hand" data-testid="opponent-hand">
      ${Array.from({ length: count }, (_, index) => `<span class="card card-back" style="${fanStyle(index, count)}"></span>`).join("")}
    </div>
  `;
}

function renderPlayerHand(): string {
  return `
    <section class="hand" data-testid="player-hand">
      <div class="hand-row">
        ${view.hand.map((card, index) => renderHandCard(card, index, view.hand.length)).join("") || `<div class="muted">Waiting for private hand sync.</div>`}
      </div>
    </section>
  `;
}

function renderHandCard(card: HandCardView, index: number, total: number): string {
  const resolved = resolveHandCard(card);
  const selected = view.selectedHandId === card.instanceId;
  const mulliganSelected = view.mulliganSelection.has(card.instanceId);
  const playable = canAfford(card.cost);
  const needsTarget = cardNeedsTarget(card.cardId);
  const e2eType = view.rejectedHandIds.has(card.instanceId) ? "REJECTED_CARD" : card.type;
  const classes = [
    "card",
    `rarity-${resolved.rarity.toLowerCase()}`,
    selected ? "selected" : "",
    mulliganSelected ? "mulligan-selected" : "",
    playable ? "can-play" : "",
    needsTarget ? "needs-target" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <button
      class="${classes}"
      style="${fanStyle(index, total)}"
      data-hand-id="${escapeAttr(card.instanceId)}"
      data-card-type="${escapeAttr(card.type)}"
      data-e2e-card-type="${escapeAttr(e2eType)}"
      data-cost="${card.cost}"
      data-testid="hand-card"
    >
      ${renderCardFace(resolved, "hand")}
      <span class="sr-e2e">Cost ${card.cost} ${e2eType}${card.attack !== undefined ? ` ${card.attack}/${card.health}` : ""}</span>
    </button>
  `;
}

function renderMinion(seat: Seat, minion: PublicMinion): string {
  const catalogCard = cardCatalog.get(minion.cardId);
  const target: TargetRef = { type: "MINION", side: seat, instanceId: minion.instanceId };
  const mine = seat === view.mySeat;
  const classes = [
    "minion",
    minion.taunt ? "taunt" : "",
    minion.divineShield ? "shielded" : "",
    minion.canAttack ? "can-attack" : "sleeping",
    minion.isEnraged ? "enraged" : "",
    selectedMinionClass(minion.instanceId, target),
    isTargetHighlighted(target) ? "valid-target" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <button
      class="${classes}"
      ${mine ? `data-attacker-id="${escapeAttr(minion.instanceId)}"` : ""}
      data-target='${targetAttr(target)}'
      data-card-type="MINION"
      data-cost="${catalogCard?.cost ?? 0}"
      data-seat="${seat}"
      data-testid="board-minion"
    >
      <div class="minion-art" style="background-image: url('${escapeAttr(assetUrl(catalogCard?.image ?? ""))}')"></div>
      <strong class="card-title">${escapeHtml(catalogCard?.name ?? minion.cardId)}</strong>
      <small class="keyword-row">${minionKeywords(minion).join(" ")}</small>
      <div class="minion-stats">
        <span class="stat-atk"><span>${minion.attack}</span></span>
        <span class="stat-hp">${minion.currentHealth}/${minion.health}</span>
      </div>
      <span class="sr-e2e">${minion.canAttack ? "ready" : ""} ${minion.taunt ? "taunt" : ""}</span>
    </button>
  `;
}

function renderCardFace(card: ResolvedCardView, size: "hand" | "mulligan"): string {
  return `
    <span class="card-cost"><span>${card.cost}</span></span>
    <strong class="card-title">${escapeHtml(card.name)}</strong>
    <img class="card-art-box" src="${escapeAttr(assetUrl(card.image))}" alt="" loading="lazy" />
    <span class="card-category">${escapeHtml(card.category)}</span>
    <span class="card-desc ${size === "mulligan" ? "large-desc" : ""}">${escapeHtml(card.description)}</span>
    ${
      card.type === "MINION"
        ? `<span class="minion-stats"><span class="stat-atk"><span>${card.attack ?? 0}</span></span><span class="stat-hp">${card.health ?? 0}</span></span>`
        : ""
    }
  `;
}

function renderCenterLine(activeSeat: Seat | ""): string {
  const isMyTurn = activeSeat && activeSeat === view.mySeat;
  const canPlay = Boolean(view.selectedHandId);
  const canAttack = Boolean(view.selectedAttackerId && view.selectedTarget);

  return `
    <section class="center-line controls">
      <button id="concede" class="danger" data-testid="concede">Concede</button>
      <div class="turn-stack">
        <span id="indicator-opp" class="turn-light ${activeSeat === otherSeat(view.mySeat ?? "player1") ? "active" : ""}">Opponent</span>
        <span id="indicator-player" class="turn-light ${isMyTurn ? "active" : ""}">${isMyTurn ? "Your Turn" : "Waiting"}</span>
      </div>
      <button id="play" ${canPlay ? "" : "disabled"} data-testid="play-selected">Play Selected</button>
      <button id="attack" ${canAttack ? "" : "disabled"} data-testid="attack-target">Attack Target</button>
      <button id="end-turn" class="end-turn-btn" ${view.room ? "" : "disabled"} data-testid="end-turn">End Turn</button>
    </section>
  `;
}

function renderMulliganOverlay(status: GameStatus | ""): string {
  if (status !== "mulligan" || !view.room) return "";
  const ready = Boolean(view.mySeat && readPlayer(view.mySeat)?.mulliganReady);
  const selectedCount = view.mulliganSelection.size;

  return `
    <section id="mulligan-modal" class="mulligan-overlay ${ready ? "submitted" : ""}" data-testid="mulligan-overlay">
      <div class="mulligan-content">
        <h2>Mulligan</h2>
        <p>${ready ? "Waiting for opponent" : "Select cards to replace, then confirm."}</p>
        <div class="mulligan-card-area">
          ${view.hand.map((card) => renderMulliganCard(card, ready)).join("")}
        </div>
        <button id="mulligan" ${ready ? "disabled" : ""} data-testid="mulligan-confirm">
          ${ready ? "Ready" : `Confirm${selectedCount ? ` (${selectedCount})` : ""}`}
        </button>
      </div>
    </section>
  `;
}

function renderMulliganCard(card: HandCardView, disabled: boolean): string {
  const resolved = resolveHandCard(card);
  const selected = view.mulliganSelection.has(card.instanceId);
  return `
    <button
      class="card mulligan-card ${selected ? "selected" : ""}"
      data-mulligan-id="${escapeAttr(card.instanceId)}"
      data-card-type="${escapeAttr(card.type)}"
      data-cost="${card.cost}"
      ${disabled ? "disabled" : ""}
    >
      ${renderCardFace(resolved, "mulligan")}
      ${selected ? `<span class="mulligan-replace-tag">Replace</span>` : ""}
      <span class="sr-e2e">Cost ${card.cost} ${card.type}</span>
    </button>
  `;
}

function renderResultOverlay(status: GameStatus | ""): string {
  if (status !== "finished" && status !== "abandoned") return "";
  const winnerSeat = view.state?.resultWinnerSeat || view.state?.result?.winnerSeat;
  const reason = view.state?.resultReason || view.state?.result?.reason || status;
  const won = winnerSeat && winnerSeat === view.mySeat;
  const title = status === "abandoned" ? "Match Abandoned" : won ? "Victory" : winnerSeat ? "Defeat" : "Game Finished";

  return `
    <section class="result-overlay" data-testid="result-overlay">
      <div class="result-content">
        <h2 class="result-text">${escapeHtml(title)}</h2>
        <p>${escapeHtml(reason)}</p>
        <button id="back-to-lobby" data-testid="back-to-lobby">Back to Lobby</button>
      </div>
    </section>
  `;
}

function renderToast(): string {
  if (!view.toast) return "";
  return `<div class="toast show" data-testid="toast">${escapeHtml(view.toast)}</div>`;
}

function renderEventLine(event: GameEvent): string {
  const payload = event.payload ? ` ${JSON.stringify(event.payload)}` : "";
  return `<p>${escapeHtml(`${event.type}#${event.seq ?? "?"}${payload}`)}</p>`;
}

function renderEmptySlots(): string {
  return Array.from({ length: 7 }, () => `<div class="slot" aria-hidden="true"></div>`).join("");
}

function bindStaticActions(): void {
  document.querySelector<HTMLFormElement>("#join-form")?.addEventListener("submit", joinRoom);
  document.querySelector<HTMLFormElement>("#auth-form")?.addEventListener("submit", (event) => void signInWithPassword(event));
  document.querySelector<HTMLButtonElement>("#sign-up")?.addEventListener("click", () => void signUpWithPassword());
  document.querySelector<HTMLButtonElement>("#google-sign-in")?.addEventListener("click", () => void signInWithGoogle());
  document.querySelector<HTMLButtonElement>("#sign-out")?.addEventListener("click", () => void signOut());
  document.querySelector<HTMLButtonElement>("#refresh-account")?.addEventListener("click", () => void loadAccountData());
  document.querySelector<HTMLButtonElement>("#sync-collection")?.addEventListener("click", () => void syncCollection());
  document.querySelector<HTMLButtonElement>("#new-deck")?.addEventListener("click", () => startNewDeck());
  document.querySelector<HTMLButtonElement>("#autofill-deck")?.addEventListener("click", autofillDeck);
  document.querySelector<HTMLButtonElement>("#clear-deck")?.addEventListener("click", clearDeck);
  document.querySelector<HTMLFormElement>("#deck-form")?.addEventListener("submit", (event) => void saveEditingDeck(event));
  document.querySelector<HTMLButtonElement>("#mulligan")?.addEventListener("click", () => {
    send({ type: "submitMulligan", replaceHandInstanceIds: [...view.mulliganSelection] });
    view.mulliganSelection.clear();
    render();
  });
  document.querySelector<HTMLButtonElement>("#play")?.addEventListener("click", () => {
    if (!view.selectedHandId) return;
    const selectedCard = view.hand.find((card) => card.instanceId === view.selectedHandId);
    send({ type: "playCard", handInstanceId: view.selectedHandId, target: view.selectedTarget ?? inferDefaultTarget(selectedCard?.cardId) });
  });
  document.querySelector<HTMLButtonElement>("#attack")?.addEventListener("click", () => {
    if (!view.selectedAttackerId || !view.selectedTarget) return;
    send({ type: "attack", attackerInstanceId: view.selectedAttackerId, target: view.selectedTarget });
  });
  document.querySelector<HTMLButtonElement>("#end-turn")?.addEventListener("click", () => send({ type: "endTurn" }));
  document.querySelector<HTMLButtonElement>("#concede")?.addEventListener("click", () => send({ type: "concede" }));
  document.querySelector<HTMLButtonElement>("#back-to-lobby")?.addEventListener("click", () => void backToLobby());

  for (const el of document.querySelectorAll<HTMLElement>("[data-select-deck]")) {
    el.addEventListener("click", () => {
      view.selectedDeckId = el.dataset.selectDeck;
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-edit-deck]")) {
    el.addEventListener("click", () => {
      const deck = view.decks.find((item) => item.id === el.dataset.editDeck);
      if (deck) view.editingDeck = { ...deck, card_ids: [...deck.card_ids] };
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-delete-deck]")) {
    el.addEventListener("click", () => void deleteDeck(el.dataset.deleteDeck));
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-add-card]")) {
    el.addEventListener("click", () => addCardToEditor(el.dataset.addCard));
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-remove-card]")) {
    el.addEventListener("click", () => removeCardFromEditor(el.dataset.removeCard));
  }
}

function bindSelectionActions(): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-hand-id]")) {
    el.addEventListener("click", () => {
      view.selectedHandId = el.dataset.handId;
      view.selectedAttackerId = undefined;
      view.selectedTarget = undefined;
      render();
    });
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-attacker-id]")) {
    el.addEventListener("click", (event) => {
      event.stopImmediatePropagation();
      view.selectedAttackerId = el.dataset.attackerId;
      view.selectedHandId = undefined;
      view.selectedTarget = undefined;
      render();
    });
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-target]")) {
    el.addEventListener("click", () => {
      view.selectedTarget = JSON.parse(el.dataset.target!);
      render();
    });
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-mulligan-id]")) {
    el.addEventListener("click", () => {
      const id = el.dataset.mulliganId;
      if (!id) return;
      if (view.mulliganSelection.has(id)) view.mulliganSelection.delete(id);
      else view.mulliganSelection.add(id);
      render();
    });
  }
}

async function backToLobby(): Promise<void> {
  const room = view.room;
  view.room = undefined;
  view.mySeat = undefined;
  view.hand = [];
  view.state = undefined;
  view.publicSync = undefined;
  view.presence.clear();
  view.rejectedHandIds.clear();
  view.selectedHandId = undefined;
  view.mulliganSelection.clear();
  view.selectedAttackerId = undefined;
  view.selectedTarget = undefined;
  view.events = [];
  view.eventStatus = undefined;
  view.toast = undefined;
  if (room) {
    try {
      await room.leave(true);
    } catch {
      // The room may already be closed after match cleanup.
    }
  }
  if (supabase && view.session) await loadAccountData();
  else render();
}

async function joinRoom(event: Event): Promise<void> {
  event.preventDefault();
  if (view.joining || view.room) return;
  view.joining = true;
  view.joinError = undefined;
  render();

  const serverUrl = (document.querySelector<HTMLInputElement>("#server-url")?.value || defaultServerUrl).trim();
  const displayName = (document.querySelector<HTMLInputElement>("#display-name")?.value || "Player").trim();
  const client = new Client(serverUrl);

  try {
    if (supabase && !view.session) throw new Error("Sign in before joining PvP.");
    if (supabase && !view.selectedDeckId) throw new Error("Select a saved deck before joining PvP.");
    const reconnectToken = new URLSearchParams(location.search).get("reconnect");
    const joinOptions = supabase
      ? {
          displayName: view.profile?.display_name ?? displayName,
          accessToken: view.session?.access_token,
          deckId: view.selectedDeckId
        }
      : { displayName };
    const joined: Room = reconnectToken
      ? await (client as any).reconnect(reconnectToken, GameStateSchema)
      : await client.joinOrCreate("pvp", joinOptions, GameStateSchema);

    view.room = joined;
    view.eventStatus = undefined;
    view.publicSync = undefined;
    view.presence.clear();
    view.rejectedHandIds.clear();
    (window as any).__room = joined;

    joined.onStateChange((nextState: any) => {
      view.state = nextState;
      publishDebugState();
      pruneSelections();
      render();
    });
    joined.onMessage("seat", (message: { seat: Seat }) => {
      view.mySeat = message.seat;
      render();
    });
    joined.onMessage("hand", (message: { cards: HandCardView[] }) => {
      view.hand = message.cards;
      pruneSelections();
      render();
    });
    joined.onMessage("presence", (message: { seat: Seat; connected: boolean; reconnectUntilMs?: number }) => {
      view.presence.set(message.seat, { connected: message.connected, reconnectUntilMs: message.reconnectUntilMs });
      render();
    });
    joined.onMessage(
      "publicSync",
      (message: {
        status?: GameStatus;
        activeSeat?: Seat;
        turnNumber?: number;
        actionSeq?: number;
        result?: any;
        players?: Partial<Record<Seat, PublicPlayer>>;
      }) => {
      view.publicSync = message;
      render();
      }
    );
    joined.onMessage("events", (message: GameEvent[]) => {
      handleEvents(message);
    });
  } catch (error) {
    view.joinError = error instanceof Error ? error.message : "Unable to join room.";
  } finally {
    view.joining = false;
    render();
  }
}

async function initializeAccount(): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  view.session = data.session;
  if (view.session) await loadAccountData();
  supabase.auth.onAuthStateChange((_event, session) => {
    view.session = session;
    if (session) void loadAccountData();
    else {
      view.profile = undefined;
      view.decks = [];
      view.collection = [];
      view.matchHistory = [];
      view.selectedDeckId = undefined;
      view.editingDeck = undefined;
      render();
    }
  });
  render();
}

async function signInWithPassword(event: Event): Promise<void> {
  event.preventDefault();
  if (!supabase) return;
  const credentials = readAuthFields();
  await withAccountLoading(async () => {
    const { error } = await supabase.auth.signInWithPassword(credentials);
    if (error) throw error;
    view.accountMessage = "Signed in.";
  });
}

async function signUpWithPassword(): Promise<void> {
  if (!supabase) return;
  const { email, password } = readAuthFields();
  await withAccountLoading(async () => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: email.split("@")[0] || "Player" } }
    });
    if (error) throw error;
    view.accountMessage = "Account created. Confirm email if your Supabase project requires it, then sign in.";
  });
}

async function signInWithGoogle(): Promise<void> {
  if (!supabase) return;
  await withAccountLoading(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname }
    });
    if (error) throw error;
  });
}

async function signOut(): Promise<void> {
  if (!supabase) return;
  await withAccountLoading(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    view.accountMessage = "Signed out.";
  });
}

async function loadAccountData(): Promise<void> {
  if (!supabase || !view.session?.user) return;
  await withAccountLoading(async () => {
    await ensureProfile();
    await ensureCollection();

    const userId = view.session!.user.id;
    const [profileResult, decksResult, collectionResult, historyResult] = await Promise.all([
      supabase.from("profiles").select("user_id,display_name,avatar_url").eq("user_id", userId).single(),
      supabase
        .from("decks")
        .select("id,user_id,name,card_catalog_version,card_ids,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("card_collections")
        .select("card_id,quantity")
        .eq("user_id", userId)
        .eq("card_catalog_version", CARD_CATALOG_VERSION)
        .order("card_id", { ascending: true }),
      supabase
        .from("match_history")
        .select("id,winner_seat,result_reason,created_at,finished_at")
        .order("finished_at", { ascending: false })
        .limit(20)
    ]);

    if (profileResult.error) throw profileResult.error;
    if (decksResult.error) throw decksResult.error;
    if (collectionResult.error) throw collectionResult.error;
    if (historyResult.error) throw historyResult.error;

    view.profile = profileResult.data as ProfileRow;
    view.decks = (decksResult.data ?? []) as DeckRow[];
    view.collection = (collectionResult.data ?? []) as CollectionRow[];
    view.matchHistory = (historyResult.data ?? []) as MatchHistoryRow[];
    if (!view.selectedDeckId || !view.decks.some((deck) => deck.id === view.selectedDeckId)) {
      view.selectedDeckId = view.decks[0]?.id;
    }
    if (!view.editingDeck) startNewDeck(false);
  });
}

async function syncCollection(): Promise<void> {
  if (!supabase || !view.session?.user) return;
  await withAccountLoading(async () => {
    await ensureCollection();
    view.accountMessage = "Collection synced.";
    await loadAccountDataRaw();
  });
}

async function loadAccountDataRaw(): Promise<void> {
  if (!supabase || !view.session?.user) return;
  const userId = view.session.user.id;
  const [profileResult, decksResult, collectionResult, historyResult] = await Promise.all([
    supabase.from("profiles").select("user_id,display_name,avatar_url").eq("user_id", userId).single(),
    supabase
      .from("decks")
      .select("id,user_id,name,card_catalog_version,card_ids,updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("card_collections")
      .select("card_id,quantity")
      .eq("user_id", userId)
      .eq("card_catalog_version", CARD_CATALOG_VERSION)
      .order("card_id", { ascending: true }),
    supabase
      .from("match_history")
      .select("id,winner_seat,result_reason,created_at,finished_at")
      .order("finished_at", { ascending: false })
      .limit(20)
  ]);

  if (profileResult.error) throw profileResult.error;
  if (decksResult.error) throw decksResult.error;
  if (collectionResult.error) throw collectionResult.error;
  if (historyResult.error) throw historyResult.error;

  view.profile = profileResult.data as ProfileRow;
  view.decks = (decksResult.data ?? []) as DeckRow[];
  view.collection = (collectionResult.data ?? []) as CollectionRow[];
  view.matchHistory = (historyResult.data ?? []) as MatchHistoryRow[];
  if (!view.selectedDeckId || !view.decks.some((deck) => deck.id === view.selectedDeckId)) {
    view.selectedDeckId = view.decks[0]?.id;
  }
  if (!view.editingDeck) startNewDeck(false);
}

async function ensureCollection(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc("ensure_full_seed_collection", {
    target_version: CARD_CATALOG_VERSION
  });
  if (error) throw error;
}

async function ensureProfile(): Promise<void> {
  if (!supabase || !view.session?.user) return;
  const user = view.session.user;
  const metadata = user.user_metadata ?? {};
  const displayName =
    (typeof metadata.display_name === "string" && metadata.display_name) ||
    (typeof metadata.name === "string" && metadata.name) ||
    user.email?.split("@")[0] ||
    "Player";
  const { error } = await supabase.from("profiles").upsert({
    user_id: user.id,
    display_name: displayName,
    avatar_url: typeof metadata.avatar_url === "string" ? metadata.avatar_url : null
  });
  if (error) throw error;
}

async function saveEditingDeck(event: Event): Promise<void> {
  event.preventDefault();
  if (!supabase || !view.editingDeck) return;
  const name = (document.querySelector<HTMLInputElement>("#deck-name")?.value ?? view.editingDeck.name).trim();
  const cardIds = view.editingDeck.card_ids;
  await withAccountLoading(async () => {
    const { data, error } = await supabase.rpc("save_user_deck", {
      p_deck_id: view.editingDeck?.id ?? null,
      p_name: name,
      p_card_catalog_version: CARD_CATALOG_VERSION,
      p_card_ids: cardIds
    });
    if (error) throw error;
    const saved = data as DeckRow;
    view.accountMessage = `Saved ${saved.name}.`;
    view.selectedDeckId = saved.id;
    view.editingDeck = { ...saved, card_ids: [...saved.card_ids] };
    await loadAccountData();
  });
}

async function deleteDeck(deckId: string | undefined): Promise<void> {
  if (!supabase || !deckId) return;
  await withAccountLoading(async () => {
    const { error } = await supabase.rpc("delete_user_deck", { p_deck_id: deckId });
    if (error) throw error;
    view.accountMessage = "Deck deleted.";
    if (view.selectedDeckId === deckId) view.selectedDeckId = undefined;
    if (view.editingDeck?.id === deckId) startNewDeck(false);
    await loadAccountData();
  });
}

function startNewDeck(doRender = true): void {
  view.editingDeck = { name: "New Deck", card_ids: [] };
  if (doRender) render();
}

function autofillDeck(): void {
  if (!view.editingDeck) startNewDeck(false);
  const ids: string[] = [];
  for (const card of CARD_CATALOG) {
    if (card.collectible === false) continue;
    const copies = deckCopyLimit(card);
    for (let i = 0; i < copies && ids.length < 30; i++) ids.push(card.id);
    if (ids.length >= 30) break;
  }
  view.editingDeck = { ...view.editingDeck!, card_ids: ids };
  render();
}

function clearDeck(): void {
  if (!view.editingDeck) return;
  view.editingDeck = { ...view.editingDeck, card_ids: [] };
  render();
}

function addCardToEditor(cardId: string | undefined): void {
  if (!cardId) return;
  if (!view.editingDeck) startNewDeck(false);
  const card = cardCatalog.get(cardId);
  if (!card) return;
  const counts = countCards(view.editingDeck!.card_ids);
  const limit = deckCopyLimit(card);
  if ((counts.get(cardId) ?? 0) >= limit || view.editingDeck!.card_ids.length >= 30) return;
  view.editingDeck = { ...view.editingDeck!, card_ids: [...view.editingDeck!.card_ids, cardId] };
  render();
}

function removeCardFromEditor(cardId: string | undefined): void {
  if (!cardId || !view.editingDeck) return;
  const index = view.editingDeck.card_ids.indexOf(cardId);
  if (index < 0) return;
  const cardIds = [...view.editingDeck.card_ids];
  cardIds.splice(index, 1);
  view.editingDeck = { ...view.editingDeck, card_ids: cardIds };
  render();
}

async function withAccountLoading(action: () => Promise<void>): Promise<void> {
  view.accountLoading = true;
  view.accountError = undefined;
  view.accountMessage = undefined;
  render();
  try {
    await action();
  } catch (error) {
    view.accountError = errorMessage(error);
  } finally {
    view.accountLoading = false;
    render();
  }
}

function readAuthFields(): { email: string; password: string } {
  const email = document.querySelector<HTMLInputElement>("#auth-email")?.value.trim() ?? "";
  const password = document.querySelector<HTMLInputElement>("#auth-password")?.value ?? "";
  if (!email || !password) throw new Error("Email and password are required.");
  return { email, password };
}

function send(command: GameCommand): void {
  if (!view.room) return;
  const expectedActionSeq = view.publicSync?.actionSeq ?? view.state?.turn?.actionSeq ?? 0;
  const message: ClientCommandMessage = {
    commandId: `${view.mySeat ?? "client"}-${crypto.randomUUID()}`,
    expectedActionSeq,
    command
  };
  view.room.send("command", message);
  if (command.type !== "submitMulligan" && command.type !== "reconnect") {
    view.publicSync = { ...view.publicSync, actionSeq: expectedActionSeq + 1 };
  }
}

function handleEvents(message: GameEvent[]): void {
  view.events = [...message, ...view.events].slice(0, 50);
  const rejection = message.find((item) => item.type === "COMMAND_REJECTED");
  if (rejection) {
    if (view.selectedHandId) view.rejectedHandIds.add(view.selectedHandId);
    view.toast = String(rejection.payload?.reason ?? "Command rejected.");
    window.setTimeout(() => {
      view.toast = undefined;
      render();
    }, 2200);
  }
  if (message.some((item) => item.type === "GAME_FINISHED")) {
    view.eventStatus = "finished";
  } else if (message.some((item) => item.type === "TURN_STARTED")) {
    view.eventStatus = "in_progress";
  }
  render();
}

function pruneSelections(): void {
  const handIds = new Set(view.hand.map((card) => card.instanceId));
  if (view.selectedHandId && !handIds.has(view.selectedHandId)) view.selectedHandId = undefined;
  for (const id of view.rejectedHandIds) {
    if (!handIds.has(id)) view.rejectedHandIds.delete(id);
  }
  for (const id of view.mulliganSelection) {
    if (!handIds.has(id)) view.mulliganSelection.delete(id);
  }
  if (view.selectedAttackerId && !findMinion(view.selectedAttackerId)) view.selectedAttackerId = undefined;
}

function readPlayer(seat: Seat): PublicPlayer | undefined {
  return applyPresenceOverride(seat, view.publicSync?.players?.[seat] ?? (view.state ? readPlayerFromState(view.state, seat) : undefined));
}

function readPlayerFromState(source: any, seat: Seat): PublicPlayer | undefined {
  return source.players?.get?.(seat) ?? source.players?.[seat] ?? source[seat];
}

function applyPresenceOverride(seat: Seat, player: PublicPlayer | undefined): PublicPlayer | undefined {
  const presence = view.presence.get(seat);
  if (!player || !presence) return player;
  return {
    ...player,
    connected: presence.connected,
    reconnectUntilMs: presence.reconnectUntilMs ?? player.reconnectUntilMs
  };
}

function readStatus(): GameStatus | "" {
  const status = view.state?.status ?? "";
  if (view.publicSync?.status) return view.publicSync.status;
  if (view.eventStatus === "in_progress" && status === "mulligan") return "in_progress";
  return status === "finished" || status === "abandoned" ? status : view.eventStatus ?? status;
}

function readActiveSeat(): Seat | "" {
  if (view.publicSync?.activeSeat) return view.publicSync.activeSeat;
  const turnStarted = view.events.find((event) => event.type === "TURN_STARTED");
  const eventSeat = turnStarted?.payload?.activeSeat;
  if (eventSeat === "player1" || eventSeat === "player2") return eventSeat;
  return view.state?.turn?.activeSeat ?? "";
}

function readTurnNumber(): number {
  return view.publicSync?.turnNumber ?? view.state?.turn?.number ?? 0;
}

function hasBothPlayers(): boolean {
  return seats.every((seat) => Boolean(readPlayer(seat)?.displayName));
}

function otherSeat(seat: Seat): Seat {
  return seat === "player1" ? "player2" : "player1";
}

function resolveHandCard(card: HandCardView): ResolvedCardView {
  const catalogCard = cardCatalog.get(card.cardId);
  return {
    cardId: card.cardId,
    instanceId: card.instanceId,
    name: catalogCard?.name ?? card.cardId,
    category: catalogCard?.category ?? card.type,
    description: catalogCard?.description ?? "",
    image: catalogCard?.image ?? "",
    cost: card.cost,
    type: card.type,
    rarity: catalogCard?.rarity ?? "COMMON",
    attack: card.attack ?? catalogCard?.attack,
    health: card.health ?? catalogCard?.health
  };
}

function selectedMinionClass(instanceId: string, target: TargetRef): string {
  if (view.selectedAttackerId === instanceId) return "selected attacker-selected";
  if (sameTarget(view.selectedTarget, target)) return "selected target-selected";
  return "";
}

function isTargetHighlighted(target: TargetRef): boolean {
  if (!view.selectedHandId && !view.selectedAttackerId) return false;
  if (sameTarget(view.selectedTarget, target)) return true;
  if (view.selectedAttackerId && target.side === view.mySeat) return false;
  return true;
}

function sameTarget(a: TargetRef | undefined, b: TargetRef): boolean {
  return Boolean(a && a.type === b.type && a.side === b.side && a.instanceId === b.instanceId);
}

function targetLabel(target: TargetRef): string {
  return target.type === "HERO" ? `${target.side} hero` : `${target.side} ${target.instanceId}`;
}

function targetAttr(target: TargetRef): string {
  return escapeAttr(JSON.stringify(target));
}

function findMinion(instanceId: string): PublicMinion | undefined {
  for (const seat of seats) {
    const minion = Array.from(readPlayer(seat)?.board ?? []).find((item) => item.instanceId === instanceId);
    if (minion) return minion;
  }
  return undefined;
}

function minionKeywords(minion: PublicMinion): string[] {
  return [
    minion.taunt ? "taunt" : "",
    minion.divineShield ? "shield" : "",
    minion.canAttack ? "ready" : "",
    minion.lockedTurns > 0 ? `lock ${minion.lockedTurns}` : "",
    minion.deathTimer !== undefined && minion.deathTimer >= 0 ? `timer ${minion.deathTimer}` : "",
    minion.questTurns !== undefined && minion.questTurns >= 0 ? `quest ${minion.questTurns}` : ""
  ].filter(Boolean);
}

function canAfford(cost: number): boolean {
  const player = view.mySeat ? readPlayer(view.mySeat) : undefined;
  return Boolean(player && player.mana.current >= cost && readActiveSeat() === view.mySeat);
}

function cardNeedsTarget(cardId: string): boolean {
  const effect = cardCatalog.get(cardId)?.keywords?.battlecry;
  return Boolean(effect?.target);
}

function inferDefaultTarget(cardId: string | undefined): TargetRef | undefined {
  if (!cardId || !view.mySeat) return undefined;
  const rule = cardCatalog.get(cardId)?.keywords?.battlecry?.target;
  if (!rule) return undefined;
  const enemy = otherSeat(view.mySeat);
  if (rule.type === "HERO" || rule.type === "ALL") {
    if (rule.side === "FRIENDLY") return { type: "HERO", side: view.mySeat };
    return { type: "HERO", side: enemy };
  }
  if (rule.type !== "MINION") return undefined;

  const sideOrder: Seat[] =
    rule.side === "FRIENDLY" ? [view.mySeat] : rule.side === "ENEMY" ? [enemy] : [enemy, view.mySeat];
  for (const side of sideOrder) {
    const minion = Array.from(readPlayer(side)?.board ?? [])[0];
    if (minion) return { type: "MINION", side, instanceId: minion.instanceId };
  }
  return undefined;
}

function countCards(cardIds: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of cardIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

function deckCopyLimit(card: CardDefinition): number {
  if (card.collectible === false) return 0;
  return card.rarity === "LEGENDARY" ? 1 : 2;
}

function hasCollectionRows(): boolean {
  return view.collection.length > 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const maybe = error as { message?: unknown; error_description?: unknown; details?: unknown; hint?: unknown };
    const parts = [maybe.message, maybe.error_description, maybe.details, maybe.hint]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0);
    if (parts.length > 0) return parts.join(" ");
  }
  if (typeof error === "string" && error.trim()) return error;
  return "Account action failed. Check Supabase configuration and browser console.";
}

function fanStyle(index: number, total: number): string {
  if (total <= 1) return "--rot: 0deg; --y: 0px;";
  const center = (total - 1) / 2;
  const distance = index - center;
  const rotation = Math.max(-18, Math.min(18, distance * 5));
  const y = Math.abs(distance) * 4;
  return `--rot: ${rotation}deg; --y: ${y}px;`;
}

function assetUrl(path: string): string {
  if (!path) return "";
  if (/^https?:\/\//.test(path) || path.startsWith("/")) return path;
  return `/${path.replace(/^assets\//, "").replace(/\\/g, "/")}`;
}

function publishDebugState(): void {
  if ((window as any).__gameState) return;
  const debugState: any = {
    players: {
      get: (seat: Seat) => debugPlayer(view.state, seat)
    }
  };
  Object.defineProperties(debugState, {
    status: { get: () => readStatus() },
    turn: { get: () => view.state?.turn },
    player1: { get: () => debugPlayer(view.state, "player1") },
    player2: { get: () => debugPlayer(view.state, "player2") }
  });
  Object.defineProperties(debugState.players, {
    player1: { get: () => debugPlayer(view.state, "player1") },
    player2: { get: () => debugPlayer(view.state, "player2") }
  });
  (window as any).__gameState = debugState;
}

function debugPlayer(source: any, seat: Seat): PublicPlayer | undefined {
  const player = readPlayerFromState(source, seat);
  if (!player) return undefined;
  const reconnectUntilMs = player.reconnectUntilMs ?? -1;
  return applyPresenceOverride(seat, {
    ...player,
    connected: reconnectUntilMs > 0 ? false : player.connected
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
