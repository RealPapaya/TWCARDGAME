const gameFrameWidth = 1600;
const gameFrameHeight = 900;

export function installViewportGuards(): void {
  syncAppScale();
  window.addEventListener("resize", syncAppScale);
  window.visualViewport?.addEventListener("resize", syncAppScale);

  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  document.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    },
    { passive: false }
  );

  document.addEventListener("keydown", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "+" || key === "-" || key === "=" || key === "_" || key === "0") {
      event.preventDefault();
    }
  });
}

function syncAppScale(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;
  const scale = Math.min(window.innerWidth / gameFrameWidth, window.innerHeight / gameFrameHeight);
  app.style.setProperty("--app-scale", String(Math.max(0.1, scale)));
}
