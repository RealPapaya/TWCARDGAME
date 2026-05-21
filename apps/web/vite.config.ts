import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  publicDir: "../../LEGACY/assets",
  resolve: {
    alias: {
      ws: fileURLToPath(new URL("./src/ws-browser-shim.ts", import.meta.url))
    },
    conditions: ["source"]
  },
  server: {
    port: 5173
  },
  build: {
    outDir: "dist-public"
  },
  esbuild: {
    useDefineForClassFields: false
  }
});
