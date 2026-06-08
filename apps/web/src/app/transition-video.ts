// Full-screen "book flip" transition ported from LEGACY (btn-mode-ai handler +
// #video-overlay in index.html): entering challenge mode plays PVE_Mode.mp4 in
// full over a black overlay, and only once it ends does the overlay slowly fade
// to reveal the screen behind it. Clicking the overlay skips it.
// The overlay lives on document.body, outside the patched `app` container, so the
// regular render diffing never disturbs the playing video.
const PVE_VIDEO_SRC = "/video/PVE_Mode.mp4";
// How long the slow dissolve takes once the video has finished playing.
const FADE_OUT_MS = 1200;

let activeOverlay: HTMLElement | null = null;

function teardown(overlay: HTMLElement, video: HTMLVideoElement): void {
  if (activeOverlay !== overlay) return;
  activeOverlay = null;
  // The video has played out (or was skipped); hold its last frame and slowly
  // fade the overlay so the screen's objects only appear after the animation.
  video.pause();
  overlay.classList.add("video-fade-out");
  window.setTimeout(() => overlay.remove(), FADE_OUT_MS);
}

export function playPveTransition(): void {
  // If a previous transition is still on screen, drop it immediately.
  activeOverlay?.remove();

  const overlay = document.createElement("div");
  overlay.id = "video-overlay";
  overlay.className = "transition-video-overlay";

  const video = document.createElement("video");
  video.id = "transition-video";
  video.playsInline = true;
  video.src = PVE_VIDEO_SRC;
  overlay.appendChild(video);
  document.body.appendChild(overlay);
  activeOverlay = overlay;

  // Click anywhere on the overlay to skip the intro.
  overlay.addEventListener("click", () => teardown(overlay, video), { once: true });

  // Only reveal the screen behind once the full animation has played out.
  video.addEventListener("ended", () => teardown(overlay, video));
  video.addEventListener("error", () => teardown(overlay, video));

  void video.play().catch(() => {
    // Autoplay blocked or asset missing: don't strand the player behind a black screen.
    teardown(overlay, video);
  });
}
