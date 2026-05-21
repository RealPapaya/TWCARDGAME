import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  publicDir: "../../LEGACY/assets",
  resolve: {
    alias: [
      {
        find: "ws",
        replacement: fileURLToPath(new URL("./src/ws-browser-shim.ts", import.meta.url))
      },
      {
        find: /^buffer$/,
        replacement: fileURLToPath(new URL("../../node_modules/buffer/index.js", import.meta.url))
      }
    ],
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
