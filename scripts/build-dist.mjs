// SPDX-License-Identifier: MIT
// Copyright (C) 2026 D-LAB-5
/**
 * The catalogue for agents that don't read Claude Code plugins, from the same
 * SKILL.md files. A release runs it and attaches dist/ to the GitHub release.
 *
 *   node scripts/build-dist.mjs [--out dist] [--local-only]
 *
 *   dist/agents/skills/<name>/   the open agent-skills layout (.agents/skills)
 *   dist/claude-ai/<name>.zip    one per skill, to upload to claude.ai
 *   dist/manifest.json           name, plugin, version, sha256, source commit
 *
 * A hosted agent pins one release: it downloads a skill and compares its
 * sha256 with the manifest before loading it. Pointers are fetched unless
 * --local-only.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { catalogue, domainOf, frontMatter, hashSkill, pluginDir, ROOT, skillsOf } from "./lib.mjs";

const args = process.argv.slice(2);
const out = resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : join(ROOT, "dist"));
const localOnly = args.includes("--local-only");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "agents/skills"), { recursive: true });
mkdirSync(join(out, "claude-ai"), { recursive: true });

const manifest = { catalogue: "d-lab-5/agent-skills", built: new Date().toISOString().slice(0, 10), skills: [] };
const names = new Map();
for (const e of catalogue().plugins) {
  const p = pluginDir(e, { fetch: !localOnly });
  if (!p) continue;
  const pj = JSON.parse(readFileSync(join(p.dir, ".claude-plugin/plugin.json"), "utf8"));
  for (const s of skillsOf(p.dir)) {
    if (names.has(s.name)) throw new Error(`${s.name} is in both ${names.get(s.name)} and ${e.name}: one home per skill`);
    names.set(s.name, e.name);
    const fm = frontMatter(join(s.dir, "SKILL.md"));
    cpSync(s.dir, join(out, "agents/skills", s.name), { recursive: true, dereference: false });
    // claude.ai wants the skill's folder at the root of the zip
    execFileSync("zip", ["-qrX", join(out, "claude-ai", `${s.name}.zip`), s.name], { cwd: join(out, "agents/skills") });
    manifest.skills.push({
      name: s.name,
      plugin: e.name,
      domain: domainOf(e),
      version: pj.version,
      license: fm.license || pj.license || null,
      sha256: hashSkill(s.dir),
      source: p.remote ? { repo: e.source.url.replace(/\.git$/, ""), path: `${e.source.path}/skills/${s.name}`, commit: p.commit } : { repo: "https://github.com/d-lab-5/agent-skills", path: `${e.source.replace(/^\.\//, "")}/skills/${s.name}`, commit: p.commit },
    });
  }
}
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`${manifest.skills.length} skills from ${new Set(manifest.skills.map((s) => s.plugin)).size} plugins → ${out}`);
if (!existsSync(join(out, "claude-ai"))) process.exit(1);
