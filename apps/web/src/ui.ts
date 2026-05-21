export function classNames(parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

export function fanStyle(index: number, total: number): string {
  if (total <= 1) return "--rot: 0deg; --y: 0px;";
  const center = (total - 1) / 2;
  const distance = index - center;
  const rotation = Math.max(-18, Math.min(18, distance * 5));
  const y = Math.abs(distance) * 4;
  return `--rot: ${rotation}deg; --y: ${y}px;`;
}

export function opponentFanStyle(index: number, total: number): string {
  if (total <= 1) return "--rot: 0deg; --y: 0px;";
  const center = (total - 1) / 2;
  const distance = index - center;
  const rotation = Math.max(-18, Math.min(18, distance * 6));
  const abs = Math.abs(distance);
  const y = abs * abs * 3 + abs * 5;
  return `--rot: ${rotation}deg; --y: ${y}px;`;
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
