import { Buffer } from "buffer";

if (!("Buffer" in globalThis)) {
  (globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
}
