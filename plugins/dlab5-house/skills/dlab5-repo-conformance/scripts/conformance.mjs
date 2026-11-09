#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 D-LAB-5
/**
 * conformance.mjs: is this repository what its type says it should be?
 *
 *   node conformance.mjs <repo> [--online] [--run-checks] [--json]
 *                        [--profile <file>]... [--fix settings]
 *
 * Read-only unless --fix. Exit 1 when anything must be fixed, so CI can use it.
 *
 * The type is detected from the repository: Copier answers name the template
 * (python-tool-template → lite, plus .copier-answers.edge.yml → edge,
 * template-dlab5-shared → shared), a .template.json names template-dlab5-cloud.
 * Each type's rules are that template's plugin/conformance.json, fetched from
 * its main (or given with --profile); the checks every type shares are here.
 *
 *   --online      also ask GitHub: visibility, push protection, rulesets
 *   --run-checks  run the profile's commands (a tool's ./test.sh, say)
 *   --fix settings  write the missing plugins into .claude/settings.json and
 *                 let it through .gitignore; nothing else, and never commits
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const opt = (name) => argv.includes(name);
const values = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));
const VALUED = new Set(["--profile", "--fix"]);
const positional = argv.filter((a, i) => !a.startsWith("--") && !VALUED.has(argv[i - 1]));
if (positional.length !== 1) {
  console.error("usage: conformance.mjs <repo> [--online] [--run-checks] [--json] [--profile <file>]... [--fix settings]");
  process.exit(2);
}
const REPO = resolve(positional[0]);
const FIX = new Set(values("--fix").flatMap((v) => v.split(",")));

const CATALOGUE = { source: { source: "github", repo: "d-lab-5/agent-skills" } };
const HOUSE = "dlab5-house@d-lab-5";
const DOMAIN_PLUGIN = { "ERP-LAB-5": "erplab5-house@d-lab-5", "DigitalHome-cloud": "dhc@d-lab-5" };
const TEMPLATES = {
  lite: "ERP-LAB-5/python-tool-template",
  edge: "d-lab-5/template-dlab5-edge",
  shared: "d-lab-5/template-dlab5-shared",
  cloud: "d-lab-5/template-dlab5-cloud",
};

const findings = [];
const add = (level, id, what, fix = "") => findings.push({ level, id, what, fix });
const at = (p) => join(REPO, p);
const read = (p) => readFileSync(at(p), "utf8");

function git(...a) {
  try { return execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}
const tracked = (p) => git("ls-files", "--error-unmatch", p) !== null;
// the repository's own rules only: a clone on another machine has no global excludes file
const ignored = (p) => spawnSync("git", ["-C", REPO, "-c", "core.excludesFile=", "check-ignore", "-q", "--no-index", p]).status === 0;

/** The top-level scalars of a Copier answers file; enough for what is read here. */
function answers(p) {
  if (!existsSync(at(p))) return null;
  const out = {};
  for (const line of read(p).split("\n")) {
    const m = line.match(/^([A-Za-z_][\w]*):\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return out;
}

function owner() {
  const url = git("remote", "get-url", "origin") || "";
  return (url.match(/github\.com[:/]([^/]+)\//) || [])[1] || null;
}

// ---- what is it? ----
if (!existsSync(at(".git"))) { console.error(`${REPO} is not a git repository`); process.exit(2); }
const base = answers(".copier-answers.yml");
const edgeAnswers = answers(".copier-answers.edge.yml");
const marker = existsSync(at(".template.json")) ? JSON.parse(read(".template.json")) : null;
let type = null;
const layers = [];
if (base?._src_path?.includes("python-tool-template")) { type = "lite"; layers.push({ type: "lite", ans: base }); }
if (edgeAnswers) { type = "edge"; layers.push({ type: "edge", ans: edgeAnswers }); }
if (base?._src_path?.includes("template-dlab5-shared")) { type = "shared"; layers.push({ type: "shared", ans: base }); }
if (marker?.template?.includes("template-dlab5-cloud")) { type = "cloud"; layers.push({ type: "cloud", ans: marker }); }
const isLocal = (src) => src.startsWith("/") || src.startsWith("~") || src.startsWith(".") || /^[A-Za-z]:\\/.test(src);
for (const [f, a] of [[".copier-answers.yml", base], [".copier-answers.edge.yml", edgeAnswers]]) {
  if (a?._src_path && isLocal(a._src_path)) add("must", "template", `${f} records a local template path, so copier update works on one machine only`, "set _src_path to the template's gh:<owner>/<repo>");
}
if (!type) {
  if (existsSync(at("amplify.yml")) && existsSync(at("backend"))) {
    type = "cloud";
    add("should", "type", "an Amplify cloud with no record of the template it follows", "write .template.json naming d-lab-5/template-dlab5-cloud and the commit it was compared against");
  } else {
    add("note", "type", "no template recorded: only the common checks ran");
  }
}
const vars = { ...(base || {}), ...(edgeAnswers || {}) };
const org = vars.github_org || owner();
const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

// ---- each layer's profile, from its template ----
const profiles = [];
const given = values("--profile");
for (const f of given) profiles.push(JSON.parse(readFileSync(resolve(f), "utf8")));
for (const l of layers) {
  if (profiles.some((p) => p.type === l.type)) continue;
  const tpl = TEMPLATES[l.type];
  const r = await fetch(`https://raw.githubusercontent.com/${tpl}/main/plugin/conformance.json`).catch(() => null);
  if (r?.ok) profiles.push(await r.json());
  else add("note", "profile", `no conformance profile published by ${tpl} yet: its own rules were not checked`);
}

// ---- the working tree ----
if (git("status", "--porcelain")) add("note", "dirty", "uncommitted changes", "commit and push them before migrating; copier update refuses a dirty tree");

// ---- .claude/settings.json: the plugins every session here loads ----
const want = new Set([HOUSE]);
for (const p of profiles) for (const x of p.plugins || []) want.add(x);
if (type === "edge") want.add("dlab5-edge-template@d-lab-5");
if (DOMAIN_PLUGIN[org]) want.add(DOMAIN_PLUGIN[org]);
const SETTINGS = ".claude/settings.json";
let settings = null;
if (!existsSync(at(SETTINGS))) {
  add("must", "settings", `${SETTINGS} is missing: sessions here load no catalogue skills`, "--fix settings");
} else {
  try { settings = JSON.parse(read(SETTINGS)); } catch { add("must", "settings", `${SETTINGS} is not JSON`); }
}
const missing = settings ? [...want].filter((p) => !settings.enabledPlugins?.[p]) : [...want];
if (settings) {
  if (settings.extraKnownMarketplaces?.["d-lab-5"]?.source?.repo !== "d-lab-5/agent-skills") {
    add("must", "settings", `${SETTINGS} does not name the d-lab-5 catalogue`, "--fix settings");
  }
  if (missing.length) add("must", "settings", `${SETTINGS} does not enable ${missing.join(", ")}`, "--fix settings");
  for (const p of Object.keys(settings.enabledPlugins || {})) {
    const [name, mkt] = p.split("@");
    if (mkt !== "d-lab-5" && want.has(`${name}@d-lab-5`)) add("note", "settings", `${p} is also enabled from the ${mkt} catalogue; one is enough`);
  }
  if (!tracked(SETTINGS)) {
    add("must", "settings", ignored(SETTINGS) ? `${SETTINGS} is gitignored, so no clone gets it` : `${SETTINGS} is not committed`,
      ignored(SETTINGS) ? "--fix settings (it lets the file through .gitignore)" : "commit it");
  }
}
const LOCAL = ".claude/settings.local.json";
if (tracked(LOCAL)) add("must", "settings", `${LOCAL} is committed: it is one person's, and may hold their permissions`, "git rm --cached it and ignore it");
else if (!ignored(LOCAL)) add("should", "settings", `${LOCAL} is not gitignored`, "--fix settings");

// ---- skills: one home each ----
const own = new Set(profiles.map((p) => p.own_skill && fill(p.own_skill)).filter(Boolean));
if (existsSync(at(".claude/skills"))) {
  for (const name of readdirSync(at(".claude/skills"))) {
    const p = `.claude/skills/${name}`;
    if (own.has(p)) continue;
    if (lstatSync(at(p)).isSymbolicLink()) add("must", "skills", `${p} is a symlink`, "remove it and enable the plugin that holds the skill");
    else add("should", "skills", `${p} is a copy of a skill whose home is elsewhere`, "remove it and enable the plugin that holds the skill");
  }
}
for (const line of (git("ls-files", "-s") || "").split("\n")) {
  if (line.startsWith("120000 ")) add("must", "symlink", `${line.split("\t")[1]} is a symlink: it breaks on a Windows clone`, "replace it with the file, or remove it");
}
// a tool's own skill ships three ways; the copies must agree
for (const p of own) {
  const copies = [`${p}/SKILL.md`, fill("{package_name}/skill/SKILL.md"), fill("plugin/skills/{tool_name}/SKILL.md")].filter((f) => existsSync(at(f)));
  if (new Set(copies.map(read)).size > 1) add("should", "skills", `the tool's own skill differs between ${copies.join(", ")}`, "run <cli>-skill --sync, or python3 -m <package>.core.skill_install --sync");
}

// ---- files every repository has ----
for (const [f, level, why] of [["LICENSE", "should", "the terms anyone may use it under"], ["README.md", "should", "what it is, for a person"], ["CLAUDE.md", "should", "what bites, for an agent"]]) {
  if (!existsSync(at(f))) add(level, "files", `no ${f}: ${why}`);
}

// ---- branches ----
const heads = git("ls-remote", "--heads", "origin");
if (heads === null) add("note", "branches", "no origin, or it could not be reached: branches not checked");
else {
  for (const b of ["main", "stage"]) {
    if (!heads.includes(`refs/heads/${b}\n`) && !heads.endsWith(`refs/heads/${b}`)) {
      add("should", "branches", `no ${b} branch on origin`, b === "stage" ? "create stage from main: work lands on stage, main is promoted by pull request" : "");
    }
  }
}

// ---- the template version ----
for (const l of layers) {
  const src = l.ans._src_path || "";
  if (isLocal(src)) continue; // reported above
  const m = src.match(/^gh:(.+)$/) || src.match(/github\.com[:/](.+?)(\.git)?$/);
  const url = m ? `https://github.com/${m[1]}.git` : null;
  const tags = url ? spawnSync("git", ["ls-remote", "--tags", "--refs", url], { encoding: "utf8" }).stdout : "";
  const versions = (tags || "").split("\n").map((t) => (t.match(/refs\/tags\/(v\d+\.\d+\.\d+)$/) || [])[1]).filter(Boolean);
  const latest = versions.sort((a, b) => cmp(a, b)).at(-1);
  const made = l.ans._commit;
  if (!latest) continue;
  if (!/^v\d+\.\d+\.\d+$/.test(made || "")) add("should", "template", `${l.type}: made from ${made || "an unknown commit"}, not a release`, `copier update to ${latest}`);
  else if (cmp(made, latest) < 0) add("should", "template", `${l.type}: made from ${made}; the template is at ${latest}`, `copier update${l.type === "edge" ? " -a .copier-answers.edge.yml" : ""} --vcs-ref ${latest}`);
}
function cmp(a, b) {
  const pa = a.slice(1).split(".").map(Number), pb = b.slice(1).split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// ---- the profiles' own rules ----
for (const p of profiles) {
  for (const r of p.require || []) {
    const f = fill(r.path);
    if (!existsSync(at(f))) add("must", p.type, `${f} is missing${r.why ? `: ${r.why}` : ""}`);
  }
  for (const r of p.contains || []) {
    const f = fill(r.path);
    if (existsSync(at(f)) && !read(f).includes(r.text)) add("must", p.type, `${f} does not contain "${r.text}"${r.why ? `: ${r.why}` : ""}`);
  }
  for (const r of p.executable || []) {
    const f = fill(r.path);
    const mode = (git("ls-files", "-s", "--", f) || "").split(" ")[0];
    if (mode && mode !== "100755") add("must", p.type, `${f} is committed without its executable bit${r.why ? `: ${r.why}` : ""}`, `git update-index --chmod=+x ${f} (a Windows checkout, or core.fileMode=false, drops it)`);
  }
  if (opt("--run-checks")) {
    for (const c of p.checks || []) {
      const run = spawnSync("bash", ["-c", c.run], { cwd: REPO, encoding: "utf8", timeout: 15 * 60 * 1000, env: { ...process.env, PYTHONPATH: "" } });
      if (run.status !== 0) add("must", p.type, `\`${c.run}\` failed${c.why ? ` (${c.why})` : ""}: ${(run.stderr || run.stdout || "").trim().split("\n").slice(-2).join(" / ")}`);
    }
  }
}

// ---- GitHub ----
if (opt("--online")) {
  const slug = (git("remote", "get-url", "origin") || "").match(/github\.com[:/](.+?)(\.git)?$/)?.[1];
  const gh = (path) => { try { return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); } catch { return null; } };
  const info = slug && gh(`repos/${slug}`);
  if (!info) add("note", "github", "GitHub could not be asked (no gh, no access, or no GitHub origin)");
  else if (info.visibility === "public") {
    if (info.security_and_analysis?.secret_scanning_push_protection?.status !== "enabled") add("must", "github", "public, and push protection is off: nothing stops a key on its way in");
    const rules = (gh(`repos/${slug}/rules/branches/main`) || []).map((r) => r.type);
    for (const r of ["pull_request", "non_fast_forward", "deletion"]) if (!rules.includes(r)) add("must", "github", `main has no ${r} rule (ADR-0015)`);
  } else {
    add("note", "github", "private on a plan without rulesets or push protection", "record it once as an accepted risk, with what limits it: .gitignore coverage, the secret sweep, who can push");
  }
}

// ---- --fix settings ----
const fixed = [];
if (FIX.has("settings")) {
  const s = settings || {};
  s.extraKnownMarketplaces = { ...(s.extraKnownMarketplaces || {}), "d-lab-5": s.extraKnownMarketplaces?.["d-lab-5"] || CATALOGUE };
  s.enabledPlugins = { ...(s.enabledPlugins || {}) };
  for (const p of want) s.enabledPlugins[p] = true;
  mkdirSync(at(".claude"), { recursive: true });
  writeFileSync(at(SETTINGS), JSON.stringify(s, null, 2) + "\n");
  fixed.push(`${SETTINGS}: the d-lab-5 catalogue, ${[...want].join(", ")}`);
  if (ignored(SETTINGS) || !ignored(LOCAL)) {
    let gi = existsSync(at(".gitignore")) ? read(".gitignore") : "";
    gi = gi.replace(/^\/?\.claude\/?$/m, ".claude/*\n!.claude/settings.json");
    if (!/^!\.claude\/settings\.json$/m.test(gi) && ignored(SETTINGS)) gi += "\n!.claude/settings.json\n";
    if (!/settings\.local\.json/.test(gi) && !/^\.claude\/\*$/m.test(gi)) gi += (gi.endsWith("\n") ? "" : "\n") + ".claude/settings.local.json\n";
    writeFileSync(at(".gitignore"), gi);
    fixed.push(".gitignore: .claude/settings.json through, settings.local.json out");
  }
}

// ---- report ----
// what --fix settings just wrote is no longer open
if (fixed.length) for (const f of findings) if (f.fix.startsWith("--fix settings")) f.level = "fixed";
const order = { must: 0, should: 1, note: 2, fixed: 3 };
findings.sort((a, b) => order[a.level] - order[b.level]);
const slugName = (git("remote", "get-url", "origin") || "").match(/\/([^/]+?)(\.git)?$/)?.[1];
const report = { repo: slugName || REPO.split("/").pop(), type, owner: org, layers: layers.map((l) => `${l.type}@${l.ans._commit || "?"}`), plugins: [...want], findings, fixed };
if (opt("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`${report.repo}: ${type || "unknown type"}${layers.length ? ` (${report.layers.join(" + ")})` : ""}, owner ${org || "?"}`);
  for (const level of ["must", "should", "note", "fixed"]) {
    const these = findings.filter((f) => f.level === level);
    if (!these.length) continue;
    console.log(`\n${level.toUpperCase()} (${these.length})`);
    for (const f of these) console.log(`  [${f.id}] ${f.what}${f.fix ? `\n      → ${f.fix}` : ""}`);
  }
  if (fixed.length) console.log(`\nWROTE (not committed)\n${fixed.map((f) => `  ${f}`).join("\n")}`);
  if (!findings.length) console.log("\nconforms");
}
process.exit(findings.some((f) => f.level === "must") ? 1 : 0);
