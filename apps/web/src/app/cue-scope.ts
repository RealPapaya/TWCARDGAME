import type { GameEvent, Seat } from "@twcardgame/shared";
import type { AnimationKind, AnimationSweepVariant } from "./types.js";

/**
 * Pure, DOM-free classification of one `events` batch (= one server command)
 * into single-target vs whole-board (全場 / AOE) effects.
 *
 * The rules engine emits AOE as N separate single-target events of the same
 * type in one batch (e.g. DAMAGE_ALL_ENEMY_MINIONS → one DAMAGE per minion).
 * AOE is a *presentation* concern, so detection lives here in the web client —
 * `packages/rules` stays pure and carries no aoe flag.
 *
 * Basic combat damage (ATTACK → DAMAGE [→ retaliation DAMAGE]) must NEVER be
 * treated as effect damage or clustered as AOE; the attacker's lunge already
 * carries the attack, so combat damage keeps the plain `damage` cue.
 */

/** A whole-board effect: ≥2 distinct targets share one effect family in a batch. */
export type AoeCluster = {
  /** Cue kind for the synthetic board-wide overlay. Always "aoeSweep". */
  kind: Extract<AnimationKind, "aoeSweep">;
  variant: AnimationSweepVariant;
  /** Owner seat of the affected units — picks which board the sweep covers. */
  seat?: Seat;
  /** seqs of the per-target events that belong to this cluster. */
  memberSeqs: number[];
};

export type BatchScopeResult = {
  /** seqs of DAMAGE events that are basic combat (never effectStrike/AOE). */
  combatDamageSeqs: Set<number>;
  /** seqs of every event that is a member of some AOE cluster. */
  aoeSeqs: Set<number>;
  aoeClusters: AoeCluster[];
  /**
   * seqs of DAMAGE events that belong to a multi-hit strike card (e.g. 彈劾賴皇
   * S002 — "隨機分配 N 點傷害"). These stay individual `effectStrike` cues
   * (one staggered flying blade per point) instead of being clustered into a
   * single `aoeSweep`. The runtime reuses this set to apply the per-hit stagger.
   */
  multiHitSeqs: Set<number>;
};

/**
 * Cards whose damage is dealt as N separate 1-point hits and should animate as
 * N staggered flying blades rather than one whole-board sweep. The rules engine
 * already emits one DAMAGE event per point; this is purely a presentation opt-in.
 */
export const MULTI_HIT_STRIKE_CARD_IDS = new Set<string>(["S002"]);

/** Effect families that can sweep the board. Order fixes sweep stacking. */
type Family = "damage" | "heal" | "bounce" | "buff" | "lock" | "destroy";

function eventTargetKey(event: GameEvent): string | undefined {
  const payload = event.payload ?? {};
  // DEATHRATTLE carries `source`; everything else carries `target`.
  const key = event.type === "DEATHRATTLE" ? payload.source : payload.target;
  return typeof key === "string" ? key : undefined;
}

/**
 * Family an event clusters under, or undefined if it never sweeps.
 * Combat DAMAGE (its seq in `combatDamageSeqs`) is excluded from "damage".
 */
function familyOf(event: GameEvent, combatDamageSeqs: Set<number>): Family | undefined {
  switch (event.type) {
    case "DAMAGE":
      return combatDamageSeqs.has(event.seq) ? undefined : "damage";
    case "HEAL":
      return "heal";
    case "BOUNCE":
      return "bounce";
    case "DESTROY":
      return "destroy";
    case "BUFF":
      return typeof (event.payload ?? {}).lockedTurns === "number" ? "lock" : "buff";
    default:
      // SHIELD_POPPED, DEATHRATTLE, MINION_SUMMONED, … never sweep.
      return undefined;
  }
}

const FAMILY_TO_VARIANT: Record<Family, AnimationSweepVariant> = {
  damage: "damage",
  heal: "heal",
  bounce: "bounce",
  buff: "buff",
  lock: "lock",
  destroy: "destroy"
};

const FAMILY_ORDER: Family[] = ["damage", "heal", "bounce", "buff", "lock", "destroy"];

/**
 * Marks every DAMAGE that belongs to basic combat as non-effect. A single
 * ATTACK resolves to at most two hits — the defender and the attacker's
 * retaliation — each of which is either a DAMAGE or a divine-shield pop. We
 * bound the window to those two slots so a later effect (which can only happen
 * in a *different* command/batch) is never swallowed as combat.
 */
export function findCombatDamageSeqs(events: GameEvent[]): Set<number> {
  const combat = new Set<number>();
  let combatHitsLeft = 0;
  for (const event of events) {
    if (event.type === "ATTACK") {
      combatHitsLeft = 2;
      continue;
    }
    if (combatHitsLeft > 0 && (event.type === "DAMAGE" || event.type === "SHIELD_POPPED")) {
      if (event.type === "DAMAGE") combat.add(event.seq);
      combatHitsLeft -= 1;
      continue;
    }
    combatHitsLeft = 0;
  }
  return combat;
}

/**
 * Marks DAMAGE events that belong to a multi-hit strike card (e.g. S002). We
 * collect every DAMAGE seq from a `CARD_PLAYED` of such a card up to the next
 * `CARD_PLAYED`/`ATTACK` boundary, so an unrelated effect in the same batch is
 * never swept in. The card id rides on the CARD_PLAYED event; the per-hit DAMAGE
 * events only carry the victim's target/seat, hence this batch-level pass.
 */
export function findMultiHitDamageSeqs(events: GameEvent[]): Set<number> {
  const multiHit = new Set<number>();
  let collecting = false;
  for (const event of events) {
    if (event.type === "CARD_PLAYED") {
      const cardId = (event.payload ?? {}).cardId;
      collecting = typeof cardId === "string" && MULTI_HIT_STRIKE_CARD_IDS.has(cardId);
      continue;
    }
    if (event.type === "ATTACK") {
      collecting = false;
      continue;
    }
    if (collecting && event.type === "DAMAGE") multiHit.add(event.seq);
  }
  return multiHit;
}

export function classifyBatchScopes(events: GameEvent[]): BatchScopeResult {
  const combatDamageSeqs = findCombatDamageSeqs(events);
  const multiHitSeqs = findMultiHitDamageSeqs(events);

  // Bucket by (family, owner seat): a both-board AOE (e.g. destroy-all) sweeps
  // each side separately, so the opponent's board and ours both get an overlay.
  type Bucket = { family: Family; seqs: number[]; targets: Set<string>; seat?: Seat };
  const buckets = new Map<string, Bucket>();
  for (const event of events) {
    // Multi-hit strike damage stays individual (one staggered blade per hit),
    // so it must never be bucketed into an aoeSweep.
    if (multiHitSeqs.has(event.seq)) continue;
    const family = familyOf(event, combatDamageSeqs);
    if (!family) continue;
    const target = eventTargetKey(event);
    if (!target) continue;
    const key = `${family}:${event.seat ?? "?"}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { family, seqs: [], targets: new Set<string>(), seat: event.seat };
      buckets.set(key, bucket);
    }
    bucket.seqs.push(event.seq);
    bucket.targets.add(target);
  }

  // A "damage" sweep already conveys the wipe; the DESTROY events it triggers
  // would otherwise paint a redundant second sweep, so suppress destroy then.
  const hasDamageCluster = [...buckets.values()].some(
    (bucket) => bucket.family === "damage" && bucket.targets.size >= 2
  );

  const aoeSeqs = new Set<number>();
  const aoeClusters: AoeCluster[] = [];
  const ordered = [...buckets.values()].sort(
    (a, b) => FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family)
  );
  for (const bucket of ordered) {
    if (bucket.targets.size < 2) continue;
    if (bucket.family === "destroy" && hasDamageCluster) continue;
    for (const seq of bucket.seqs) aoeSeqs.add(seq);
    aoeClusters.push({
      kind: "aoeSweep",
      variant: FAMILY_TO_VARIANT[bucket.family],
      seat: bucket.seat,
      memberSeqs: [...bucket.seqs]
    });
  }

  return { combatDamageSeqs, aoeSeqs, aoeClusters, multiHitSeqs };
}

/**
 * Final cue kind for an effect event. `isCombatDamage` (from
 * `classifyBatchScopes`) decides whether DAMAGE is a combat hit or a spell
 * strike. Returns undefined for events that produce no transient cue.
 */
export function mapEventToCueKind(event: GameEvent, isCombatDamage: boolean): AnimationKind | undefined {
  switch (event.type) {
    case "DAMAGE":
      return isCombatDamage ? "damage" : "effectStrike";
    case "HEAL":
      return "heal";
    case "SHIELD_POPPED":
      return "shieldPop";
    case "BUFF":
      return typeof (event.payload ?? {}).lockedTurns === "number" ? "lock" : "buff";
    case "BOUNCE":
      return "bounce";
    case "DESTROY":
      return "destroy";
    case "DEATHRATTLE":
      return "deathrattle";
    default:
      return undefined;
  }
}

/**
 * The caster a single-target effect damage should fly FROM. Minion battlecries
 * use the minion they just summoned; 砸雞蛋 is a NEWS card, so it borrows the
 * caster hero as a stable on-screen source for the same blade trail.
 */
export function findEffectSourceKey(events: GameEvent[], startIndex: number): string | undefined {
  if (startIndex < 0) return undefined;
  for (let i = startIndex - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "ATTACK") return undefined;
    if (event.type === "CARD_PLAYED") {
      const cardId = event.payload?.cardId;
      for (let j = i + 1; j < startIndex; j++) {
        const summon = events[j];
        if (summon.type === "MINION_SUMMONED" && summon.seat === event.seat && summon.payload?.cardId === cardId) {
          return typeof summon.payload?.target === "string" ? summon.payload.target : undefined;
        }
      }
      // 砸雞蛋 (S006) and multi-hit strike NEWS cards (e.g. 彈劾賴皇 S002) have no
      // summoned minion to fly from, so the blade borrows the caster hero as a
      // stable on-screen source. `event.seat` here is the CARD_PLAYED seat = the
      // caster, so the blade flies caster→victim (not from the victim's side).
      if (
        (cardId === "S006" || (typeof cardId === "string" && MULTI_HIT_STRIKE_CARD_IDS.has(cardId))) &&
        (event.seat === "player1" || event.seat === "player2")
      ) {
        return `${event.seat}:hero`;
      }
      return undefined;
    }
  }
  return undefined;
}
