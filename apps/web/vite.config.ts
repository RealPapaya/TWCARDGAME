import { defineConfig } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath, URL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));


export default defineConfig({
  publicDir: "public",
  resolve: {
    alias: [
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
    outDir: "dist-public",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        "balance-editor": resolve(__dirname, "balance-editor.html")
      }
    }
  },
  esbuild: {
    useDefineForClassFields: false
  }
});
