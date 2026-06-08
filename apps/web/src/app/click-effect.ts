import { playSfx } from "./audio.js";

// Global battlefield click feedback ported from LEGACY/js/ui/click_effect.js:
// clicking empty battlefield space plays a "heavy sandstone" thud and kicks up a
// small puff of dust particles, giving the board a tactile feel. Only fires while
// an actual match is on screen (the `.app-shell.in-match` shell) and never when
// the click lands on an interactive element (cards, minions, buttons, dialogs).
const PARTICLE_LIFETIME_MS = 600;

function isInMatch(): boolean {
  const shell = document.querySelector<HTMLElement>(".app-shell.in-match");
  return Boolean(shell) && getComputedStyle(shell as HTMLElement).display !== "none";
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return Boolean(
    target.closest(
      "button, a, input, .card, .minion, .modal, [role=\"dialog\"], [role=\"menu\"], .dialog-overlay, .confirm-dialog"
    )
  );
}

export function installClickEffect(): void {
  document.addEventListener(
    "click",
    (e) => {
      if (!isInMatch()) return;
      if (isInteractiveTarget(e.target)) return;

      playSfx("click");

      const x = e.clientX;
      const y = e.clientY;
      // 15-19 fine grains, kept tightly clustered to read as a single puff.
      const count = 15 + Math.floor(Math.random() * 5);
      for (let i = 0; i < count; i++) {
        const p = document.createElement("div");
        p.className = "click-dust-particle";
        // Offset slightly below-right of the cursor tip, matching legacy.
        p.style.left = `${x + 10}px`;
        p.style.top = `${y + 10}px`;

        const angle = Math.random() * Math.PI * 2;
        const dist = 10 + Math.random() * 20;
        p.style.setProperty("--tx", `${Math.cos(angle) * dist}px`);
        p.style.setProperty("--ty", `${Math.sin(angle) * dist}px`);

        const size = `${2 + Math.random() * 4}px`;
        p.style.width = size;
        p.style.height = size;

        document.body.appendChild(p);
        window.setTimeout(() => p.remove(), PARTICLE_LIFETIME_MS);
      }
    },
    { capture: true }
  );
}
