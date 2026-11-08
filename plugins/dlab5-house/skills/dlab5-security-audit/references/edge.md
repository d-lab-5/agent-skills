# Edge module: a local box with an MCP server, Node-RED and systemd

The Amplify module (`amplify.md`) is written for the cloud platform. When the
audit runs against an edge (a `digitalhome-edge` checkout, a D-LAB-5 edge made
from template-dlab5-edge, or a live box), the cloud domains still apply where
they translate. Three edge-only domains are added (E1–E3), and some cloud
domains map differently. This file records those additions so the next audit
doesn't have to re-derive them.

## When to load this file

Load this module when any of these are true:

- The current working directory is an edge repository (`digitalhome-edge/`, or one with a `<package>/edge/` folder).
- The audit target is a live edge box (`~dhc-svc/…` or `/opt/dhe/…` layout).
- The `git remote -v` origin URL contains `digitalhome-edge`.

Run C1, C2 and the Amplify domains A2, A4, A5, A6 and A7 where they apply. A1 and
A3 are partly replaced (see the mapping below). Then run the three edge-only
domains below (E1, E2, E3).

## Domain mapping: cloud → edge

| Cloud domain | Edge equivalent | Notes |
|---|---|---|
| C1. Repository and secrets | C1 (unchanged) | Add checks for `digitalhome.edge.config.cache` file mode, `flows_cred.json` protection. |
| A1. Auth & authorization (Cognito + AppSync) | **E1. MCP surface** + **E2. Node-RED posture** | The edge does not run Cognito/AppSync. Auth on the local Python MCP server and on Node-RED replaces those checks. |
| A2. Data layer (DynamoDB + S3) | Adapt: SQLite instead | Check DB file mode, gitignore coverage, WAL journal disposal. No S3 on the edge itself (that's cloud-side). |
| A3. Frontend security | Mostly N/A | Node-RED Dashboard v2 replaces the Gatsby apps; a few checks (see E2). |
| A4. Dependency hygiene | Adapt: `pip` + `npm` global for Node-RED | `yarn audit` becomes `pip-audit` + `npm audit` in the userDir. |
| A5. Build and deploy | Adapt: `install.sh` + systemd + `git pull` | No Amplify Hosting; the checks become "installer safety" + "update mechanism safety". |
| A6. Code quality | Unchanged | Python + bash + JavaScript-in-flows. |
| A7. Documentation | Unchanged | `CLAUDE.md`, `SPEC.md`, `docs/architecture.md`, `docs/adr/`. |

## E1. MCP surface

**What you're looking for**: any unauthenticated / over-permissioned tool exposure on
the Model Context Protocol endpoint.

```bash
# Bind address — is the MCP server LAN-open?
grep -n -E "uvicorn.run|host\s*=|bind" mcp-server/*.py

# Authentication middleware — is there any?
grep -n -E "@app.middleware|Depends\(|verify_token|Bearer|api_key|Authorization" mcp-server/*.py

# Tool signatures that accept arbitrary URL fragments (SSRF-adjacent)
grep -n -B 1 -A 6 "@mcp.tool()" mcp-server/*.py | grep -E "endpoint:|path:|node_id:|url:" | head

# ufw exposure of the MCP port
grep -n "ufw allow.*8000\|ufw allow.*8443" install.sh
```

**Manual checks**:
- Does the MCP endpoint use TLS? (Target per SLAB5 spec: `:8443` streamable HTTP.)
- Are there any MCP tools whose docstring says "pass any …" — those are SSRF/RCE
  surface for authenticated but low-privilege callers.
- Does the MCP catalog auto-generate from the C-BOX yet (SLAB5 target), or are
  tools hand-coded (current)? Hand-coded → each tool is its own review target.

**Severity guidance**:
- Unauthenticated MCP endpoint on a LAN-open port = **Critical**.
- Auth present but tool signatures allow arbitrary paths = **High** (SSRF surface).
- No TLS = **High** if any device-control tool exists; **Medium** for read-only KB tools.

## E2. Node-RED posture

**What you're looking for**: unlocked admin API, unauthenticated HTTP-in flows,
credential-secret mishandling, palette CVEs.

```bash
# Is adminAuth configured?
find / -path "*/.node-red/settings.js" 2>/dev/null | while read f; do
  echo "[$f]"
  grep -nE "adminAuth|httpNodeAuth|httpAdminAuth|credentialSecret|editorTheme" "$f"
done

# Is the credential secret set (must not be the shipped default)?
grep -n "credentialSecret" install.sh docs/install.md

# HTTP-in endpoints — any auth wrappers?
python3 -c "
import json, glob
for f in glob.glob('flows/*/flows.json'):
    with open(f) as fh: flows = json.load(fh)
    ins = [n for n in flows if n.get('type') == 'http in']
    print(f'{f}: {len(ins)} HTTP-in endpoints')
    for n in ins[:10]:
        print(f\"  {n.get('method','?').upper():5s} {n.get('url','?')}\")
"

# flows_cred.json presence + perms (on a live box)
stat -c '%a %n' ~dhc-svc/.node-red/projects/*/flows_cred.json 2>/dev/null

# Node-RED version + palette versions
grep -E '"node-red-contrib|"node-red"|"@flowfuse' ~dhc-svc/.node-red/package.json 2>/dev/null
```

**Manual checks**:
- Node-RED editor: does it prompt for a password, or does it load straight to flows?
  (Straight-to-flows on a LAN-open port = C-1 in the 2026-07-01 audit.)
- Dashboard v2: is it exposed publicly (`:1880/ui`) or gated behind `httpNodeAuth`?
- Flow contents (`function` nodes): scan for `require("fs")`, `require("child_process")`,
  `eval(`, `Function(` — these are legitimate in some flows but each usage is a
  review target.

**Severity guidance**:
- No `adminAuth` on a LAN-open `:1880` = **Critical**.
- No `credentialSecret` (or default secret) = **High** (encrypted-at-rest credentials
  are trivially decryptable with the default).
- HTTP-in endpoints without `httpNodeAuth` and reachable from LAN = **High**.
- Palette major-version behind + known CVE = **Medium/High** depending on severity.

## E3. Systemd and runtime hardening

**What you're looking for**: services running with more privilege / more filesystem
access than they need; installer scripts doing sudo-heavy things without user
confirmation; update mechanisms that trust remote content.

```bash
# Systemd unit hardening
for u in /etc/systemd/system/{nodered,mcp-server,dhe}.service; do
  [ -f "$u" ] || continue
  echo "=== $u ==="
  grep -E "NoNewPrivileges|ProtectSystem|ProtectHome|PrivateTmp|PrivateDevices|RestrictAddressFamilies|CapabilityBoundingSet|SystemCallFilter|ReadWritePaths|ReadOnlyPaths|User=|Group=" "$u" || echo "  (no hardening flags)"
done

# Service user posture
getent passwd dhc-svc 2>/dev/null
ls -la ~dhc-svc 2>/dev/null | head

# Config cache file mode (must be 0600, not 0644)
stat -c '%a %n' ~dhc-svc/digitalhome.edge.config.cache 2>/dev/null
stat -c '%a %n' /opt/dhe/secrets/* 2>/dev/null

# ufw / firewall state
ufw status verbose 2>/dev/null | head -20
ss -ltn 2>/dev/null | head

# install.sh review: run-as-root, network fetches, sudo escalation
grep -n -E "curl\s+.*\|\s*(bash|sh)|wget\s+.*\|\s*(bash|sh)|sudo\s|EUID|require_root" install.sh

# Update mechanism — how does the box pull updates?
grep -n -E "git pull|systemctl restart|apt(-get)?\s+(upgrade|dist-upgrade)|unattended" bin/dhcedge install.sh docs/install.md

# dhcedge update-hosts hostname/ip validation
grep -n -B 2 -A 12 "update_hosts\|cmd_update_hosts" bin/dhcedge
```

**Manual checks**:
- Is the `dhc-svc` shell nologin?
- Does `install.sh` prompt before making destructive changes (writing systemd units,
  opening firewall ports)? Or is it "run as root, no prompt, no dry-run"?
- What runs at deploy time? `git pull` on the repo → does anything auto-execute
  (a hook, a pre-commit that runs on the server)?
- Are there any `sudo` NOPASSWD rules for `dhc-svc`? Check `/etc/sudoers.d/`.

**Severity guidance**:
- Missing `NoNewPrivileges` on a network-exposed service = **Medium**.
- Config cache mode 0644 (readable by other local users) = **High**.
- `sudo dhc-svc ALL=(ALL) NOPASSWD: ALL` = **Critical**.
- ufw disabled entirely on prod = **Critical**.
- Unattended-upgrades disabled on prod = **Medium**.
- Installer that pipes remote content to `sh`/`bash` = **High**.

## Report additions

When writing the audit report, add the three edge domains to the "What was checked but
found clean" list even if empty findings — future readers should see they were run.

The report title becomes `<repo> Security & Quality Audit — YYYY-MM-DD` (drop the
"DHC" prefix — it's not always the DigitalHome.cloud platform being audited).
