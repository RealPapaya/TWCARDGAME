#!/usr/bin/env node
// R2 asset uploader over the S3 API (SigV4), with ZERO dependencies.
//
// Why this exists: `scripts/upload-assets.mjs` shells out to `wrangler` once per
// file, which on Node 24 + Windows crashes on every process exit with a libuv
// assertion (`src\win\async.c` line 76), aborting the upload — a full run can
// churn for an hour and upload nothing. This path talks to R2's S3 endpoint
// directly with Node's built-in crypto + global fetch, so it never spawns
// wrangler: one process, one PUT per file, no retries, no crash.
//
// Credentials come from an R2 "Object Read & Write" API token, read from the
// repo-root `.dev.vars` (git-ignored) or the environment:
//   R2_ACCOUNT_ID           32-hex account id  (or set R2_ENDPOINT directly)
//   R2_ACCESS_KEY_ID
//   R2_SECRET_ACCESS_KEY
//   R2_BUCKET               default: twcardgame-assets
// The .dev.vars may use the dashboard's human labels, e.g.
//   Account ID：xxxx
//   Access Key ID : xxxx
//   Secret Access Key : xxxx
//
// Usage:
//   node scripts/upload-assets-s3.mjs            # only images/cards (fast, common case)
//   node scripts/upload-assets-s3.mjs --all      # images/ audio/ video/ (full sync)
//   node scripts/upload-assets-s3.mjs --dry-run  # list keys, sign/upload nothing
import { createHash, createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, "..");          // apps/web
const REPO_ROOT = join(WEB_DIR, "..", "..");    // repo root
const PUBLIC_DIR = join(WEB_DIR, "public");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const all = args.includes("--all");

// Load creds from repo-root .dev.vars (never pass secrets on the command line).
function loadDevVars() {
  const out = {};
  try {
    const raw = readFileSync(join(REPO_ROOT, ".dev.vars"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([^:：]+)[:：]\s*(.+?)\s*$/);
      if (!m) continue;
      const label = m[1].trim().toLowerCase().replace(/\s+/g, " ");
      const val = m[2].trim();
      if (label === "account id") out.R2_ACCOUNT_ID = val;
      else if (label === "access key id") out.R2_ACCESS_KEY_ID = val;
      else if (label === "secret access key") out.R2_SECRET_ACCESS_KEY = val;
      else if (label === "bucket") out.R2_BUCKET = val;
      else if (/^r2_/.test(m[1].trim().toLowerCase())) out[m[1].trim().toUpperCase()] = val;
    }
  } catch { /* no .dev.vars — fall back to env */ }
  return out;
}
const dv = loadDevVars();

const bucket = process.env.R2_BUCKET || dv.R2_BUCKET || "twcardgame-assets";
const accountId = process.env.R2_ACCOUNT_ID || dv.R2_ACCOUNT_ID || "";
const endpoint =
  process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
const accessKey = process.env.R2_ACCESS_KEY_ID || dv.R2_ACCESS_KEY_ID || "";
const secretKey = process.env.R2_SECRET_ACCESS_KEY || dv.R2_SECRET_ACCESS_KEY || "";
const region = "auto";
const service = "s3";

if (!dryRun && (!endpoint || !accessKey || !secretKey)) {
  console.error(
    "Missing R2 credentials. Provide them via .dev.vars (repo root) or env:\n" +
    "  R2_ACCOUNT_ID (or R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY"
  );
  process.exit(2);
}

const CT = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", svg: "image/svg+xml", ico: "image/x-icon", mp3: "audio/mpeg",
  ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", mp4: "video/mp4", webm: "video/webm" };
const contentType = (f) => CT[f.slice(f.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const roots = all ? ["images", "audio", "video"] : ["images/cards"];
const files = [];
for (const r of roots) {
  const d = join(PUBLIC_DIR, r);
  try { statSync(d); } catch { console.warn(`skip: ${r}/ not found`); continue; }
  for (const f of walk(d)) files.push(f);
}

const hex = (buf) => Buffer.from(buf).toString("hex");
const sha256 = (data) => hex(createHash("sha256").update(data).digest());
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

const endpointHost = new URL(endpoint).host;

// AWS UriEncode for a single path segment: RFC 3986 unreserved stay literal,
// everything else percent-encoded. encodeURIComponent leaves !*'() alone, so
// encode those too. `/` is handled by the caller (segments are joined, not encoded).
function awsUriEncode(segment) {
  return encodeURIComponent(segment).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

// AWS SigV4 for a single S3 PutObject against R2. The wire URL and the canonical
// URI are built from the SAME encoding so filenames with spaces/() still verify.
function sign({ key, body, ct }) {
  const encodedPath = `${bucket}/${key}`.split("/").map(awsUriEncode).join("/");
  const requestUrl = `${endpoint.replace(/\/$/, "")}/${encodedPath}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const canonicalUri = `/${encodedPath}`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders =
    `content-type:${ct}\n` +
    `host:${endpointHost}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`;
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hex(hmac(kSigning, stringToSign));
  return {
    url: requestUrl,
    headers: {
      "content-type": ct,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

console.log(
  `R2 upload: ${files.length} files -> ${bucket}` +
  `${dryRun ? " (dry run)" : ` @ ${endpoint}`}`
);

let ok = 0, fail = 0;
for (const file of files) {
  const key = relative(PUBLIC_DIR, file).split(sep).join("/");
  const ct = contentType(file);
  if (dryRun) { console.log(`  ${key}  [${ct}]`); continue; }
  const body = readFileSync(file);
  const { url, headers } = sign({ key, body, ct });
  try {
    const res = await fetch(url, { method: "PUT", headers, body });
    if (res.ok) {
      ok++;
      if (ok % 20 === 0 || ok + fail === files.length) console.log(`  ${ok + fail}/${files.length} (ok=${ok})`);
    } else {
      fail++;
      console.error(`  FAIL ${key} -> ${res.status} ${res.statusText} ${(await res.text()).slice(0, 200)}`);
    }
  } catch (err) {
    fail++;
    console.error(`  ERROR ${key} -> ${String(err?.message ?? err)}`);
  }
}
console.log(`Done. ok=${ok} fail=${fail}`);
process.exit(fail ? 1 : 0);
