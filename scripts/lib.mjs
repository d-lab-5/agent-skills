// SPDX-License-Identifier: MIT
// Copyright (C) 2026 D-LAB-5
/**
 * What every script here shares: reading the catalogue, finding a plugin's
 * files wherever its home is, reading a skill's front matter, and hashing a
 * skill so two copies can be compared.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DOMAINS = ["d-lab-5", "digitalhome", "erp-lab-5", "atelier-5", "artdecoris"];

export function catalogue() {
  return JSON.parse(readFileSync(join(ROOT, ".claude-plugin/marketplace.json"), "utf8"));
}

/** The domain of a catalogue entry: its first keyword that names one. */
export const domainOf = (entry) => (entry.keywords || []).find((k) => DOMAINS.includes(k));

/**
 * The folder holding an entry's plugin. A local entry is in this repository;
 * a git-subdir entry is fetched (shallow, sparse) into `cache` unless `fetch`
 * is false, in which case it returns null for it.
 */
export function pluginDir(entry, { fetch = false, cache = join(ROOT, ".cache") } = {}) {
  if (typeof entry.source === "string") return { dir: join(ROOT, entry.source), commit: head(ROOT), remote: false };
  const { url, path, ref } = entry.source;
  if (!fetch) return null;
  const into = join(cache, url.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\//g, "__"));
  if (!existsSync(into)) {
    mkdirSync(cache, { recursive: true });
    const args = ["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--sparse"];
    if (ref) args.push("--branch", ref);
    execFileSync("git", [...args, url, into], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  }
  execFileSync("git", ["-C", into, "sparse-checkout", "add", path], { stdio: "ignore" });
  return { dir: join(into, path), commit: head(into), remote: true };
}

function head(dir) {
  try { return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

/** The skills of a plugin folder: [{name, dir}] for every skills/<name>/SKILL.md. */
export function skillsOf(dir) {
  const s = join(dir, "skills");
  if (!existsSync(s)) return [];
  return readdirSync(s).filter((n) => existsSync(join(s, n, "SKILL.md"))).sort().map((name) => ({ name, dir: join(s, name) }));
}

/**
 * A SKILL.md's front matter: the top-level `key: value` pairs, with `|` and `>`
 * block scalars read as text. Nested maps (metadata:) are kept as raw text.
 */
export function frontMatter(file) {
  const text = readFileSync(file, "utf8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return null;
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let [, key, value] = kv;
    if (/^[|>][+-]?$/.test(value) || value === "") {
      const body = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1] === "")) body.push(lines[++i].trim());
      value = value.startsWith(">") || value === "" ? body.join(" ").replace(/\s+/g, " ").trim() : body.join("\n").trim();
    }
    out[key] = value.replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** Every file under a folder, as paths relative to it, sorted; symlinks included as they are. */
export function walk(dir, base = dir, out = []) {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    const st = lstatSync(p);
    if (st.isDirectory()) walk(p, base, out);
    else out.push(relative(base, p));
  }
  return out;
}

/** A skill's identity: sha256 over its files' paths and bytes, in order. */
export function hashSkill(dir) {
  const h = createHash("sha256");
  for (const f of walk(dir)) {
    const st = lstatSync(join(dir, f));
    h.update(f + "\0");
    h.update(st.isSymbolicLink() ? "symlink" : readFileSync(join(dir, f)));
    h.update("\0");
  }
  return h.digest("hex");
}
