// SPDX-License-Identifier: MIT
// Copyright (C) 2026 D-LAB-5
/**
 * How far one machine's skills are from "each skill has one home".
 *
 *   node scripts/doctor.mjs [--json] [<folder> …]
 *
 * Walks ~/.claude/skills, ~/.agents/skills and every repository under the
 * given folders (default: ~/D-LAB-5 ~/digitalhomeCloud ~/ERP-LAB-5
 * ~/pc-configurations), and reports:
 *   - a skill with several different copies (drift);
 *   - a skill reached through a symlink;
 *   - a skill in no git repository, which nobody else can see;
 *   - a copy that differs from the catalogue's own.
 * Copies a tool makes of itself (<pkg>/skill, plugin/skills, .claude/skills in
 * one repository) are one home and count once. Exits 1 when it finds anything.
 * It reads only; it never changes a file.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { catalogue, frontMatter, hashSkill, pluginDir, skillsOf } from "./lib.mjs";

const HOME = homedir();
const args = process.argv.slice(2);
const json = args.includes("--json");
const roots = args.filter((a) => !a.startsWith("--"));
const folders = roots.length ? roots : ["D-LAB-5", "digitalhomeCloud", "ERP-LAB-5", "pc-configurations"].map((d) => join(HOME, d));
const SKIP = new Set(["node_modules", ".git", ".venv", "venv", ".cache", "build", "dist", ".worktrees"]);
const show = (p) => p.replace(HOME, "~");

function find(dir, depth, out) {
  if (depth < 0 || !existsSync(dir)) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  if (entries.some((e) => e.name === "SKILL.md")) out.push(dir);
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name.endsWith(".worktrees")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) find(p, depth - 1, out);
    else if (e.isSymbolicLink()) { try { if (lstatSync(p) && existsSync(join(p, "SKILL.md"))) out.push(p); } catch {} }
  }
}

const found = [];
for (const d of [join(HOME, ".claude/skills"), join(HOME, ".agents/skills")]) find(d, 1, found);
for (const d of folders) find(d, 8, found);

function repoOf(dir) {
  try { return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}
function tracked(repo, file) {
  try { execFileSync("git", ["-C", repo, "ls-files", "--error-unmatch", file], { stdio: "ignore" }); return true; }
  catch { return false; }
}

// A skill installed by the skills CLI is pinned in a skills-lock.json above it:
// managed by that lock, not lost, so it counts as neither unversioned nor a stray link.
function lockedBy(dir, name) {
  for (let d = dirname(dir), i = 0; i < 4 && d !== dirname(d); d = dirname(d), i++) {
    const f = join(d, "skills-lock.json");
    if (existsSync(f)) { try { if (JSON.parse(readFileSync(f, "utf8")).skills?.[name]) return show(f); } catch {} }
  }
  return null;
}

const copies = [];
for (const p of [...new Set(found)]) {
  const link = lstatSync(p).isSymbolicLink();
  const real = realpathSync(p);
  const fm = frontMatter(join(real, "SKILL.md")) || {};
  const name = fm.name || basename(p);
  const repo = repoOf(real);
  copies.push({ name, path: p, link, target: link ? real : null, repo, inRepo: !!repo && tracked(repo, join(real, "SKILL.md")), lock: lockedBy(real, name), hash: hashSkill(real) });
}

// the catalogue's own copies, local ones only: a pointer's home is a repository already walked
const home = new Map();
for (const e of catalogue().plugins) {
  const p = pluginDir(e);
  if (p) for (const s of skillsOf(p.dir)) home.set(s.name, hashSkill(s.dir));
}

const byName = new Map();
for (const c of copies) (byName.get(c.name) || byName.set(c.name, []).get(c.name)).push(c);

const report = { drift: [], symlinks: [], unversioned: [], offCatalogue: [] };
const locked = [];
for (const [name, cs] of [...byName].sort()) {
  const real = cs.filter((c) => !c.link);
  const homes = new Map(); // one entry per repository (or loose folder): a tool's self-copies are one home
  for (const c of real) {
    const key = c.repo || c.path;
    (homes.get(key) || homes.set(key, new Set()).get(key)).add(c.hash);
  }
  const versions = new Set(real.map((c) => c.hash));
  if (versions.size > 1) report.drift.push({ name, versions: versions.size, copies: real.map((c) => `${c.hash.slice(0, 8)} ${show(c.path)}`) });
  for (const c of cs.filter((c) => c.link && !c.lock)) report.symlinks.push({ name, path: show(c.path), target: show(c.target) });
  for (const c of real.filter((c) => !c.inRepo)) (c.lock ? locked : report.unversioned).push({ name, path: show(c.path), lock: c.lock });
  if (home.has(name)) for (const c of real) if (c.hash !== home.get(name) && !c.path.startsWith(join(HOME, "D-LAB-5/agent-skills"))) report.offCatalogue.push({ name, path: show(c.path) });
}

const total = Object.values(report).reduce((n, a) => n + a.length, 0);
if (json) console.log(JSON.stringify({ skills: byName.size, copies: copies.length, ...report, locked }, null, 2));
else {
  console.log(`${copies.length} copies of ${byName.size} skills`);
  const section = (title, rows, fmt) => {
    if (!rows.length) return;
    console.log(`\n${title} (${rows.length})`);
    for (const r of rows.slice(0, 12)) console.log(`  ${fmt(r)}`);
    if (rows.length > 12) console.log(`  … ${rows.length - 12} more (--json lists all)`);
  };
  section("Drift: one skill, several versions", report.drift, (r) => `${r.name}: ${r.versions} versions\n      ${r.copies.join("\n      ")}`);
  section("Symlinks", report.symlinks, (r) => `${r.name}: ${r.path} -> ${r.target}`);
  section("In no repository", report.unversioned, (r) => `${r.name}: ${r.path}`);
  section("Differs from the catalogue", report.offCatalogue, (r) => `${r.name}: ${r.path}`);
  if (locked.length) console.log(`\nPinned by a skills-lock.json, not counted: ${locked.length}`);
  console.log(total ? `\n${total} to fix` : "\n✓ every skill has one home");
}
process.exit(total ? 1 : 0);
