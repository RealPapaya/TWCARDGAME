#!/usr/bin/env node
// Upload the web client's media assets to the R2 bucket that the Pages Functions
// serve from (docs/cloudflare-migration-roadmap.md Phase 4).
//
//   node scripts/upload-assets.mjs               # upload images/ audio/ video/
//   node scripts/upload-assets.mjs --bucket foo  # override bucket name
//   node scripts/upload-assets.mjs --dry-run     # list what would be uploaded
//
// Keys mirror the public/ layout (e.g. public/images/a.webp -> images/a.webp), so
// a request for `/images/a.webp` maps 1:1 to the R2 object. Run once after assets
// change; for very large/bulk syncs `rclone` against the R2 S3 endpoint is faster
// (see apps/web/DEPLOY.md).
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const ASSET_DIRS = ["images", "audio", "video"];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bucketIdx = args.indexOf("--bucket");
const bucket = bucketIdx >= 0 ? args[bucketIdx + 1] : "twcardgame-assets";

const CONTENT_TYPES = {
  webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", svg: "image/svg+xml", ico: "image/x-icon",
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4",
  mp4: "video/mp4", webm: "video/webm"
};

function contentType(file) {
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const files = [];
for (const sub of ASSET_DIRS) {
  const dir = join(PUBLIC_DIR, sub);
  try {
    statSync(dir);
  } catch {
    console.warn(`skip: ${sub}/ not found`);
    continue;
  }
  for (const file of walk(dir)) files.push(file);
}

console.log(`Uploading ${files.length} files to R2 bucket "${bucket}"${dryRun ? " (dry run)" : ""}...`);

let done = 0;
for (const file of files) {
  // R2 keys are forward-slash even on Windows.
  const key = relative(PUBLIC_DIR, file).split(sep).join("/");
  const ct = contentType(file);
  done += 1;
  if (dryRun) {
    console.log(`  ${key}  [${ct}]`);
    continue;
  }
  try {
    execFileSync(
      "npx",
      [
        "wrangler", "r2", "object", "put", `${bucket}/${key}`,
        "--file", file, "--content-type", ct, "--remote"
      ],
      { stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" }
    );
    if (done % 25 === 0 || done === files.length) {
      console.log(`  ${done}/${files.length} uploaded`);
    }
  } catch (err) {
    console.error(`FAILED ${key}: ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("Done.");
