import { Buffer } from "buffer";

const browserGlobal = globalThis as unknown as { Buffer?: typeof Buffer };

if (!browserGlobal.Buffer) {
  browserGlobal.Buffer = Buffer;
}
