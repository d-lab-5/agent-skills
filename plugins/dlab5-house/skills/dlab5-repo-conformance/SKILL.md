---
name: dlab5-repo-conformance
description: Assess whether a D-LAB-5 repository is what its type says it should be, and migrate it there. Detects the type from the repository (a -lite Python tool from python-tool-template, an -edge with the template-dlab5-edge layer, a -shared docs repository, a -cloud from template-dlab5-cloud), checks what every repository needs (the d-lab-5 plugins in a committed .claude/settings.json, no skill copies or symlinks, stage and main, the template version, GitHub protection) and what that template's own profile requires, then migrates by small pull requests. Use for "is this repo compliant", "align this repo with the template", "migrate this repo", "conformance check", "bring it up to date with its template", "why doesn't this repo load the skills", before resuming work on a repository that has not been touched for a while, or after a template changes.
license: GPL-3.0-or-later
metadata:
  maintainer: "D-LAB-5"
---

# Repository conformance

A repository made from a D-LAB-5 template drifts from it: the template gains a
fix, a rule or a plugin, and the repository never hears of it. This skill
finds the drift and closes it, **one reviewed pull request at a time**.

It is the sibling of `dlab5-security-audit`. That one asks what is exposed.
This one asks whether the repository is built the way its type should be.

## The types

| Type | Made from | Detected by |
|---|---|---|
| `lite` | ERP-LAB-5/python-tool-template (Copier) | `.copier-answers.yml` naming it |
| `edge` | the lite base, then the template-dlab5-edge layer (Copier, two answer files) | `.copier-answers.edge.yml` as well |
| `shared` | template-dlab5-shared (Copier) | `.copier-answers.yml` naming it |
| `cloud` | template-dlab5-cloud, copied and renamed | `.template.json`, or `amplify.yml` with `backend/` and no record |

"lite" is a type, not a name suffix: `metro-map-tool` is a lite tool.

**Each type's rules live in its template**, as `plugin/conformance.json`, and
change in the same pull request as the template. The script fetches them from
the template's `main`. The checks every type shares live in the script.

## Assess, always first

```bash
node <this skill's folder>/scripts/conformance.mjs <repo> --online
node <this skill's folder>/scripts/conformance.mjs <repo> --online --run-checks   # also the profile's commands, e.g. ./test.sh
```

- Read-only. Run it on a fresh clone when the working copy belongs to someone
  else or to another machine.
- `--json` for a machine; the exit status is 1 when anything **must** be fixed.
- `--profile <file>` checks against a profile not yet on the template's
  `main`, e.g. while changing the template.

**Report:** the repository, its type and template version, then the findings
grouped **must / should / note**. For a private repository the report is not
written into the repository. Summarise the musts in chat.

What each level means:
- **must:** sessions here get the wrong skills, a clone does not work, or a
  public repository is unprotected. Fix before other work continues.
- **should:** drift that will bite later: an old template version, a skill
  copy, no `stage`, no CLAUDE.md.
- **note:** recorded once, not re-raised: a private repository on a plan
  without rulesets is an accepted risk with its compensating controls.

## Migrate, only when asked

**Before anything:**
1. **Every machine that works on the repository has committed and pushed.** A
   migration made on top of an old snapshot conflicts with the work that was
   not pushed, and `copier update` refuses a dirty tree. Ask; don't assume.
2. **A fresh clone,** on a branch from `stage` (or from `main` when there is
   no `stage` yet): `conform/YYYY-MM-DD`.

**Then, one commit per kind of change, in this order:**
1. **The plugins:** `--fix settings` writes the missing plugins into
   `.claude/settings.json`, keeping everything else in it, lets it through
   `.gitignore` and keeps `settings.local.json` out. It never commits.
2. **What the profile's musts name,** e.g. an executable bit:
   `git update-index --chmod=+x run.sh`.
3. **The template version,** where the type has Copier:
   `copier update --trust --defaults --vcs-ref <latest tag>`, and for an
   edge's layer `-a .copier-answers.edge.yml`. Tool-owned files stay; read
   every conflict marker before resolving it. Then the tool's own tests.
4. **Skill copies** under `.claude/skills/`: remove them once the plugin that
   holds the skill is enabled. A lite tool's own skill is the exception: it
   ships three ways, and `<cli>-skill --sync` keeps them in step.

**Re-assess with `--run-checks`;** no must may remain. Push the branch and
open a pull request into `stage`, listing what changed and what the
assessment said before and after. A person merges. Then the other machines
pull before they continue.

**A `stage` branch, when missing,** is created from `main` and pushed only
with the user's go-ahead: it changes how everyone integrates.

## Never

- Change anything during an assessment.
- Push, create branches on the remote, or merge without being asked.
- Rewrite a repository's own code to match a template. A repository that
  predates a template layer (an edge with its own cloud and chat code, say) is
  reported as such; moving it onto the layer is its own decision.
- Touch a customer's repository.
