import { defineConfig, type Plugin } from "vite";
import { resolve, dirname, posix } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { writeFileSync, readdirSync } from "node:fs";
// @ts-expect-error — plain-JS sibling module, intentionally untyped here.
import { applyChangeset } from "./balance-apply.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

// ── Balance-editor "Apply to source" endpoint (dev only) ───────────────
// The editor POSTs a minimal changeset (only the values that differ from the
// on-disk baseline) to /__apply-balance; applyChangeset (balance-apply.mjs)
// patches just those spans so untouched entries stay byte-identical. Gated to
// `apply: "serve"` so it never ships in the static build.
function balanceApplyPlugin(): Plugin {
  return {
    name: "twcardgame-balance-apply",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__apply-balance", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("POST only");
          return;
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          res.setHeader("Content-Type", "application/json");
          try {
            const written = applyChangeset(repoRoot, JSON.parse(body));
            res.end(JSON.stringify({ ok: true, written }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
          }
        });
      });
    }
  };
}

// Boot-time asset manifest (see apps/web/src/app/preloader.ts):
// scans public/ at config time and exposes a categorised list of media URLs as a
// virtual module so the client can warm every asset before showing the menu.
// Generated here (not committed) so it can never drift from the files on disk,
// and works identically in `vite dev` (public/ on disk) and the R2-backed deploy
// (same `/images /audio /video` URLs are served by the Pages Functions).
const ASSET_MANIFEST_ID = "virtual:asset-manifest";

type AssetManifest = {
  images: string[];
  audioSfx: string[];
  audioBgm: string[];
  video: string[];
};

function walkPublicFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const childAbs = resolve(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.isFile()) out.push(childRel);
    }
  };
  walk(root, "");
  return out;
}

// When both `<name>.webp` and a raster twin (`<name>.png/.jpg/.jpeg`) live in the
// same folder, the catalog/UI only ever references the .webp — the twins are the
// ~75MB of original uploads. Drop them from the preload set so the loading screen
// warms ~20MB instead of ~95MB of images.
function dropRedundantRasterTwins(files: string[]): string[] {
  const webpKeys = new Set(
    files.filter((f) => f.toLowerCase().endsWith(".webp")).map((f) => f.slice(0, f.lastIndexOf(".")))
  );
  return files.filter((f) => {
    const ext = posix.extname(f).toLowerCase();
    if (ext === ".png" || ext === ".jpg" || ext === ".jpeg") {
      return !webpKeys.has(f.slice(0, f.lastIndexOf(".")));
    }
    return true;
  });
}

function buildAssetManifest(): AssetManifest {
  const publicDir = resolve(__dirname, "public");
  let files: string[];
  try {
    files = walkPublicFiles(publicDir).map((f) => `/${f}`);
  } catch {
    return { images: [], audioSfx: [], audioBgm: [], video: [] };
  }
  const images = dropRedundantRasterTwins(files.filter((f) => f.startsWith("/images/")));
  const standaloneImage = files.filter((f) => /^\/[^/]+\.(webp|png|jpg|jpeg|svg)$/i.test(f));
  return {
    images: [...images, ...standaloneImage].sort(),
    audioSfx: files.filter((f) => f.startsWith("/audio/sfx/")).sort(),
    audioBgm: files.filter((f) => f.startsWith("/audio/bgm/")).sort(),
    video: files.filter((f) => f.startsWith("/video/")).sort()
  };
}

function assetManifestPlugin(): Plugin {
  const resolved = `\0${ASSET_MANIFEST_ID}`;
  return {
    name: "twcardgame-asset-manifest",
    resolveId(id) {
      return id === ASSET_MANIFEST_ID ? resolved : undefined;
    },
    load(id) {
      if (id !== resolved) return undefined;
      return `export const assetManifest = ${JSON.stringify(buildAssetManifest())};\n`;
    }
  };
}

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
  plugins: [cloudflarePagesFiles(), assetManifestPlugin(), balanceApplyPlugin()],
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
    // Cloudflare Pages serves media from R2 via Pages Functions, so the Pages
    // deploy must not include public/. Vercel has no matching R2 function layer,
    // so its build needs public/ copied into dist-public for /images/* to work.
    copyPublicDir: process.env.VERCEL === "1",
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
