---
name: dlab5-cognito-api-keys
description: |
  Build named, scoped, revocable API keys on an AWS Amplify Gen 2 backend by
  making a key a COGNITO credential rather than an API-level one. Use when a
  client that cannot be asked for a password needs access — a hosted MCP server,
  CI, a scheduled export — or when someone proposes an AppSync API key. Covers
  the four custom-auth triggers, the standalone key table, the two app clients
  that carry scope, and why read-only has to be enforced in three places to be
  real. Carries five failures that each cost a deploy: an empty challenge, a
  CloudFormation cycle, a redeclared mutation, an unpopulated fieldName, and a
  scope check specified but not written.
license: GPL-3.0-or-later
metadata:
  maintainer: "Systems LAB 5"
  reference_implementation: "https://github.com/d-lab-5/blueprinting-dlab5-net"
  adr: "docs/adr/0012-api-keys.md"
  last_verified: "2026-08-30"
---

# API keys on an Amplify Gen 2 backend

## Related skills

- **dlab5-mcp-server** — the client that consumes these keys.
- **dlab5-cloud-template** — the framework this assumes: npm workspaces, a
  non-workspace `backend/`, Cognito groups, a Gatsby site behind one gate.
- **dlab5-git-push** — the gate to run before pushing any of this.

## The decision, and the two wrong turns

**A key must authenticate to Cognito and yield an ordinary session.** Then every
authorization rule downstream is untouched, because by the time a request
arrives the credential is a normal token carrying the user's real groups.

Two alternatives look easier and are not:

**An AppSync API key** has no user identity at all. If any rule reads
`cognito:groups` — `allow.groupDefinedIn(...)`, or a check inside a Lambda —
the key flattens per-tenant access into "anyone with the key sees everything".
It is a key for the API, not for an account. Reject it explicitly; someone will
propose it.

**A Lambda authorizer** fails more subtly. AppSync passes its result as
`$ctx.identity.resolverContext`, while Amplify's *generated* model rules read
`$ctx.identity.claims["cognito:groups"]`. Hand-written Lambdas can be taught to
read either; `listX` cannot. Anything using generated queries breaks while your
own functions keep working, which is the worst way for it to break.

## The pieces

```
backend/amplify/auth/triggers/
  defineAuthChallenge.ts          the state machine: one challenge, one attempt
  createAuthChallenge.ts          no secret to send — but NOT empty, see below
  verifyAuthChallengeResponse.ts  validates the key, and its SCOPE
  preTokenGeneration.ts           writes bp:scope, strips the admin group
  keyClients.ts                   resolves the app clients by NAME at runtime
backend/amplify/functions/apiKeyAdmin/   mint / list / revoke
backend/amplify/functions/shared/claims.ts   requireWrite(), read by every writer
```

Wire the triggers through `defineAuth({ triggers: { … } })`, and **also**
register them in `defineBackend` — same factory instance, no second function,
but that is the only way to reach their lambda for an IAM grant.

## The key table is not `a.model`

Two reasons, and either alone decides it:

1. A model exposes generated CRUD over a row holding a **key hash**. Nobody
   should read that, including its owner, who has already been shown the only
   copy that will exist.
2. The auth triggers need the same table, so a model would put an edge from the
   auth stack to the data stack — a CloudFormation cycle.

Use a plain CDK `Table` in its own stack (`backend.createStack("apiKeys")`),
with a `byOwner` GSI and a TTL attribute so expired rows stop *existing* rather
than merely stopping working.

## Scope, and why one enforcement point is not enough

A scope only the client honours is not a scope. Three things together:

**Two app clients**, `…-api-key-read` and `…-api-key-write`, both
`ALLOW_CUSTOM_AUTH` only. Cognito puts the client id in the token — `client_id`
in an access token, `aud` in an ID token, and **AppSync accepts either** — and
the caller cannot forge it. The verifier refuses a read-only key presented on
the write client.

**`bp:scope` in the token**, written by `preTokenGeneration`. Every writing
Lambda calls `requireWrite()`.

**The admin group stripped** from any key session. Generated model rules read
`cognito:groups` and know nothing about app clients, so without this an
administrator's read-only key could call `createX` directly and go round every
Lambda. Tighten member write access to your models at the same time: writes
should already go through functions that own side effects.

## Five failures, each of which cost a deploy

**An empty `publicChallengeParameters` fails the whole flow**, and reports as
`NotAuthorizedException: Incorrect username or password` — with every trigger
having run cleanly and logged nothing. No password is involved anywhere in this
flow. Return one value that names the challenge.

**Never pass an app client id to a function as an environment variable.** The
clients live in the auth stack; the auth stack already references the trigger
functions; the env var closes the cycle and the build fails with
`CloudformationStackCircularDependencyError`. Resolve them at runtime by name
using `ListUserPoolClients` with the pool id Cognito puts in the trigger event,
cached per container.

**`a.model("X")` already generates `createX`, `updateX`, `deleteX`.**
Redeclaring one fails the CDK assembly with *"Object type extension 'Mutation'
cannot redeclare field"*. Name yours differently — `provisionX`, `purgeX` — and
say in a comment that the generated one still exists and does less.

**AppSync does not populate `event.info.fieldName`** for Lambda-backed custom
mutations. One function cannot serve two mutations whose arguments match.
Either give them different arguments and dispatch on those, or use two
functions — which is better anyway when their IAM should differ: a delete
function holding `s3:DeleteObject` and not `PutObject`, and the writer holding
the reverse, cannot do each other's job whatever goes wrong inside them.

**Write the scope check, do not just specify it.** The ADR said the key's scope
is checked against the client. The verifier checked existence, ownership,
revocation, expiry and the hash — and not the scope. A read-only key
authenticated on the write client and would have been handed a write token.
`verify:api-keys` caught it: 25 of 26.

## Failure direction is a decision, and the obvious one was wrong

`verifyAuthChallengeResponse` **fails closed**: if it cannot establish the scope
it must not guess, so let it throw and Cognito denies.

`preTokenGeneration` is where this gets subtle, and where the reference
implementation had a real fail-open hole for a day.

The first version returned the token untouched when it could not resolve the
app clients, reasoning that its only job was to *restrict* a key session and
that a browser session was unaffected either way. Both halves were true and the
conclusion was wrong: the **key** session was also unaffected. The token then
carried no scope claim and no group strip, and downstream a missing claim read
as "not a key, may write" — so a read-only key became an administrator whenever
that lookup failed.

An authorization control that grants privilege on failure is the thing an audit
exists to find.

**Mark every session, not only the restricted ones.** Write `bp:scope: "web"`
for the browser client too. The claim's *absence* then means the trigger did
not run, which downstream can fail closed on:

```ts
if (scope === "web")   return { isKey: false, mayWrite: true };
if (scope === "read")  return { isKey: true,  mayWrite: false };
if (scope === "write") return { isKey: true,  mayWrite: true };
return { isKey: false, mayWrite: false, unknown: true };   // deny
```

The failure mode becomes: a Cognito hiccup degrades **everyone to read-only**.
Sign-in still works, reads still work, writes are refused with a message naming
the trigger. That is worse than working and much better than either locking
sign-in out entirely or handing out administrator sessions.

Write both directions down where the code is. They look inconsistent otherwise,
and the reason one is not the other is the whole point.

## Details that are not decoration

- **Store the hash, never the key.** The value shown at creation is the only
  copy that will exist; say so *before* minting, not after.
- **Answer identically** for wrong, revoked, expired, someone else's, and
  read-only-on-the-write-client. Distinguishing them tells an attacker which
  part to fix.
- **Constant-time comparison** (`timingSafeEqual`), guarding the length first
  because it throws on a mismatch.
- **One challenge, one attempt.** Retries turn an offline guess into an online
  one.
- **A key cannot mint or revoke a key**, whatever its scope. Otherwise a leaked
  read key becomes a write key in one call, and revoking the one you know about
  leaves the one you do not.
- **Expiry is not optional.**

## Verify it, and expect the first run to fail

`scripts/verify-api-keys.mjs` in the reference implementation is 26 checks.
The ones that matter are all refusals — every write path attempted with a read
key, *including the generated mutations*, plus a read key on the write client,
plus a key trying to mint a key. Assert the group strip and that revocation
takes effect immediately.

Custom auth has four moving parts that have never run together. Diagnose from
the triggers' CloudWatch logs — and note that `aws logs tail` has a delivery
lag, so an empty tail is not evidence a trigger did not run. Check
`describe-log-streams --order-by LastEventTime` for the real answer.
