import { Client, type Room } from "@colyseus/sdk";
import { CARD_CATALOG } from "@twcardgame/cards";
import type { GameCommand, HandCardView, Seat, TargetRef } from "@twcardgame/shared";
import { GameStateSchema } from "./schema.js";
import "./styles.css";

const cardNames = new Map(CARD_CATALOG.map((card) => [card.id, card.name]));
const app = document.querySelector<HTMLDivElement>("#app")!;
const defaultServerUrl = import.meta.env.VITE_COLYSEUS_URL || "ws://localhost:2567";

let room: Room | undefined;
let mySeat: Seat | undefined;
let hand: HandCardView[] = [];
let state: any;
let selectedHandId: string | undefined;
let selectedAttackerId: string | undefined;
let selectedTarget: TargetRef | undefined;
let events: string[] = [];

render();

function render(): void {
  app.innerHTML = `
    <section class="topbar">
      <div>
        <h1>寶島遊戲王 v2</h1>
        <p>${room ? `Room ${room.roomId} · ${mySeat ?? "spectating"}` : "Authoritative PvP prototype"}</p>
      </div>
      <form id="join-form" class="join">
        <input id="server-url" value="${defaultServerUrl}" ${room ? "disabled" : ""} aria-label="Server URL" />
        <input id="display-name" value="Player" ${room ? "disabled" : ""} aria-label="Display name" />
        <button ${room ? "disabled" : ""}>Join</button>
      </form>
    </section>
    ${state ? renderGame() : `<section class="empty">Start the v2 server, then join a PvP room.</section>`}
  `;

  document.querySelector<HTMLFormElement>("#join-form")?.addEventListener("submit", joinRoom);
  document.querySelector<HTMLButtonElement>("#mulligan")?.addEventListener("click", () => send({ type: "submitMulligan", replaceHandInstanceIds: selectedHandId ? [selectedHandId] : [] }));
  document.querySelector<HTMLButtonElement>("#play")?.addEventListener("click", () => selectedHandId && send({ type: "playCard", handInstanceId: selectedHandId, target: selectedTarget }));
  document.querySelector<HTMLButtonElement>("#attack")?.addEventListener("click", () => selectedAttackerId && selectedTarget && send({ type: "attack", attackerInstanceId: selectedAttackerId, target: selectedTarget }));
  document.querySelector<HTMLButtonElement>("#end-turn")?.addEventListener("click", () => send({ type: "endTurn" }));
  document.querySelector<HTMLButtonElement>("#concede")?.addEventListener("click", () => send({ type: "concede" }));

  for (const el of document.querySelectorAll<HTMLElement>("[data-hand-id]")) {
    el.addEventListener("click", () => {
      selectedHandId = el.dataset.handId;
      selectedAttackerId = undefined;
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-attacker-id]")) {
    el.addEventListener("click", () => {
      selectedAttackerId = el.dataset.attackerId;
      selectedHandId = undefined;
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-target]")) {
    el.addEventListener("click", () => {
      selectedTarget = JSON.parse(el.dataset.target!);
      render();
    });
  }
}

async function joinRoom(event: Event): Promise<void> {
  event.preventDefault();
  const serverUrl = (document.querySelector<HTMLInputElement>("#server-url")?.value || defaultServerUrl).trim();
  const displayName = (document.querySelector<HTMLInputElement>("#display-name")?.value || "Player").trim();
  const client = new Client(serverUrl);
  room = await client.joinOrCreate("pvp", { displayName }, GameStateSchema);

  room.onStateChange((nextState: any) => {
    state = nextState;
    render();
  });
  room.onMessage("seat", (message: { seat: Seat }) => {
    mySeat = message.seat;
    render();
  });
  room.onMessage("hand", (message: { cards: HandCardView[] }) => {
    hand = message.cards;
    render();
  });
  room.onMessage("events", (message: Array<{ type: string; payload?: unknown }>) => {
    events = [...message.map((item) => `${item.type} ${item.payload ? JSON.stringify(item.payload) : ""}`), ...events].slice(0, 50);
    render();
  });
}

function send(command: GameCommand): void {
  if (!room) return;
  room.send("command", {
    commandId: `${mySeat ?? "client"}-${crypto.randomUUID()}`,
    command
  });
}

function renderGame(): string {
  const p1 = readPlayer("player1");
  const p2 = readPlayer("player2");
  const activeSeat = state.turn?.activeSeat ?? "";
  return `
    <section class="status">
      <span>Status: ${state.status}</span>
      <span>Turn: ${state.turn?.number ?? 0}</span>
      <span>Active: ${activeSeat}</span>
      <span>Selected target: ${selectedTarget ? targetLabel(selectedTarget) : "none"}</span>
    </section>
    <section class="table">
      ${renderPlayer("player2", p2)}
      ${renderControls()}
      ${renderPlayer("player1", p1)}
    </section>
    <section class="hand">
      <h2>Your Hand</h2>
      <div class="hand-row">${hand.map(renderHandCard).join("") || `<div class="muted">Waiting for private hand sync.</div>`}</div>
    </section>
    <section class="log">
      <h2>Events</h2>
      ${events.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
    </section>
  `;
}

function renderPlayer(seat: Seat, player: any): string {
  const board = Array.from(player?.board ?? []);
  return `
    <section class="player ${seat === mySeat ? "me" : ""}">
      <button class="hero" data-target='${JSON.stringify({ type: "HERO", side: seat })}'>
        <strong>${player?.displayName ?? seat}</strong>
        <span>HP ${player?.hero?.hp ?? 0}/${player?.hero?.maxHp ?? 0}</span>
        <span>Mana ${player?.mana?.current ?? 0}/${player?.mana?.max ?? 0}</span>
        <span>Hand ${player?.handCount ?? 0} · Deck ${player?.deckCount ?? 0}</span>
      </button>
      <div class="board">
        ${board.map((minion: any) => renderMinion(seat, minion)).join("") || `<div class="slot">Empty board</div>`}
      </div>
    </section>
  `;
}

function renderMinion(seat: Seat, minion: any): string {
  const target = JSON.stringify({ type: "MINION", side: seat, instanceId: minion.instanceId });
  const mine = seat === mySeat;
  return `
    <button
      class="minion ${selectedAttackerId === minion.instanceId ? "selected" : ""}"
      ${mine ? `data-attacker-id="${minion.instanceId}"` : ""}
      data-target='${target}'
    >
      <strong>${cardNames.get(minion.cardId) ?? minion.cardId}</strong>
      <span>${minion.attack}/${minion.currentHealth}/${minion.health}</span>
      <small>${[
        minion.taunt ? "taunt" : "",
        minion.divineShield ? "shield" : "",
        minion.canAttack ? "ready" : "",
        minion.lockedTurns > 0 ? `lock ${minion.lockedTurns}` : ""
      ]
        .filter(Boolean)
        .join(" ")}</small>
    </button>
  `;
}

function renderHandCard(card: HandCardView): string {
  return `
    <button class="card ${selectedHandId === card.instanceId ? "selected" : ""}" data-hand-id="${card.instanceId}">
      <strong>${cardNames.get(card.cardId) ?? card.cardId}</strong>
      <span>Cost ${card.cost}</span>
      <small>${card.type}${card.attack !== undefined ? ` · ${card.attack}/${card.health}` : ""}</small>
    </button>
  `;
}

function renderControls(): string {
  return `
    <section class="controls">
      <button id="mulligan">Mulligan Ready</button>
      <button id="play" ${selectedHandId ? "" : "disabled"}>Play Selected</button>
      <button id="attack" ${selectedAttackerId && selectedTarget ? "" : "disabled"}>Attack Target</button>
      <button id="end-turn">End Turn</button>
      <button id="concede">Concede</button>
    </section>
  `;
}

function readPlayer(seat: Seat): any {
  return state.players?.get?.(seat) ?? state.players?.[seat] ?? state[seat];
}

function targetLabel(target: TargetRef): string {
  return target.type === "HERO" ? `${target.side} hero` : `${target.side} ${target.instanceId}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
