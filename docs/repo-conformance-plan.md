# Plan: repository conformance

A repository made from a D-LAB-5 template drifts from it: the template gains
a fix, a rule or a plugin, and the repository never hears of it. This plan
adds a way to **assess** a repository against its type and **migrate** it
there, the way `dlab5-security-audit` assesses exposure.

## Repository types

| Type | Made from | Updates from its template |
|---|---|---|
| `-cloud` | template-dlab5-cloud, copied and renamed (`scripts/rename.mjs`) | no record of the template version; nothing |
| `-edge` | ERP-LAB-5/python-tool-template, then the template-dlab5-edge layer (Copier, two answer files) | `copier update`, and `copier update -a .copier-answers.edge.yml` |
| `-shared` | template-dlab5-shared (Copier) | `copier update --trust` |
| `-lite` | ERP-LAB-5/python-tool-template alone (Copier) | `copier update` |

So an edge is a lite tool with the edge layer on top. "lite" is a **type**,
read from the Copier answers, not a required name suffix: existing tools
(`metro-map-tool`, `sap-di-tools`) keep their names.

## Step 6 first: every type arrives with its plugins declared

A new repository's committed `.claude/settings.json` names the `d-lab-5`
marketplace and the plugins its work needs (ADR-0003 in agent-skills-shared).

| Type | Plugins | Who writes them |
|---|---|---|
| `-cloud` | `dlab5-house`, `dlab5-cloud-template` | the template's own `.claude/settings.json` (done) |
| `-lite` | `dlab5-house`, `pytool-kit`, the domain's plugin by `github_org` | python-tool-template's `.claude/settings.json`, now always written and **owned by the tool** after the first copy, because each tool adds its own |
| `-edge` | the lite set, plus `dlab5-edge-template` | `edge-wire.py` adds it to the base's file, once |
| `-shared` | `dlab5-house`, `dlab5-shared-docs` | template-dlab5-shared's `template/.claude/settings.json`, owned by the template |

The domain's plugin by GitHub owner: `ERP-LAB-5` → `erplab5-house`,
`DigitalHome-cloud` → `dhc`; none for others until those domains have one.

Then existing repositories, each its own small commit, listed in the
assessment below rather than guessed at here.

## The engine: `dlab5-repo-conformance`

**A script with a skill on top.** The skill, in `dlab5-house`, says when and
how to run it and how to migrate; the script (`scripts/conformance.mjs` in
the skill) decides, so the answer is the same every time and can run in CI.

**Rules live with each template** (one home): `plugin/conformance.json` in
template-dlab5-cloud, template-dlab5-edge, template-dlab5-shared and
python-tool-template. Each lists:

- `detect`: how to recognise the type (an answers file and its `_src_path`,
  or a marker file);
- `require`: files that must exist;
- `owned`: files the template owns and a repository must not edit;
- `plugins`: what `.claude/settings.json` must enable;
- `refuse`: patterns that must not appear (a local `_src_path`, a skill copy
  in `.claude/skills`, a symlink);
- `checks`: commands that must pass (`npm run check`, `./test.sh`, a build
  without `amplify_outputs.json`).

The engine fetches the profile for the repository's type from the template's
`main`, and runs the **common core** for every type:

- `.claude/settings.json` committed, enabling the type's plugins and the
  domain's; `.gitignore` lets it through and keeps `settings.local.json` out;
- no skill copies or symlinks under `.claude/skills/` (a tool's own skill is
  the exception python-tool-template documents: it ships three ways and its
  release keeps them in step);
- `stage` and `main`; on a public repository, push protection and the
  ADR-0015 rulesets; a production branch auto-builds only when protected;
- LICENSE, NOTICE, CLAUDE.md;
- the template version it was made from: Copier's `_commit`, or for `-cloud`
  a new `.template.json` written by `rename.mjs`.

It reuses `dlab5-security-audit`'s C1 sweep instead of repeating it.

**Modes.** `assess` (default, read-only): a report per repository, ranked
like the audit (must fix / should fix / note). `plan`: the changes, as a
list. `migrate`: one branch and one PR per repository, each change approved;
`copier update` where the type has it, and for `-cloud` a three-way merge of
the template's files from the recorded version to now.

## Order

1. **Step 6** in the three template repositories and python-tool-template.
2. The engine with the common core and the `-shared` profile, the easiest to
   verify: two real repositories to test against.
3. `-lite`, then `-edge` (its two answer files), then `-cloud` (and
   `rename.mjs` writing `.template.json`).
4. `assess` across every D-LAB-5 repository on this PC; the report goes to
   the private audit folder, and the migrations follow as PRs.
5. CI: each template's own CI runs `assess` on a repository it made, so a
   template change that breaks its own profile fails there.

**Out of scope:** customer repositories. Moving `-cloud` to Copier would give
it real updates; that is its own decision and its own ADR.

## Open questions

- Repositories enabling `erplab5-house@erp-lab-5` (the ERP-LAB-5 marketplace)
  rather than `@d-lab-5`: both work, the d-lab-5 catalogue points to the same
  plugin. Harmonise during migration, or leave the domain its own catalogue.
