import type { GameEvent } from "@twcardgame/shared";

export type SoundCue = "cardPlay" | "cardPlayHeavy" | "cardDraw" | "attack" | "attackHeavy" | "damage" | "heal" | "death" | "turn" | "reject" | "packFlip";

export type AudioViewState = {
  bgmVolume: number;
  sfxVolume: number;
  bgmMuted: boolean;
  sfxMuted: boolean;
};

export const bgmVolumeKey = "twcardgame.bgmVolume";
export const sfxVolumeKey = "twcardgame.sfxVolume";
export const bgmMutedKey = "twcardgame.bgmMuted";
export const sfxMutedKey = "twcardgame.sfxMuted";

const bgmTrack = new Audio("/audio/bgm/Earthbound Ember.mp3");
const sfxPaths: Record<SoundCue, string> = {
  cardPlay: "/audio/sfx/LowCostMionion.mp3",
  cardPlayHeavy: "/audio/sfx/HighCostMionion.mp3",
  cardDraw: "/audio/sfx/card-draw.mp3",
  attack: "/audio/sfx/LightHit.mp3",
  attackHeavy: "/audio/sfx/HeavyHit.mp3",
  damage: "/audio/sfx/LightHit.mp3",
  heal: "/audio/sfx/card-draw.mp3",
  death: "/audio/sfx/MionionDeath.mp3",
  turn: "/audio/sfx/heavy_sandstone_click.mp3",
  reject: "/audio/sfx/Retreat.mp3",
  packFlip: "/audio/sfx/card-draw.mp3"
};

let audioUnlocked = false;
let audioView: AudioViewState | undefined;
let requestRender: (() => void) | undefined;

export function configureAudio(view: AudioViewState, render: () => void): void {
  audioView = view;
  requestRender = render;
}

export function installAudioUnlock(): void {
  const view = requireAudioView();
  bgmTrack.loop = true;
  bgmTrack.preload = "auto";
  bgmTrack.volume = view.bgmMuted ? 0 : view.bgmVolume;
  const unlock = () => {
    audioUnlocked = true;
    ensureBgm();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

export function ensureBgm(): void {
  const view = audioView;
  if (!view || !audioUnlocked) return;
  bgmTrack.volume = view.bgmMuted ? 0 : view.bgmVolume;
  if (view.bgmMuted) {
    bgmTrack.pause();
    return;
  }
  if (!bgmTrack.paused) return;
  void bgmTrack.play().catch(() => {
    // Browsers may still block playback until a stronger user gesture.
  });
}

export function playSfx(cue: SoundCue, volume?: number): void {
  const view = audioView;
  if (!view || view.sfxMuted || !audioUnlocked) return;
  const audio = new Audio(sfxPaths[cue]);
  audio.preload = "auto";
  audio.volume = volume ?? view.sfxVolume;
  void audio.play().catch(() => {
    // Missing files or browser autoplay policy should never break gameplay.
  });
}

export function setBgmVolume(v: number): void {
  const view = requireAudioView();
  view.bgmVolume = v;
  bgmTrack.volume = view.bgmMuted ? 0 : v;
  saveAudioPrefs(view);
}

export function setSfxVolume(v: number): void {
  const view = requireAudioView();
  view.sfxVolume = v;
  saveAudioPrefs(view);
}

export function toggleBgmMute(): void {
  const view = requireAudioView();
  view.bgmMuted = !view.bgmMuted;
  saveAudioPrefs(view);
  ensureBgm();
  requestRender?.();
}

export function toggleSfxMute(): void {
  const view = requireAudioView();
  view.sfxMuted = !view.sfxMuted;
  saveAudioPrefs(view);
  if (!view.sfxMuted) playSfx("turn");
  requestRender?.();
}

export function playEventAudio(events: GameEvent[]): void {
  const played = new Set<SoundCue>();
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    // CARD_PLAYED / MINION_SUMMONED audio is intentionally NOT played here:
    // the card-play preview drives its own impact SFX so the sound lands
    // together with the smoke and shake when the minion hits the board.
    let cue: SoundCue | undefined;
    if (event.type === "ATTACK") {
      // Mirror LEGACY: heavy hit when the first DAMAGE from this attack is >= 7
      const nextDamage = events.slice(i + 1).find(e => e.type === "DAMAGE");
      const dmg = typeof nextDamage?.payload?.amount === "number" ? nextDamage.payload.amount : 0;
      cue = dmg >= 7 ? "attackHeavy" : "attack";
    } else if (event.type === "DAMAGE") {
      cue = "damage";
    } else if (event.type === "HEAL") {
      cue = "heal";
    } else if (event.type === "DESTROY") {
      cue = "death";
    } else if (event.type === "TURN_STARTED") {
      cue = "turn";
    } else if (event.type === "COMMAND_REJECTED") {
      cue = "reject";
    }
    if (!cue || played.has(cue)) continue;
    played.add(cue);
    playSfx(cue);
  }
}

function saveAudioPrefs(view: AudioViewState): void {
  try {
    localStorage.setItem(bgmVolumeKey, String(view.bgmVolume));
    localStorage.setItem(sfxVolumeKey, String(view.sfxVolume));
    localStorage.setItem(bgmMutedKey, String(view.bgmMuted));
    localStorage.setItem(sfxMutedKey, String(view.sfxMuted));
  } catch {
    // Blocked storage; in-memory prefs still work.
  }
}

function requireAudioView(): AudioViewState {
  if (!audioView) throw new Error("Audio has not been configured.");
  return audioView;
}
