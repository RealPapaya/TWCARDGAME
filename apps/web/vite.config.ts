import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "../../LEGACY/assets",
  resolve: {
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
