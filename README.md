# agent-skills

**The catalogue of agent skills for every D-LAB-5 development domain:**

| Domain | `domains` keyword | GitHub owner |
|---|---|---|
| D-LAB-5, the core | `d-lab-5` | d-lab-5 |
| DigitalHome.Cloud | `digitalhome` | DigitalHome-cloud |
| ERP-LAB-5 | `erp-lab-5` | ERP-LAB-5 |
| Atelier-5 | `atelier-5` | Atelier-5 |
| artdecoris labs | `artdecoris` | artdecoris-labs |

**Each skill has exactly one home: the repository that owns its subject.** This
catalogue lists those homes; it doesn't copy them. A skill about the cloud
template lives in the cloud template, and a tool's skill ships with the tool.
Only skills that belong to no single repository live here, in
`plugins/dlab5-house/`.

```
/plugin marketplace add d-lab-5/agent-skills
/plugin install dlab5-house@d-lab-5
```

## The five kinds of skill

| Kind | Home | Examples |
|---|---|---|
| **House:** how D-LAB-5 works anywhere | `plugins/dlab5-house/` here | `dlab5-mcp-server`, `dlab5-cognito-api-keys`, `dlab5-security-audit`, `dlab5-repo-conformance` |
| **Blueprint:** one per template | that template's `plugin/` | cloud template, edge template, shared docs, the cloud-edge blueprint |
| **Domain** | the domain's own catalogue repository | DigitalHome.Cloud's `dhc`; ERP-LAB-5's `erplab5-house`, `sap-cc-operations` |
| **Product or tool:** ships with it | the product's `plugin/` | `pytool-kit`, `di-replication-sync`, `metro-map` |
| **Third party:** pinned, never forked | the consumer's `skills-lock.json` | SAP skills, archify |

**Names carry the domain as a prefix:** `dlab5-`, `dhc-`, `erplab5-`, `atl-`,
`adl-`. A product skill takes its product's name.

## How each agent gets the skills

| Where the agent runs | How |
|---|---|
| **Claude Code on a PC** | `/plugin marketplace add d-lab-5/agent-skills`, then `/plugin install <plugin>@d-lab-5`. Keep `~/.claude/skills` for skills you're still writing. |
| **Claude Code on the web, and collaborators** | The repository declares what it needs in its committed `.claude/settings.json`, as below. A session started anywhere, by anyone, gets the same skills. **Don't copy a skill into a repository.** |
| **claude.ai** | Each release attaches one `<skill>.zip` per skill. Upload it as an organisation skill. |
| **Codex, Cursor and other agents** | Each release attaches `agents-skills.tar.gz` in the open agent-skills layout. Unpack it into `.agents/skills`. |
| **Hosted agents** (Agent SDK, an edge's own chat) | Pin one release. Download at build time and compare each skill's `sha256` with `manifest.json` before loading it. Never load "latest" at run time. |

**A repository's `.claude/settings.json`:**

```json
{
  "extraKnownMarketplaces": {
    "d-lab-5": { "source": { "source": "github", "repo": "d-lab-5/agent-skills" } }
  },
  "enabledPlugins": { "dlab5-house@d-lab-5": true }
}
```

## Working on a skill

```bash
claude --plugin-dir plugins/dlab5-house     # loads the working copy, nothing published
node scripts/check.mjs                      # the gate; CI adds --remote --online --since
./test.sh                                   # proves the gate refuses what it should
node scripts/doctor.mjs                     # how far this machine is from one home per skill
node scripts/build-dist.mjs --out /tmp/d    # what a release attaches
```

**To publish a change:**
1. Bump `version` in the plugin's `.claude-plugin/plugin.json` and in its
   catalogue entry. CI refuses a changed skill without a bump, because
   consumers never see the change otherwise.
2. Open a PR to `main`. Every change reaches `main` through a PR.
3. Tag `vX.Y.Z` to release the zips and the manifest.

Consumers update with `/plugin marketplace update d-lab-5`.

**Adding a pointer** to a plugin that lives in its own repository takes one
entry, whose first keyword names the domain:

```json
{ "name": "my-tool",
  "source": { "source": "git-subdir", "url": "https://github.com/<owner>/<repo>.git", "path": "plugin" },
  "description": "…", "author": { "name": "D-LAB-5" }, "keywords": ["erp-lab-5"] }
```

## What the gate checks

`scripts/check.mjs`:
- **Every plugin:**
  - the catalogue is well formed, and each entry names its domain;
  - every pointer resolves to a `plugin.json` and at least one skill;
  - no symlinks, since a symlink breaks on a Windows clone and in a
    subdirectory checkout.
- **Every skill:**
  - the front matter's `name` is its folder's name;
  - a description of at most 1024 characters, which is what agent-skills and
    claude.ai accept;
  - a licence.
- **This repository's own skills** also get the public sweep: no account ids,
  ARNs, keys, app hostnames, email addresses or local paths, and no link to a
  private repository.
- **Real names:** list them, one per line, in a file outside any repository,
  and point `DLAB5_DENYLIST` at it.

A pointer's skills are swept by their own repository, so here their problems
are warnings that name where to fix them.

## This repository is public

Skills are written while working against real systems, so they attract real
identifiers. **Invent names in examples.** A skill that can't be written
without a real identifier belongs in its private repository, listed here as a
pointer: only people with access to that repository can install it.

Customer repositories are out of scope. They may install from this catalogue,
but their skills stay with them, and nothing comes back here.

## Licence

The scripts are MIT. Each plugin carries its own licence: `dlab5-house` is
GPL-3.0-or-later, the licence of the repository its skills were written in.
