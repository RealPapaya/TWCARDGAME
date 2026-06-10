import { Metadata } from "@colyseus/schema";
import { describe, expect, it } from "vitest";
// The client keeps a hand-written mirror of the server's Colyseus schema so it
// can decode state patches. @colyseus/schema encodes positionally (field order +
// child refs), so ANY drift between the two definitions corrupts decoding on the
// client with errors like `"refId" not found`. This test fails loudly the moment
// the two definitions diverge — see apps/web/src/schema.ts header for context.
import { GameStateSchema as ClientGameState } from "./schema.js";
import { GameStateSchema as ServerGameState } from "../../server/src/schema.js";

type AnyCtor = { new (...args: unknown[]): unknown };

/**
 * Builds a purely structural signature of a Colyseus schema class: ordered field
 * names + their (recursively expanded) types. Class identity is intentionally
 * ignored so the client and server copies — which are distinct constructors —
 * compare by shape alone.
 */
function schemaSignature(klass: AnyCtor, seen: Set<unknown>): string {
  if (seen.has(klass)) return "<recursive>";
  seen.add(klass);
  const fields = Metadata.getFields(klass) as Record<string, unknown>;
  const parts = Object.entries(fields).map(([name, type]) => `${name}:${typeSignature(type, seen)}`);
  seen.delete(klass);
  return `{${parts.join(",")}}`;
}

function typeSignature(type: unknown, seen: Set<unknown>): string {
  if (typeof type === "string") return type;
  if (type && typeof type === "object" && "array" in type) {
    return `array<${typeSignature((type as { array: unknown }).array, seen)}>`;
  }
  if (type && typeof type === "object" && "map" in type) {
    return `map<${typeSignature((type as { map: unknown }).map, seen)}>`;
  }
  if (typeof type === "function") return schemaSignature(type as AnyCtor, seen);
  return String(type);
}

describe("Colyseus schema parity (client mirror vs server)", () => {
  it("client GameStateSchema matches the server definition field-for-field", () => {
    const client = schemaSignature(ClientGameState as unknown as AnyCtor, new Set());
    const server = schemaSignature(ServerGameState as unknown as AnyCtor, new Set());
    expect(client).toBe(server);
  });
});
