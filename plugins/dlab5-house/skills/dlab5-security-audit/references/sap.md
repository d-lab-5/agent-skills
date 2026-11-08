# SAP module: BTP, the Cloud Connector, NetWeaver

Load this for an SAP landscape: BTP subaccounts, a Cloud Connector, NetWeaver
on-premise. It adds domains S1–S6 between the core's C1 (repository and
secrets) and C2 (the automation's own posture). Written for ERP-LAB-5;
verified against a real Cloud Connector 2.19.1.

## Before you touch anything (SAP)

Four ways this audit can itself cause an incident. All four are real.

1. **Repeated failed authentication locks the Cloud Connector Administrator
   account.** Recovery is to stop the JVM and restore `config/users.xml` from the
   archive — an outage. Never probe SCC credentials. Get them, or skip the API
   checks and read the config files instead.
2. **The SCC admin API is served by the JVM that carries your tunnel traffic.**
   Polling it during business hours competes with production RFC calls. Read-only
   is not the same as free.
3. **Raising the trace level on a production system** (SCC, or `ST01`/`RSAU` on
   NetWeaver) changes system behaviour and fills disks. If you need it, ask, agree
   a window, and put it back.
4. **`RSUSR003` and friends are reports, not changes — but `SU01`, `PFCG`, `SM59`
   and `RZ10` are one keystroke from being changes.** Use display mode. If you
   only have a dialog user with change authorization, say so in the report rather
   than "verifying" by modifying.

Read-only means: `GET` only against SCC and BTP APIs; display-mode transactions;
`SE16` browse, never `SE16N` in change mode; no `btp assign`, no `cf set-env`, no
`kubectl apply`. **Audit and report. Do not fix.** Remediation is a separate task
the user authorizes finding by finding.

### S1. BTP subaccount posture

```bash
btp --info                                        # which global account / API endpoint
btp list accounts/subaccount
btp list security/role-collection --subaccount <id>
btp list security/user --subaccount <id>
btp list services/instance --subaccount <id>
btp list services/binding --subaccount <id>
```

**Destinations are where the credentials live.** Export and review every one:

- `ProxyType=OnPremise` means it goes through the Cloud Connector — cross-check
  the resource actually exists in the SCC access control (S2). A destination
  pointing at a resource that is *not* in the ACL fails closed; the reverse — an
  ACL entry with no destination — is an unused hole.
- `Authentication=BasicAuthentication` with `User`/`Password` properties stores a
  **shared technical user credential in the subaccount**. Every cloud user then
  acts as that one backend user: no attribution in the backend audit log, and the
  credential is readable by anyone with destination-editor rights. Prefer
  `PrincipalPropagation` (on-prem) or `OAuth2SAMLBearerAssertion`. Stored basic
  auth to production is **High**.
- `TrustAll=true` / `HTML5.DynamicDestination=true` — the first disables TLS
  verification, the second exposes the destination to browser-side apps.

Also check:

- **Service keys and bindings** are long-lived client secrets. Count them, find
  the oldest, and flag any that outlive the person who created them. `cf env <app>`
  and Kyma secrets both surface bound credentials in plaintext to anyone with
  space/namespace access — so space and namespace membership *is* credential access.
- **Trust configuration**: is the subaccount still on the default SAP ID Service,
  or on a corporate IdP/IAS? Default IdP for anything production-adjacent is a
  finding. Check whether "Available for user logon" is enabled on more IdPs than
  intended.
- **Role collections**: who holds `Subaccount Administrator`, `Cloud Connector
  Administrator`, and `Destination Administrator`. These three together are the
  keys to the on-prem tunnel.
- **Audit log retention.** The BTP audit log service has a short default retention
  (30 days on many plans). If nothing ships it to a SIEM, the effective
  investigation window is that number — record it.

For Kyma workloads (the DI auto-healer runs as one):

```bash
kubectl get secrets -A -o custom-columns=NS:.metadata.namespace,NAME:.metadata.name,TYPE:.type
kubectl auth can-i --list --namespace <ns>
kubectl get cronjob,deploy -A -o yaml | grep -nE 'image:|imagePullPolicy|runAsNonRoot|privileged|allowPrivilegeEscalation'
```

Flag: secrets created with `kubectl create secret --from-literal` in shell history,
containers running as root, `imagePullPolicy: Always` against a mutable `:latest`
tag, and any pod whose service account can read secrets cluster-wide.

### S2. Cloud Connector — the boundary

The highest-value domain. Everything here was verified against a real **2.19.1**
instance; see the `sap-cc-operations` skill for the API mechanics and the two
first-run 403 states.

```bash
# Read-only. Note the asymmetry: monitoring is NOT under /api/v1.
curl -sk -u "$SCC_USER:$SCC_PW" https://<host>:8443/api/v1/connector/version
curl -sk -u "$SCC_USER:$SCC_PW" https://<host>:8443/api/v1/configuration/subaccounts
curl -sk -u "$SCC_USER:$SCC_PW" https://<host>:8443/api/monitoring/subaccounts
```

Access control per subaccount is exposed under
`/api/v1/configuration/subaccounts/{subaccount}/systemMappings` and its
`.../resources` sub-path. **Probe rather than assume** — these are documented but
version-dependent, and the tooling's `--probe` mode reports what actually answered.
If the API is unavailable, read the configuration from the host instead; every
setting below is visible in `<scc-root>/config/`.

What to look for, in descending order of consequence:

| Check | Why it bites |
|---|---|
| **Resources with a `/` prefix and "path and all sub-paths"** | Exposes every service on that host. The single most common Critical. Each resource should be the narrowest path that works. |
| **`Access Policy` on each resource** | HTTP resources default to allowing sub-paths. RFC resources should name the function module or group, not `*`. |
| **Principal propagation vs stored credentials** | Without it, every cloud caller is one technical backend user — no attribution, and backend authorization checks are meaningless. |
| **Which subaccounts are connected** | An old dev subaccount still tunnelled into production is a live path nobody is watching. |
| **Admin UI (8443) network exposure** | Should be reachable from an admin network only. Internet-reachable is Critical. |
| **Administrator password changed from `manage`** | The shipped default. SAP publishes it. |
| **HA role set** | `undefined` means first-run state; it also makes half the config API return 403. |
| **The OS user running the JVM** | Should not be root. Check the process owner and the ownership of `config/`. |
| **`config/users.xml` permissions** | Holds the admin credential store. Must not be world-readable. |
| **Audit log level** | Should be at least "Security events". Off is High — this is the only record of who changed the ACL. |
| **Java patch level and SCC version** | An out-of-support SCC on an out-of-support JDK is the boundary component. |
| **Certificates in the UI's own keystore** | Expiry dates; a self-signed admin cert that everyone clicks through trains people to ignore TLS warnings. |

```bash
# On the SCC host, read-only
ps -o user,pid,cmd -C java | grep -i scc          # process owner — expect not root
ls -l <scc-root>/config/users.xml                 # expect 600, owned by the SCC user
ss -tlnp | grep -E ':8443|:443'                   # what is listening, and bound to what
```

### S3. NetWeaver — network exposure

The RFC Gateway and the ICF are the two ways into a NetWeaver system that people
forget they left open.

**Gateway ACLs.** Without `reginfo` and `secinfo`, any host that can reach the
gateway port can register an external server program and receive RFC calls.

| Parameter | Wanted | Meaning |
|---|---|---|
| `gw/reg_info` | set, file exists | Who may **register** an RFC server program |
| `gw/sec_info` | set, file exists | Who may **start** an external program |
| `gw/acl_mode` | `1` | Deny when no ACL matches (otherwise permissive) |
| `gw/reg_no_conn_info` | current recommended bitmask | Hardens registration handling |
| `gw/monitor` | `1` | Monitoring local only; `2` allows remote gateway admin |
| `gw/accept_remote_trace_level` | `0` | Stops remote trace-level changes |

Check via `SMGW` → Goto → Expert Functions → External Security (display), and
`RZ11` for each parameter. An empty ACL file is not the same as a missing one —
read the contents, and treat `P TP=* HOST=* ACCESS=*` as no ACL at all.

**Message server**: `ms/acl_info` set and populated; internal port
(`rdisp/msserv_internal`) not reachable from user networks. `SMMS` → Goto →
Expert Functions.

**ICF services** (`SICF`): the default set includes services that are rarely
needed and historically vulnerable. Walk active services and ask, per node, "does
a business process depend on this?" Pay attention to anything under `/sap/bc/`
that offers generic execution or introspection. Also confirm
`icf/set_HTTPonly_flag_on_cookies` is on and session cookies are `Secure`.

**ICM** (`SMICM`): which ports are open, HTTP vs HTTPS, and whether HTTP is
redirected. `icm/server_port_*` — an open plain-HTTP port carrying logon tickets
is High.

**SAProuter**, if present: read `saprouttab`. A trailing `P * * *` permits
everything and negates every line above it.

**Kernel and patch level**: `DISP+WORK` version, and whether the system is inside
SAP's maintenance window. Out-of-maintenance kernel on an internet-adjacent
system is High regardless of what else is right.

### S4. NetWeaver — identity and authorization

```
RSUSR003        default passwords for SAP*, DDIC, EARLYWATCH, TMSADM, SAPCPIC
                across ALL clients — including 000, 001, 066
RSUSR002        users by complex criteria (find SAP_ALL / SAP_NEW holders)
RSUSR008_009_NEW critical authorization combinations
RSPARAM         effective profile parameters vs defaults
```

**Default users are the classic Critical.** `RSUSR003` is the whole check and it
takes a minute. `SAP*` deserves special attention: if the user record is *deleted*
rather than locked, the kernel falls back to the hardcoded default unless
`login/no_automatic_user_sapstar = 1`. Verify the parameter, not just the user list.

**Password and logon policy** (`RZ11`, cross-check with `RSPARAM`):

| Parameter | Baseline |
|---|---|
| `login/min_password_lng` | ≥ 8, prefer 12+ |
| `login/password_expiration_time` | set, per policy |
| `login/fails_to_user_lock` | ≤ 5 |
| `login/failed_user_auto_unlock` | `0` (no auto-unlock) |
| `login/no_automatic_user_sapstar` | `1` |
| `login/password_compliance_to_current_policy` | `1` |
| `login/disable_multi_gui_login` | `1` in production |
| `rdisp/gui_auto_logout` | set |
| `auth/no_check_in_some_cases` | `Y` only if SU24 is actually maintained |
| `auth/rfc_authority_check` | `6` or current recommendation |
| `snc/enable` | `1` where SNC is deployed |

**Critical authorization objects.** Look for these on *dialog* users and on
widely-assigned roles, not just on emergency-access roles:

- `S_RFC` with `RFC_NAME = *` — the RFC equivalent of a wildcard
- `S_TABU_DIS` / `S_TABU_NAM` with broad table groups — direct table read
- `S_DEVELOP` in production — ABAP editor is code execution
- `S_ADMI_FCD`, `S_USER_GRP` (user administration), `S_PROGRAM`, `S_DATASET`
- `SAP_ALL` / `SAP_NEW` assigned to any named user in production is **Critical**;
  on a firefighter ID with logging and check-out it is Medium and worth naming
  as a compensating control

**RFC destinations** (`SM59`, and table `RFCDES`): every destination with a stored
user and password is a credential that survives password changes and is invisible
to the backend audit trail. Trusted RFC relationships (`SMT1`) form a graph — walk
it, because a low-tier system trusted by production is a path into production.
Flag destinations pointing *from* production *to* development.

**Client settings** (`SCC4`): production clients should be "not modifiable", with
cross-client customising and repository changes blocked. `T000` shows it directly.

**UCON**, if the release supports it: RFC function modules exposed externally
should be an allowlist, not "everything that exists".

### S5. Transport security and certificates

- **SNC** between SAP GUI and application servers, and on RFC. Without it, logon
  data and business payloads cross the network in the clear. `snc/enable`,
  `snc/data_protection/min`.
- **TLS** on ICM (`STRUST`): certificate expiry dates, key length, whether the
  chain is complete, and whether anything still trusts an internal CA that has
  been rotated.
- **Cloud Connector**: the tunnel to BTP is TLS on 443 outbound. Confirm no TLS
  interception proxy sits in the path unless deliberately architected — it
  terminates the tunnel and sees everything.
- **Certificate inventory with expiry** across STRUST, the SCC keystores, and any
  destination using client certificates. An expired cert on the tunnel is an
  outage, not a breach — but it lands at 3am.

### S6. Logging, audit trail and detection

A control nobody reads is a control that does not exist. For each of the four
audit trails, record **where it goes, how long it is kept, and who looks at it**:

| Trail | Where | Common gap |
|---|---|---|
| Security Audit Log | `RSAU_CONFIG` (7.50+) / `SM19`, read with `RSAU_READ_LOG` / `SM20` | Off, or on with filters so narrow they catch nothing. Must cover failed logons, RFC calls, user master changes, debug/replace |
| System log | `SM21` | Read only after an incident |
| Cloud Connector audit log | SCC UI → Audit, on the SCC host | Level "Off"; nothing ships it off the host |
| BTP audit log | Audit log viewer / service | Short default retention; not forwarded to a SIEM |

Also: table logging (`rec/client`) for customising tables, and whether change
documents are on for user and role administration.

Retention shorter than your realistic time-to-detect is itself the finding — say
so with the number.


## SAP examples for the severity rubric

| Severity | Meaning | SAP examples |
|---|---|---|
| **Critical** | Active exposure or imminent compromise. Within 24h. | Cloud Connector access control exposing `/` on a production host; `SAP*` with its default password in any client; gateway with no `reginfo`/`secinfo` reachable from an untrusted network; a service key or RFC password committed to a public repo; `S_RFC` with `RFC_NAME=*` on a dialog role. |
| **High** | Real risk, not yet exploited. Within a week. | Destination using stored `BasicAuthentication` to a production backend instead of principal propagation; SCC admin UI (8443) reachable beyond the admin network; Security Audit Log off, or on but nobody reads it; `SAP_ALL` on a named user in production; secret scanning disabled on a public repo. |
| **Medium** | Defensible, fix next cycle. | Password policy below the baseline; SNC off on internal RFC; trace level left at Debug; missing 2FA enforcement on the GitHub org; real tenant/system id in a tracked config template. |
| **Low** | Hygiene / defence in depth. | Unused RFC destinations left in `SM59`; ICF services active but unused; no branch protection; stale audit doc. |
| **Info** | Observation, not a defect. | Version inventory, counts, "checked and clean". |

## Related

- `sap-cc-operations`: the Cloud Connector API mechanics this module reads.
- `sap-di-rms-api`: the DI RMS internal API, if replication flows are in scope.
