import { defineConfig, type Plugin } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Cloudflare Pages control files emitted into the build output (Phase 4):
// - _routes.json scopes Functions to the R2-backed media prefixes ONLY, so every
//   HTML/JS/CSS request is served as a plain static asset (zero function calls).
// - _headers gives Vite's content-hashed bundle long-lived immutable caching.
// They are generated here (rather than committed under public/) because the build
// no longer copies public/ — the media live in R2, not in the Pages deploy.
const ASSET_PREFIXES = ["/images/*", "/audio/*", "/video/*"];

function cloudflarePagesFiles(): Plugin {
  return {
    name: "twcardgame-cloudflare-pages-files",
    apply: "build",
    closeBundle() {
      const outDir = resolve(__dirname, "dist-public");
      writeFileSync(
        resolve(outDir, "_routes.json"),
        JSON.stringify({ version: 1, include: ASSET_PREFIXES, exclude: [] }, null, 2) + "\n"
      );
      writeFileSync(
        resolve(outDir, "_headers"),
        ["/assets/*", "  Cache-Control: public, max-age=31536000, immutable", ""].join("\n")
      );
    }
  };
}

export default defineConfig({
  publicDir: "public",
  plugins: [cloudflarePagesFiles()],
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
    // Media (129MB across images/audio/video) is served from R2 by the Pages
    // Functions, so it must NOT be copied into the static deploy. The dev server
    // still serves public/ from disk, so local play is unaffected.
    copyPublicDir: false,
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
