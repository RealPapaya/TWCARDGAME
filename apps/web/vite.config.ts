import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "../../LEGACY/assets",
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
