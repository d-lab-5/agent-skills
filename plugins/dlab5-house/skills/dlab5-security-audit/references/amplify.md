# Amplify module: Gatsby sites on AWS Amplify

Load this for a web platform on AWS Amplify: Cognito, AppSync, DynamoDB, S3
and Gatsby sites. It adds domains A1–A7 between the core's C1 and C2.

It was written for the DigitalHome.Cloud apps (Portal, Designer, Modeler,
checked out as `repos/<app>` in the darkfactory umbrella), first on Amplify
Gen 1. Paths and group names below are theirs: substitute the repository in
scope. For a Gen 2 backend, also check:
- `backend.ts` sets `blockPublicAccess: BLOCK_ALL` on every bucket;
- no `allow.guest()`, and no unauthenticated identities;
- the deploy path follows ADR-0015 in blueprinting-dlab5-net: production
  builds only from a reviewed branch, and account-level S3 Block Public Access
  is on.

### A1. Authentication and authorization (Cognito + AppSync)

**What you're looking for**: weak auth posture, missing MFA, over-broad permissions, missing `@auth` on tenant data.

```bash
# AppSync schema authz check — every type that holds tenant data must have @auth
grep -E "type\s+\w+\s*@(model|auth)" repos/portal/amplify/backend/api/*/schema.graphql 2>/dev/null
# Look for @auth { allow: public } on tenant-scoped types — that's a bug
grep -B 2 -A 4 "allow: public" repos/portal/amplify/backend/api/*/schema.graphql 2>/dev/null

# Cognito group references — confirm the apps gate on the right groups
for app in portal designer modeler; do
  echo "=== $app: hasGroup() and dhc-* group references ==="
  grep -rn 'hasGroup\|"dhc-users"\|"dhc-operators"\|"dhc-admins"\|"dhc-modelers"' "repos/$app/src/" 2>/dev/null | head -20
done

# Authenticator / signIn flows — make sure every entry calls reloadSession()
grep -rn "signIn\|confirmSignIn\|Authenticator" repos/*/src/pages/signin.js 2>/dev/null
```

Manual checks (browser / AWS console — ask the user to verify if you can't):
- **Cognito User Pool**: MFA optional or required? Password policy ≥ 12 chars + complexity? Account recovery method? Token expiry (access ≤ 1h, refresh ≤ 30d)?
- **Identity Pool**: authenticated role scope, unauthenticated role disabled if not used.
- **AppSync**: default authentication mode is `AMAZON_COGNITO_USER_POOLS`. API key fallback should be disabled or scoped to a specific operation.
- **Federation / Hosted UI**: not configured today (per `dhc-design-implement` skill notes). If enabled, audit OIDC client secrets and redirect URIs.

Also check that the Modeler's custom signin (replaced the Authenticator) handles all `nextStep.signInStep` cases — `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED`, MFA TOTP/SMS, `CONFIRM_SIGN_UP`, `RESET_PASSWORD`. Missing branches mean some users (admins with temporary passwords, MFA users) can't sign in.

### A2. Data layer (DynamoDB + S3)

**What you're looking for**: cross-tenant leakage, public buckets, missing encryption.

```bash
# Schema review — every tenant-scoped @model should partition on smartHomeId
grep -E "@key|@auth|smartHome" repos/portal/amplify/backend/api/*/schema.graphql 2>/dev/null | head -30

# S3 access patterns from the frontend — look for unsigned reads / writes
grep -rn "uploadData\|downloadData\|getProperties\|list\b" repos/*/src/utils/s3.js 2>/dev/null | head
```

Manual checks (AWS console / `amplify status`):
- **DynamoDB**: server-side encryption enabled? Point-in-time recovery? `@auth { allow: owner }` translates to `owner` field == `cognito:username`?
- **S3**: public access **blocked** at account + bucket level? Bucket policy denies `s3:PutObject` from non-Amplify principals? Signed URL TTL ≤ 1h?
- **Bucket structure** per ADR-0010: confirm tenant-scoped paths (`public/smarthomes/{smartHomeId}/...`) actually enforce per-tenant Cognito identity claims, not just key naming.

### A3. Frontend security (Gatsby apps)

```bash
# Insecure DOM operations
grep -rn "dangerouslySetInnerHTML\|innerHTML\s*=\|eval(\|new Function(" repos/*/src/ 2>/dev/null | head

# Unrestricted target=_blank without rel="noopener noreferrer".
# Grep is line-based but JSX often spans `target` and `rel` across lines, so
# look at a 2-line window after each match and exclude any window that has
# `rel=...noreferrer` or `rel=...noopener`.
grep -rn -A 1 'target="_blank"' repos/*/src/ 2>/dev/null | \
  grep --no-group-separator -B 1 -E 'rel=' | \
  grep -v 'rel=' | grep 'target="_blank"' | \
  awk -F: '{print $1":"$2}' | sort -u || echo "  (no naked target=_blank — clean)"

# document.write, window.open patterns
grep -rn "document.write\|window.open(" repos/*/src/ 2>/dev/null | head

# Hardcoded URLs that should use getAppUrl
grep -rn "https://portal\.digitalhome\.cloud\|https://designer\.digitalhome\.cloud\|https://modeler\.digitalhome\.cloud" repos/*/src/ 2>/dev/null | grep -v "getAppUrl\|aws-exports.deployment.js\|tagline\|comment" | head

# CSP / security headers — Amplify Hosting doesn't add these by default
for app in portal designer modeler; do
  echo "[$app]"
  cat "repos/$app/customHttp.yml" 2>/dev/null || echo "(no customHttp.yml — no custom security headers)"
done
```

If `customHttp.yml` is missing, recommend adding one with `Strict-Transport-Security`, `Content-Security-Policy` (start with `default-src 'self'` + the Cognito + AppSync + S3 origins), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

Confirm cross-app navigation only uses `getAppUrl(appName)` (env-aware). Hardcoded `https://*.digitalhome.cloud` URLs break stage/dev environments and may bypass intended routing.

### A4. Dependency hygiene

```bash
# Vulnerability counts per app
for app in portal designer modeler; do
  echo "=== $app ==="
  (cd "repos/$app" && yarn audit --level=high --json 2>/dev/null | tail -1)
  # OR: npm audit --json | jq '.metadata.vulnerabilities'
done

# Lockfile drift
for app in portal designer modeler; do
  test -f "repos/$app/yarn.lock" && echo "[$app] uses yarn.lock"
  test -f "repos/$app/package-lock.json" && echo "[$app] uses package-lock.json"
  test -f "repos/$app/yarn.lock" && test -f "repos/$app/package-lock.json" && echo "[$app] WARNING: both lockfiles present"
done

# Outdated packages
for app in portal designer modeler; do
  echo "=== $app ==="
  (cd "repos/$app" && yarn outdated 2>&1 | head -30 || true)
done

# License audit — confirm no GPL/AGPL/LGPL surprises
for app in portal designer modeler; do
  echo "=== $app ==="
  (cd "repos/$app" && npx --yes license-checker --summary 2>/dev/null | head -20 || echo "(license-checker not available — skip or install)")
done
```

Severity guide: 1 critical CVE = High in audit. 5+ high CVEs = High overall. Patch-version updates with no breaking changes = Low (worth doing, low risk). Major bumps that touch React, Gatsby, Amplify = Medium (needs testing).

The 75–78 vulnerabilities seen in recent Amplify deploy logs are likely transitive and many are in dev-only packages — focus on `--production` paths if possible.

### A5. Build and deploy

```bash
# Confirm each app builds clean from a fresh state
for app in portal designer modeler; do
  echo "=== $app build ==="
  (cd "repos/$app" && yarn clean && yarn build 2>&1 | tail -5)
done

# Confirm GATSBY_* env vars in Amplify console match aws-exports.deployment.js
for app in portal designer modeler; do
  echo "[$app] expected GATSBY_* vars:"
  grep -hoE "GATSBY_[A-Z_]+" "repos/$app/src/aws-exports.deployment.js" 2>/dev/null | sort -u
done
# Then ask the user to compare against the Amplify Hosting console for each app.

# amplify.yml present and sane (no rm -rf, no curl | bash)
for app in portal designer modeler; do
  echo "[$app] amplify.yml:"
  cat "repos/$app/amplify.yml" 2>&1 | head -30
done

# Branch protection — manual check on GitHub:
# - main: require PR review, status checks (build), no force-push
# - stage: same as main but optionally allow lighter review
gh api "repos/DigitalHome-cloud/digitalhome-cloud-portal/branches/main/protection" 2>/dev/null | jq '{required_status_checks, required_pull_request_reviews, allow_force_pushes}'
gh api "repos/DigitalHome-cloud/digitalhome-cloud-designer/branches/main/protection" 2>/dev/null | jq '{required_status_checks, required_pull_request_reviews, allow_force_pushes}'
gh api "repos/DigitalHome-cloud/digitalhome-cloud-modeler/branches/main/protection" 2>/dev/null | jq '{required_status_checks, required_pull_request_reviews, allow_force_pushes}'

# Dependabot status
for repo in digitalhome-cloud-portal digitalhome-cloud-designer digitalhome-cloud-modeler digitalhome-cloud-darkfactory; do
  echo "[$repo] dependabot alerts (need admin):"
  gh api "repos/DigitalHome-cloud/$repo/dependabot/alerts?state=open" 2>/dev/null | jq 'length' || echo "(no access)"
done

# Secret scanning enabled?
for repo in digitalhome-cloud-portal digitalhome-cloud-designer digitalhome-cloud-modeler digitalhome-cloud-darkfactory; do
  echo "[$repo] secret scanning:"
  gh api "repos/DigitalHome-cloud/$repo" 2>/dev/null | jq '.security_and_analysis'
done
```

Manual checks:
- **Amplify Hosting**: each app's branch (`main` → prod, `stage` → staging) has a separate environment with separate env vars. Confirm prod doesn't accidentally get dev/stage backend IDs.
- **IAM build role**: scoped to the minimum (S3 publish, CloudFront invalidate). Not a wildcard `*`.
- **Build caching**: Amplify caches `node_modules`. Confirm cache invalidates on `package.json`/`yarn.lock` change (it does by default; flag if disabled).

### A6. Code quality

```bash
# Lint + format runs clean
for app in portal designer modeler; do
  echo "=== $app format ==="
  (cd "repos/$app" && yarn format --check 2>&1 | tail -10 || true)
done

# i18n key parity — every key in en/common.json should also be in de/ and fr/
for app in portal designer modeler; do
  echo "=== $app i18n parity ==="
  if [ -f "repos/$app/src/locales/en/common.json" ]; then
    en=$(node -e "console.log(Object.keys(require('./repos/$app/src/locales/en/common.json')).length)")
    de=$(node -e "console.log(Object.keys(require('./repos/$app/src/locales/de/common.json')).length)" 2>/dev/null || echo "missing")
    fr=$(node -e "console.log(Object.keys(require('./repos/$app/src/locales/fr/common.json')).length)" 2>/dev/null || echo "missing")
    echo "  en: $en keys, de: $de keys, fr: $fr keys"
  fi
done

# Test coverage — none of the apps have tests today (per CLAUDE.md). Flag that.
for app in portal designer modeler; do
  test -d "repos/$app/__tests__" || test -d "repos/$app/src/__tests__" || \
    grep -q '"test"' "repos/$app/package.json" 2>/dev/null && echo "[$app] has tests" || echo "[$app] no tests"
done

# Submodule SHAs match each app's HEAD on stage
git -C . status --short | grep "^M\|^m " | head
```

Note any test coverage gaps as **High** if they cover auth/authorization paths, **Medium** otherwise. The platform's "no test suite is configured yet" status (per each CLAUDE.md) is itself a Medium finding worth tracking.

### A7. Documentation and ADR posture

```bash
# CLAUDE.md files exist and aren't stale
for f in CLAUDE.md repos/portal/CLAUDE.md repos/designer/CLAUDE.md repos/modeler/CLAUDE.md; do
  if [ -f "$f" ]; then
    echo "[$f] last modified:"
    git log -1 --format="%cs %s" -- "$f"
  fi
done

# ADRs cover the major architectural decisions
ls docs/adr/ 2>/dev/null | head

# Specs index
ls docs/specs/ 2>/dev/null | head
```

Look for:
- CLAUDE.md last modified > 6 months ago = Low.
- A new dependency or pattern shipped with no ADR = Low/Medium.
- A spec that's empty (e.g. `DH-SPEC-202-Modeller.md` was 0 bytes at last audit) = Low.

## Amplify examples for the severity rubric

| Severity | Meaning | Examples |
|----------|---------|----------|
| **Critical** | Active exposure or imminent compromise. Action within 24h. | Hardcoded AWS key in committed code; public S3 bucket holding tenant data; unauthenticated GraphQL mutation; cleartext password in logs. |
| **High** | Real risk that hasn't been exploited. Action within ~1 week. | Cognito User Pool with no MFA, `@auth { allow: public }` on a tenant-scoped type, npm CVE rated 9+, missing CSP, broad IAM `*` resource. |
| **Medium** | Defensible but worth fixing in the next planning cycle. | Older dependency with known low-severity CVE, missing security headers, weak password policy minimum, no rate limit on a Lambda. |
| **Low** | Hygiene / defense-in-depth. | Unused IAM permissions, outdated docs, missing CONTRIBUTING.md, commit messages inconsistent. |
| **Info** | Observation, not a defect. | Build size growth, dependency count, lint warnings. |

A quick-reference list of these checks is in [checklist.md](checklist.md).
