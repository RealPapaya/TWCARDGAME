// Precise source patcher for the balance editor's "套用到原始碼" button.
//
// The editor edits in-memory working copies of the catalog / augments / vote
// events / AI decks / progression constants. Rather than re-serialising whole
// arrays (which reformats every untouched entry), the client sends ONLY the
// values that differ from the on-disk baseline, and this module edits just those
// spans in the source text. Untouched entries stay byte-for-byte identical, so
// "apply with no changes" produces a zero-line diff.
//
// Used by vite.config.ts (dev-server middleware) and exercised by
// balance-apply.test.mjs.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Array-of-object sections: which file + const + id field each one lives in.
export const SECTIONS = {
  cards: { file: "packages/cards/src/catalog.generated.ts", constName: "CARD_CATALOG_GENERATED", idKey: "id" },
  amps: { file: "packages/cards/src/amplificationDb.ts", constName: "AMPLIFICATION_DB", idKey: "id" },
  votes: { file: "packages/cards/src/voteEventDb.ts", constName: "VOTE_EVENT_DB", idKey: "id" },
  aiThemes: { file: "packages/shared/src/index.ts", constName: "AI_THEMES", idKey: "id" }
};
const AI_DECKS = { file: "packages/shared/src/index.ts", constName: "AI_THEME_DECKS" };
const PROGRESSION = { file: "packages/shared/src/progression.ts" };

// ── low-level text scanning ─────────────────────────────────────────
// Advance past whitespace, commas, and // or /* */ comments (these appear
// between hand-written entries, e.g. the tier dividers in amplificationDb.ts).
function skipTrivia(src, i, end) {
  for (;;) {
    while (i < end && (src[i] === "," || /\s/.test(src[i]))) i++;
    if (src[i] === "/" && src[i + 1] === "/") {
      i += 2;
      while (i < end && src[i] !== "\n") i++;
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < end && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    return i;
  }
}

// Match a bracket/brace from its opener to its partner, skipping string bodies.
export function findMatchingBracket(src, openIdx) {
  const open = src[openIdx];
  const close = open === "[" ? "]" : open === "{" ? "}" : ")";
  let depth = 0;
  let inStr = false;
  let quote = "";
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = true;
      quote = ch;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Index of the initializer's opening bracket for `export const <name> ... = <[{>`.
function findInitOpen(src, constName, open) {
  const decl = src.indexOf(`export const ${constName}`);
  if (decl < 0) return -1;
  const eq = src.indexOf("=", decl);
  if (eq < 0) return -1;
  return src.indexOf(open, eq);
}

// Parse the direct members of the object whose `{` is at openIdx. Returns
// [{ key, valueStart, valueEnd }] with spans into `src` (valueEnd exclusive,
// trailing whitespace trimmed). String-safe; does not recurse.
export function parseObjectMembers(src, openIdx) {
  const members = [];
  const end = findMatchingBracket(src, openIdx);
  if (end < 0) return members;
  let i = openIdx + 1;
  while (i < end) {
    i = skipTrivia(src, i, end);
    if (i >= end) break;
    // key — quoted string or bare identifier
    let key;
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      let j = i + 1;
      let k = "";
      while (j < end && src[j] !== q) {
        if (src[j] === "\\") { k += src[j + 1]; j += 2; } else { k += src[j]; j++; }
      }
      key = k;
      i = j + 1;
    } else {
      let j = i;
      while (j < end && /[A-Za-z0-9_$]/.test(src[j])) j++;
      key = src.slice(i, j);
      i = j;
    }
    while (i < end && /\s/.test(src[i])) i++;
    if (src[i] !== ":") break;
    i++;
    while (i < end && /\s/.test(src[i])) i++;
    const valueStart = i;
    // value end — first top-level comma (or the object's close)
    let depth = 0;
    let inStr = false;
    let quote = "";
    let j = i;
    for (; j < end; j++) {
      const ch = src[j];
      if (inStr) {
        if (ch === "\\") j++;
        else if (ch === quote) inStr = false;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { inStr = true; quote = ch; }
      else if (ch === "{" || ch === "[" || ch === "(") depth++;
      else if (ch === "}" || ch === "]" || ch === ")") depth--;
      else if (ch === "," && depth === 0) break;
    }
    let valueEnd = j;
    while (valueEnd > valueStart && /\s/.test(src[valueEnd - 1])) valueEnd--;
    members.push({ key, valueStart, valueEnd });
    i = j;
  }
  return members;
}

// ── entry / value location ──────────────────────────────────────────
// Opening-brace index of the array element whose idKey === id.
function findEntryOpen(src, constName, idKey, id) {
  const arrOpen = findInitOpen(src, constName, "[");
  if (arrOpen < 0) return -1;
  const arrClose = findMatchingBracket(src, arrOpen);
  let i = arrOpen + 1;
  while (i < arrClose) {
    i = skipTrivia(src, i, arrClose);
    if (src[i] !== "{") break;
    const objEnd = findMatchingBracket(src, i);
    const members = parseObjectMembers(src, i);
    const idm = members.find((m) => m.key === idKey);
    if (idm) {
      let val;
      try { val = JSON.parse(src.slice(idm.valueStart, idm.valueEnd)); }
      catch { val = src.slice(idm.valueStart, idm.valueEnd).replace(/^["']|["']$/g, ""); }
      if (val === id) return i;
    }
    i = objEnd + 1;
  }
  return -1;
}

// Multi-line literal for a re-serialised whole entry: pretty JSON nested at the
// array element's indent. Used only for the structural-change fallback.
function serializeEntry(value, indent, eol) {
  const json = JSON.stringify(value, null, 2);
  if (!json.includes("\n")) return json;
  return json
    .split("\n")
    .map((line, idx) => (idx === 0 ? line : indent + line))
    .join(eol);
}

// Compact, single-line literal for a leaf value (`["民進黨"]`, `{ "x": 1 }`),
// matching the inline style the hand-written sources use for small arrays/objects
// so a one-field edit stays a one-line diff.
function serializeLeaf(value) {
  return JSON.stringify(value);
}

// Deck arrays in AI_THEME_DECKS are packed 8 ids per line at 4-space indent.
// Reproduce that so a deck edit reads like the originals instead of one-per-line.
function serializeDeck(ids, eol) {
  const rows = [];
  for (let i = 0; i < ids.length; i += 8) {
    rows.push("    " + ids.slice(i, i + 8).map((id) => JSON.stringify(id)).join(", "));
  }
  return `[${eol}${rows.join("," + eol)}${eol}  ]`;
}

// Replace the scalar (or whole) value at `path` inside the object at openIdx.
// Returns the new full source, or null if the path can't be navigated (caller
// then falls back to replacing the entire entry).
function setValueAtPath(src, openIdx, path, value) {
  let obj = openIdx;
  for (let p = 0; p < path.length - 1; p++) {
    const members = parseObjectMembers(src, obj);
    const m = members.find((x) => x.key === path[p]);
    if (!m || src[m.valueStart] !== "{") return null;
    obj = m.valueStart;
  }
  const members = parseObjectMembers(src, obj);
  const m = members.find((x) => x.key === path[path.length - 1]);
  if (!m) return null;
  return src.slice(0, m.valueStart) + serializeLeaf(value) + src.slice(m.valueEnd);
}

// ── per-file appliers ───────────────────────────────────────────────
function applyArraySection(src, section, changes, eol) {
  let out = src;
  for (const change of changes) {
    const { id, leaves, entry } = change;
    // Try precise leaf patches first (one value per edit, original style kept).
    let patched = leaves && leaves.length ? out : null;
    if (patched != null) {
      for (const leaf of leaves) {
        const open = findEntryOpen(patched, section.constName, section.idKey, id);
        if (open < 0) { patched = null; break; }
        const next = setValueAtPath(patched, open, leaf.path, leaf.value);
        if (next == null) { patched = null; break; }
        patched = next;
      }
    }
    if (patched != null) { out = patched; continue; }
    // Fallback: re-serialise just this one entry (structural change).
    const open = findEntryOpen(out, section.constName, section.idKey, id);
    if (open < 0) throw new Error(`entry "${id}" not found in ${section.constName}`);
    const objEnd = findMatchingBracket(out, open);
    out = out.slice(0, open) + serializeEntry(entry, "  ", eol) + out.slice(objEnd + 1);
  }
  return out;
}

function applyAiDecks(src, changedThemes, eol) {
  let out = src;
  const objOpen = findInitOpen(out, AI_DECKS.constName, "{");
  for (const { key, value } of changedThemes) {
    const members = parseObjectMembers(out, objOpen);
    const m = members.find((x) => x.key === key);
    if (!m || out[m.valueStart] !== "[") throw new Error(`deck "${key}" not found`);
    out = out.slice(0, m.valueStart) + serializeDeck(value, eol) + out.slice(m.valueEnd);
  }
  return out;
}

function applyProgression(src, prog) {
  let out = src;
  for (const [name, val] of Object.entries(prog)) {
    if (val == null) continue;
    out = out.replace(new RegExp(`export const ${name} = \\d+;`), `export const ${name} = ${val};`);
  }
  return out;
}

// ── public entry point ──────────────────────────────────────────────
// changeset = {
//   sections: { cards|amps|votes|aiThemes: [{ id, leaves|null, entry }] },
//   aiDecks: [{ key, value: string[] }],
//   progression: { MAX_LEVEL?, LEVEL_UP_GOLD?, MAX_LEVEL_XP_REQUIREMENT? }
// }
// Only files with actual changes are read and written. Returns written paths.
export function applyChangeset(repoRoot, changeset) {
  const edits = new Map(); // file -> transform(src) => src
  const queue = (file, fn) => {
    const prev = edits.get(file);
    edits.set(file, prev ? (s) => fn(prev(s)) : fn);
  };

  const sections = changeset.sections ?? {};
  for (const [name, section] of Object.entries(SECTIONS)) {
    const changes = sections[name];
    if (changes && changes.length) {
      queue(section.file, (s) => applyArraySection(s, section, changes, eolOf(s)));
    }
  }
  if (changeset.aiDecks && changeset.aiDecks.length) {
    queue(AI_DECKS.file, (s) => applyAiDecks(s, changeset.aiDecks, eolOf(s)));
  }
  if (changeset.progression && Object.keys(changeset.progression).length) {
    queue(PROGRESSION.file, (s) => applyProgression(s, changeset.progression));
  }

  const written = [];
  for (const [file, fn] of edits) {
    const abs = resolve(repoRoot, file);
    const before = readFileSync(abs, "utf8");
    const after = fn(before);
    if (after !== before) {
      writeFileSync(abs, after, "utf8");
      written.push(file);
    }
  }
  return written;
}

function eolOf(src) {
  return src.includes("\r\n") ? "\r\n" : "\n";
}
