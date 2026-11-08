// SPDX-License-Identifier: MIT
// Copyright (C) 2026 D-LAB-5
/**
 * The catalogue's gate. CI runs it on every pull request.
 *
 *   node scripts/check.mjs [--remote] [--online] [--since <git ref>]
 *
 * Always: the catalogue is well formed, every entry names a domain, and each
 * local plugin's skills pass the skill rules and the public sweep.
 *   --remote  also fetch every pointer and check that its plugin exists, with
 *             the same rules applied to its skills.
 *   --online  also check that every github.com/<owner>/<repo> link in a skill
 *             is public: a link that 404s is to a private or missing repo.
 *   --since   a local plugin whose files changed since <ref> must have a new
 *             version, or consumers never see the change.
 *
 * Extra words to refuse (real names, say) can be listed one per line in the
 * file named by $DLAB5_DENYLIST. That list stays outside this repository.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { catalogue, domainOf, DOMAINS, frontMatter, pluginDir, ROOT, skillsOf, walk } from "./lib.mjs";

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const since = args.includes("--since") ? args[args.indexOf("--since") + 1] : null;

const errors = [];
const warnings = [];
const failHere = (where, what) => errors.push(`${where}: ${what}`);
const fail = failHere;

const RULES = [
  [/\b\d{12}\b/, "a 12-digit number (an AWS account id?)"],
  [/arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:\d{12}:/, "an ARN with an account id"],
  [/AKIA[0-9A-Z]{16}|(sk|pk|rk)_(live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{36,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a key or token"],
  [/\b[a-z0-9]{13,14}\.amplifyapp\.com|\bd[a-z0-9]{12,13}\.cloudfront\.net|\.execute-api\.|\.lambda-url\./, "an app, distribution or function hostname"],
  [/[A-Za-z0-9._%+-]+@(?!anthropic\.com\b|users\.noreply\.github\.com\b|example\.(com|org)\b)[A-Za-z0-9-]+\.[a-z]{2,}\b/, "an email address"],
  [/(?:^|[\s`"'(=:~])\/home\/[a-z]|C:\\Users\\/, "a local path"],
  [/\bdh-[a-z0-9]{8,}\b/, "a DI tenant id"],
];
if (process.env.DLAB5_DENYLIST && existsSync(process.env.DLAB5_DENYLIST)) {
  for (const w of readFileSync(process.env.DLAB5_DENYLIST, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)) {
    RULES.push([new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), "a word on the deny list"]);
  }
}
const TEXT = /\.(md|txt|json|ya?ml|mjs|js|ts|py|sh|toml|html|css|ttl)$/i;
const links = new Set();

// ---- the catalogue ----
const cat = catalogue();
if (cat.name !== "d-lab-5") fail("marketplace.json", `name is "${cat.name}", expected "d-lab-5"`);
const seen = new Set();
for (const e of cat.plugins) {
  const where = `plugin ${e.name}`;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(e.name || "")) fail(where, "name is lowercase letters, digits and -");
  if (seen.has(e.name)) fail(where, "listed twice");
  seen.add(e.name);
  if (!domainOf(e)) fail(where, `the first keyword must name its domain, one of ${DOMAINS.join(", ")}`);
  if (!e.description) fail(where, "no description");
  if (typeof e.source !== "string" && !(e.source?.source === "git-subdir" && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(e.source.url) && e.source.path)) {
    fail(where, "a pointer is {source: git-subdir, url: https://github.com/<owner>/<repo>.git, path}");
  }
}

// ---- each plugin ----
for (const e of cat.plugins) {
  let p;
  try { p = pluginDir(e, { fetch: flag("--remote") }); }
  catch (err) { fail(`plugin ${e.name}`, `cannot fetch ${e.source.url} (${String(err.stderr || err.message).trim().split("\n")[0]})`); continue; }
  if (!p) continue;
  const where = `plugin ${e.name}`;
  if (!existsSync(p.dir)) { fail(where, `no folder at ${p.remote ? e.source.path : e.source}`); continue; }
  const manifest = join(p.dir, ".claude-plugin/plugin.json");
  let pj = null;
  if (!existsSync(manifest)) fail(where, "no .claude-plugin/plugin.json");
  else {
    pj = JSON.parse(readFileSync(manifest, "utf8"));
    if (pj.name !== e.name) fail(where, `plugin.json names "${pj.name}"`);
    if (!/^\d+\.\d+\.\d+$/.test(pj.version || "")) fail(where, "plugin.json has no semver version");
    if (!p.remote && e.version && e.version !== pj.version) fail(where, `the catalogue says ${e.version}, plugin.json says ${pj.version}`);
  }
  const skills = skillsOf(p.dir);
  if (!skills.length) fail(where, "has no skills/<name>/SKILL.md");
  for (const f of walk(p.dir)) {
    if (lstatSync(join(p.dir, f)).isSymbolicLink()) fail(where, `${f} is a symlink; a symlink breaks on a Windows clone and in a subdirectory checkout`);
  }
  for (const s of skills) checkSkill(e, pj, s, p);
  if (!p.remote && since) checkBump(e, pj, p.dir);
}

function checkSkill(e, pj, s, p) {
  const where = `${e.name}/${s.name}`;
  // A pointer's skill is fixed in its own home, so its problems warn here
  // rather than block this catalogue on another repository's commit.
  const fail = p.remote ? (w, what) => warnings.push(`${w}: ${what} (fix it in ${e.source.url.replace(/\.git$/, "")})`) : failHere;
  const fm = frontMatter(join(s.dir, "SKILL.md"));
  if (!fm) return fail(where, "SKILL.md has no front matter");
  if (fm.name !== s.name) fail(where, `front matter name is "${fm.name}", the folder is "${s.name}"`);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(s.name)) fail(where, "a skill name is at most 64 lowercase letters, digits and -");
  if (!fm.description) fail(where, "no description");
  else if (fm.description.length > 1024) fail(where, `description is ${fm.description.length} characters; agent-skills and claude.ai take 1024 at most`);
  if (!fm.license && !pj?.license) fail(where, "no licence: set license in the front matter or in plugin.json");
  if (p.remote) return; // a pointer's own repository runs its own sweep; the catalogue checks its shape
  for (const f of walk(s.dir)) {
    if (!TEXT.test(f)) continue;
    const text = readFileSync(join(s.dir, f), "utf8");
    text.split("\n").forEach((line, i) => {
      for (const [re, what] of RULES) if (re.test(line)) fail(`${relative(ROOT, join(s.dir, f))}:${i + 1}`, what);
      for (const m of line.matchAll(/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?=[/)\s"'#>]|$)/g)) links.add(m[1]);
    });
  }
}

function checkBump(e, pj, dir) {
  const rel = relative(ROOT, dir);
  let changed;
  try { changed = execFileSync("git", ["-C", ROOT, "diff", "--name-only", `${since}...HEAD`, "--", rel], { encoding: "utf8" }).trim(); }
  catch { return warnings.push(`--since ${since}: not a ref here; the version check was skipped`); }
  if (!changed) return;
  let before = null;
  try { before = JSON.parse(execFileSync("git", ["-C", ROOT, "show", `${since}:${rel}/.claude-plugin/plugin.json`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })).version; }
  catch { return; } // a new plugin
  if (before === pj?.version) fail(`plugin ${e.name}`, `files changed since ${since} but the version is still ${before}: bump it in plugin.json and the catalogue`);
}

// ---- links ----
if (flag("--online")) {
  for (const repo of links) {
    const r = await fetch(`https://github.com/${repo}`, { method: "HEAD", redirect: "follow" }).catch(() => null);
    if (!r) warnings.push(`could not reach github.com to check ${repo}`);
    else if (r.status === 404) fail("links", `github.com/${repo} is private or missing; name a private repository, never link it`);
  }
}

for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  console.error(`\n${errors.length} problem${errors.length > 1 ? "s" : ""}`);
  process.exit(1);
}
console.log(`✓ ${cat.plugins.length} plugins${flag("--remote") ? ", every pointer fetched" : ""}${flag("--online") ? `, ${links.size} links public` : ""}`);
