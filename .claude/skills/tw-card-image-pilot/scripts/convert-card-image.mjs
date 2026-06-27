import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [inputArg, outputArg, colorArg = "#e8d453"] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  console.error("Usage: node scripts/convert-card-image.mjs <input-image> <output.webp> [#rrggbb]");
  process.exit(1);
}

const inputPath = resolve(inputArg);
const outputPath = resolve(outputArg);
const targetColor = parseHexColor(colorArg);
const browserPath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const userDataDir = await mkdtemp(join(tmpdir(), "tw-card-webp-"));

let browser;
let browserExited;

function waitForDevTools(child) {
  return new Promise((resolveWs, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for DevTools")), 15000);
    const onData = (chunk) => {
      const text = chunk.toString();
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        child.stderr.off("data", onData);
        resolveWs(match[1]);
      }
    };
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error(`Browser exited with code ${code}`));
    });
  });
}

function send(ws, method, params = {}) {
  const id = send.nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveCall, reject) => {
    const listener = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener("message", listener);
      if (message.error) {
        reject(new Error(JSON.stringify(message.error)));
      } else {
        resolveCall(message.result);
      }
    };
    ws.addEventListener("message", listener);
  });
}
send.nextId = 1;

function parseHexColor(value) {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) {
    console.error(`Invalid background color: ${value}. Expected #rrggbb.`);
    process.exit(1);
  }
  const hex = match[1];
  return {
    hex: `#${hex.toLowerCase()}`,
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

try {
  browser = spawn(browserPath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--disable-background-networking",
    `--user-data-dir=${userDataDir}`,
    "--remote-debugging-port=0",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  browserExited = new Promise((resolveExit) => browser.once("exit", resolveExit));

  const browserWsUrl = await waitForDevTools(browser);
  const targetUrl = browserWsUrl.replace(/^ws:/, "http:").replace(/\/devtools\/browser\/.+$/, "/json/new");
  const target = await fetch(targetUrl, { method: "PUT" }).then((res) => res.json());
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen) => ws.addEventListener("open", resolveOpen, { once: true }));

  const inputBuffer = await readFile(inputPath);
  const lowerInputPath = inputPath.toLowerCase();
  let mime = "image/png";
  if (lowerInputPath.endsWith(".webp")) mime = "image/webp";
  if (lowerInputPath.endsWith(".jpg") || lowerInputPath.endsWith(".jpeg")) mime = "image/jpeg";
  const inputDataUrl = `data:${mime};base64,${inputBuffer.toString("base64")}`;
  const result = await send(ws, "Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `
      (async () => {
        const image = new Image();
        image.src = ${JSON.stringify(inputDataUrl)};
        await image.decode();

        const targetWidth = 1024;
        const targetHeight = 576;
        const sourceRatio = image.width / image.height;
        const targetRatio = targetWidth / targetHeight;
        let sx = 0, sy = 0, sw = image.width, sh = image.height;
        if (sourceRatio > targetRatio) {
          sw = Math.round(image.height * targetRatio);
          sx = Math.round((image.width - sw) / 2);
        } else if (sourceRatio < targetRatio) {
          sh = Math.round(image.width / targetRatio);
          sy = Math.round((image.height - sh) / 2);
        }

        const canvas = new OffscreenCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);

        const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
        const data = imageData.data;
        const visited = new Uint8Array(targetWidth * targetHeight);
        const queue = [];
        const targetColor = ${JSON.stringify(targetColor)};

        const enqueue = (x, y) => {
          if (x < 0 || y < 0 || x >= targetWidth || y >= targetHeight) return;
          const i = y * targetWidth + x;
          if (visited[i]) return;
          visited[i] = 1;
          queue.push(i);
        };

        const pixelAt = (x, y) => {
          const o = (y * targetWidth + x) * 4;
          return { r: data[o], g: data[o + 1], b: data[o + 2] };
        };

        const distance = (a, b) => {
          const dr = a.r - b.r;
          const dg = a.g - b.g;
          const db = a.b - b.b;
          return Math.sqrt(dr * dr + dg * dg + db * db);
        };

        const cornerColors = [
          pixelAt(0, 0),
          pixelAt(targetWidth - 1, 0),
          pixelAt(0, targetHeight - 1),
          pixelAt(targetWidth - 1, targetHeight - 1),
        ];

        const isBackground = (i) => {
          const o = i * 4;
          const color = { r: data[o], g: data[o + 1], b: data[o + 2] };
          return cornerColors.some((corner) => distance(color, corner) <= 72);
        };

        for (let x = 0; x < targetWidth; x++) {
          enqueue(x, 0);
          enqueue(x, targetHeight - 1);
        }
        for (let y = 0; y < targetHeight; y++) {
          enqueue(0, y);
          enqueue(targetWidth - 1, y);
        }

        let backgroundPixels = 0;
        for (let q = 0; q < queue.length; q++) {
          const i = queue[q];
          if (!isBackground(i)) continue;
          const o = i * 4;
          data[o] = targetColor.r;
          data[o + 1] = targetColor.g;
          data[o + 2] = targetColor.b;
          data[o + 3] = 255;
          backgroundPixels++;
          const x = i % targetWidth;
          const y = Math.floor(i / targetWidth);
          enqueue(x + 1, y);
          enqueue(x - 1, y);
          enqueue(x, y + 1);
          enqueue(x, y - 1);
        }
        ctx.putImageData(imageData, 0, 0);

        let chosen = null;
        for (const quality of [0.82, 0.78, 0.74, 0.70, 0.66, 0.62, 0.58, 0.54, 0.50, 0.46, 0.42, 0.38, 0.34, 0.30]) {
          const blob = await canvas.convertToBlob({ type: "image/webp", quality });
          const buffer = new Uint8Array(await blob.arrayBuffer());
          chosen = { quality, size: buffer.byteLength, base64: btoa(String.fromCharCode(...buffer)), backgroundPixels };
          if (buffer.byteLength <= 50 * 1024) break;
        }
        return chosen;
      })()
    `,
  });

  const value = result.result.value;
  await writeFile(outputPath, Buffer.from(value.base64, "base64"));
  console.log(JSON.stringify({
    outputPath,
    backgroundColor: targetColor.hex,
    quality: value.quality,
    size: value.size,
    backgroundPixels: value.backgroundPixels,
  }));
  ws.close();
} finally {
  if (browser && !browser.killed) {
    browser.kill();
    await Promise.race([
      browserExited,
      new Promise((resolveWait) => setTimeout(resolveWait, 2000)),
    ]);
  }
  try {
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  } catch {
    // Edge can briefly hold lock files after headless shutdown; the temp dir is disposable.
  }
}
