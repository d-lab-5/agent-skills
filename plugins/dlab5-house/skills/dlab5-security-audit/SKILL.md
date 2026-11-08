---
name: dlab5-security-audit
description: Security and quality audit for any D-LAB-5 domain. The core covers repository and secret hygiene, GitHub posture (rulesets, push protection, 2FA) and the automation's own posture (CI, deploy roles, agents, tooling). Modules add the landscape in scope - Amplify/Gatsby web platforms (Cognito, AppSync, DynamoDB, S3, headers, dependencies), edges (MCP surface, Node-RED, systemd), or SAP (BTP, Cloud Connector, NetWeaver). Produces a severity-ranked report kept outside any public repository. Use for "audit", "security review", "check our security", "is this safe to push", "vulnerability scan", "check our BTP posture", "audit the Cloud Connector", "who has SAP_ALL", "audit the edge", "security by design", or to pressure-test a design before it ships.
license: GPL-3.0-or-later
metadata:
  maintainer: "D-LAB-5"
  merged_from: "dhc-security-audit (DigitalHome.Cloud) and erplab5-security-audit (ERP-LAB-5)"
---

# Security and quality audit

One audit for every D-LAB-5 domain. **Every audit runs the core**, because the
same two things go wrong everywhere:
- a secret or identifier reaches a repository;
- the automation that builds, deploys or operates a system has more power
  than anyone meant it to.

**A module adds the landscape in scope.** Load only the one that applies.

| Module | Load for | Adds |
|---|---|---|
| [amplify.md](references/amplify.md), with [checklist.md](references/checklist.md) | a web platform on AWS Amplify: Cognito, AppSync, DynamoDB or S3, Gatsby sites | A1 auth, A2 data, A3 frontend, A4 dependencies, A5 build and deploy, A6 code quality, A7 docs |
| [edge.md](references/edge.md) | an edge: a local box or PC app with an MCP server, Node-RED, systemd | E1 MCP surface, E2 Node-RED, E3 runtime hardening, and how A1–A7 translate |
| [sap.md](references/sap.md) | an SAP landscape: BTP, a Cloud Connector, NetWeaver | S1 BTP, S2 Cloud Connector, S3–S4 NetWeaver, S5 transport, S6 logging; and its own "before you touch anything" |

Run it quarterly, and ad hoc:
- before a repository is made public, or a first push;
- when auth, storage, a deploy role or a network boundary changes;
- after an advisory on a direct dependency;
- mid-design ("would this…?"). Then answer inline against the relevant domain
  instead of writing a report.

## Read-only, always

**Audit and report; don't fix.** Remediation is a separate task the user
authorizes finding by finding.
- **No state-changing calls:**
  - no `amplify push` or deploy;
  - no `POST`/`PUT`/`DELETE` against a management API;
  - no `btp assign`, `cf set-env` or `kubectl apply`;
  - no ABAP in change mode;
  - no `gh api -X PATCH` on a repository's settings.
- **Don't probe credentials.** A wrong guess can lock an administrator
  account. That is an outage, as the SAP module explains.
- **Don't read files that `.gitignore` deliberately excludes.** Confirm they
  are ignored and untracked; ask the user to summarize if the contents matter.
- **Production:** flag for review. Stage remediation as a plan the user runs,
  never as a change against `main`.
- **Read-only is not free.** Polling a production API, or raising a trace
  level, changes the system. Ask first.

## How to run

1. **Confirm scope:** full or targeted, which module, which systems or
   repositories, and **which are production**. Severity depends on it.
2. **Pin what you audit:** `git log --oneline -1` per repository, plus the
   versions and ids of the systems in scope. A finding without a pinned
   version can't be reproduced.
3. **Walk C1, then the module's domains, then C2.** Record findings as you
   go.
4. **Rank** with the rubric.
5. **Write the report** to `docs/audits/YYYY-MM-DD-audit.md`. **If any
   repository in scope is public, keep the report outside it:** a list of
   your posture gaps is not something to publish. List the audit in the
   private audit index too, never in a skill.
6. **Summarize Critical and High in chat,** with counts per severity. Don't
   paste the whole report back.

## Severity rubric

| Severity | Meaning | Examples (more in each module) |
|---|---|---|
| **Critical** | Active exposure or imminent compromise. Act within 24 h. | a key committed to a public repository; a public bucket holding tenant data; an unauthenticated mutation or admin API; a deploy role that can make storage public with nothing reviewing what deploys |
| **High** | Real risk, not exploited. Act within a week. | push protection off on a public repository; production built from a branch anyone with a token can push to; no MFA; a CVE rated 9+; stored shared credentials to a production backend |
| **Medium** | Defensible; fix next cycle. | missing security headers; no 2FA requirement on the organisation; a real id in a tracked example file; weak password policy |
| **Low** | Hygiene, defence in depth. | stale docs; unused permissions; actions pinned by tag, not SHA |
| **Info** | An observation. | version inventory, counts, "checked and clean" |

- **Production weights up.** The same finding on a sandbox is one level lower;
  say so rather than de-ranking silently.
- **When in doubt, pick the higher severity** and let the user de-rank.

## C1. Repository, secrets and GitHub posture

Always run this one. It is fully automatable, and it is where a leak is most
likely and most permanent. Once a secret reaches a public repository it is
compromised even after deletion, so rotate it; don't just delete it.

```bash
for r in <repos>; do
  echo "##### $r"
  # files that must never be tracked
  git -C "$r" ls-files | grep -nEi \
    '\.env($|\.)|\.envrc|amplify_outputs\.json|aws-exports\.js$|\.graphqlconfig\.yml|\.pem$|\.key$|\.p12$|\.jks$|id_rsa|credentials|\.netrc|secrets?\.(json|ya?ml)|\.pypirc|client_secret.*\.json'
  # credentials in the full history
  git -C "$r" log --all -p | grep -aE 'AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|aws_secret_access_key|BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{36,}'
  git -C "$r" log --all -p | grep -aEn \
    "^\+.*(password|passwd|secret|token|api[_-]?key|client_secret)\s*[:=]\s*['\"][^'\"]{6,}" \
    | grep -avE 'password_env|newPassword|oldPassword|REPLACE_ME|EXAMPLE|<[a-z]|\{|\$'
  # identifiers that fingerprint an installation
  git -C "$r" log --all -p | grep -aoE '^\+.*(\b[0-9]{12}\b|arn:aws[a-z-]*:[^ ]*[0-9]{12}|[a-z0-9]{13,14}\.amplifyapp\.com|d[a-z0-9]{12,13}\.cloudfront\.net|[a-z]{2}-[a-z]+-[0-9]_[A-Za-z0-9]{9})' | sort -u | head
  # routable IPs (RFC 1918 filtered out)
  git -C "$r" log --all -p | grep -aoE '^\+.*\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' | grep -aoE '([0-9]{1,3}\.){3}[0-9]{1,3}' \
    | grep -avE '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.|0\.|255\.)' | sort -u
done
```

**Also findings, beyond literal credentials:**
- **Account, pool, tenant and system ids:** not secret, but they name a
  reachable endpoint.
- **Real names from instance data:** people, places, events, vault or album
  names. Examples must use invented names. Sweep against the household's or
  customer's A-Box with a deny list kept outside every repository.
- **Counts that fingerprint an installation** ("47 devices", "125 flows").
- **Anything lifted from a production log.**
- **Example files that are real.** `*.example`, `*.demo` and `*.template` are
  the most-copied files in a repository, so check them first.
- **`GATSBY_*` and other build-time public variables** ship in the bundle.
  Pool ids are public by design; secrets must never be among them.

**GitHub posture:**

```bash
gh repo list <owner> --json name,visibility --limit 100
for r in <repos>; do
  gh api "repos/<owner>/$r" --jq '{visibility, security_and_analysis}'
  gh api "repos/<owner>/$r/rulesets" --jq '.[] | {name, enforcement}'
  gh api "repos/<owner>/$r/rules/branches/main" --jq '[.[].type]'   # effective rules
done
gh api "orgs/<owner>" --jq '{two_factor_requirement_enabled, default_repository_permission}'
```

- **Push protection with secret scanning** is free on public repositories,
  and it is the only control that stops a credential before it lands. Off on
  a public repository is **High**. On a private one it needs a paid plan:
  record the compensating controls as an accepted risk, not an open finding.
- **A branch that deploys production** needs a ruleset: pull request only, no
  force push, no deletion, no bypass actors. Without one, a stolen token
  deploys. Rate it **High** where the deploy role can change storage or IAM
  (ADR-0015 in blueprinting-dlab5-net).
- **Collaborators and app grants:** who can write, and which GitHub Apps
  (Amplify among them) can read or write which repositories.

## C2. The automation's own posture

Audit what builds, deploys and operates the systems. It holds credentials,
and some of it makes changes.

- **CI workflows:**
  - top-level `permissions: contents: read`, with write scopes only on the job
    that needs them;
  - actions pinned by commit SHA;
  - `persist-credentials: false` on checkout;
  - `npm ci --ignore-scripts` where nothing needs install scripts;
  - no secret available to a pull request from a fork.
- **Deploy roles:**
  - the Amplify service role and the CDK execution policy should be narrower
    than `AdministratorAccess`, and explicitly deny public-access and
    bucket-policy changes;
  - one role per app;
  - account-level S3 Block Public Access on.

  These live outside any repository: ask, or check in the console.
- **Production branches:** auto-build only from a branch a ruleset protects.
  PR previews stay off.
- **Credential handling in tools:** from the environment or a secret store,
  never from a file in the repository (`password_env` is the pattern). Never
  in logs, CSVs or raw dumps.
- **Write actions are gated twice:**
  - a mode switch *and* an explicit flag;
  - an allow list of targets;
  - dry-run by default.
- **Blast-radius limits:** rate limits, retries, cooldowns and allow or deny
  lists, enforced before the call.
- **Attribution:** automation acts as a named technical account, visible in
  the target's own audit trail.
- **Least privilege for technical accounts:** read, plus exactly the one
  change right needed.
- **Agents:**
  - the skills and MCP servers an agent loads come from a reviewed source:
    a plugin version, or a pinned release with a SHA-256;
  - a hosted MCP server takes a scoped, revocable key, never a password;
  - diagnostic output is customer data: keep it in `.gitignore`, and scrub it
    before it goes into a ticket.

## The report

```markdown
# <Scope> Security and Quality Audit: YYYY-MM-DD

**Auditor:** <agent and model>, with the `dlab5-security-audit` skill (core + <module>)
**Scope:** full / targeted (<domains>)

| Component | Version, commit or id | Environment | Visibility | Pinned |
|---|---|---|---|---|

## Summary
| Severity | Count |
|---|---|
| Critical | N |
| High | N |
| Medium | N |
| Low | N |
| Info | N |

**Top items:** 1. …

## Findings
### CRITICAL
#### C-1. <title>
- **Domain:** <C1 / A3 / S2 / …>
- **System:** <repo, app or SID> (<prod | test>)
- **Evidence:** <file:line, command output, console setting>
- **Impact:** <what an attacker or an accident does with it>
- **Remediation:** <concrete, ordered steps>
- **Compensating controls:** <what limits it today>
### HIGH / MEDIUM / LOW / INFO

## What was checked and found clean
- [x] …

## Accepted risks
| Item | Why accepted | Compensating control | Review by |
|---|---|---|---|

## Carry-overs from previous audits
| Item | First flagged | Status |
|---|---|---|

## Recommended next audit
YYYY-MM-DD, or sooner if <trigger>.
```

**The accepted-risks table matters as much as the findings.** A plan
limitation, such as no rulesets on a private repository without a paid plan,
is recorded once, with its compensating control and a review date. It is not
re-raised every quarter.

**For a follow-up after fixes,** add a remediation table to the same report:
finding, status, and the commit that fixed it.
