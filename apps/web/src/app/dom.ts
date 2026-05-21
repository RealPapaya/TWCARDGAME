export function cssEscape(value: string): string {
  if (typeof (window as any).CSS?.escape === "function") return (window as any).CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}
