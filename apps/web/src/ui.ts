export function classNames(parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

/**
 * Beyond 5 cards the hand stops widening: cards overlap more so the row stays
 * at the 5-card width. `--squeeze` is the linear factor (5 / total) the CSS
 * applies to each card's per-side margin; <= 5 cards leaves it at 1 (no change).
 */
function squeezeFactor(total: number): number {
  if (total <= 5) return 1;
  return Number((5 / total).toFixed(4));
}

export function fanStyle(index: number, total: number): string {
  const squeeze = squeezeFactor(total);
  if (total <= 1) return `--rot: 0deg; --y: 0px; --squeeze: ${squeeze};`;
  const center = (total - 1) / 2;
  const distance = index - center;
  const rotation = Math.max(-18, Math.min(18, distance * 5));
  const y = Math.abs(distance) * 4;
  return `--rot: ${rotation}deg; --y: ${y}px; --squeeze: ${squeeze};`;
}

export function opponentFanStyle(index: number, total: number): string {
  const squeeze = squeezeFactor(total);
  if (total <= 1) return `--rot: 0deg; --y: 0px; --squeeze: ${squeeze};`;
  const center = (total - 1) / 2;
  const distance = index - center;
  const rotation = Math.max(-18, Math.min(18, distance * 6));
  const abs = Math.abs(distance);
  const y = abs * abs * 3 + abs * 5;
  return `--rot: ${rotation}deg; --y: ${y}px; --squeeze: ${squeeze};`;
}

export function assetUrl(path: string): string {
  if (!path) return "";
  if (/^https?:\/\//.test(path) || path.startsWith("/")) return path;
  return `/${path.replace(/^assets\//, "").replace(/\\/g, "/")}`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function escapeAttr(value: string): string {
  return escapeHtml(value);
}
