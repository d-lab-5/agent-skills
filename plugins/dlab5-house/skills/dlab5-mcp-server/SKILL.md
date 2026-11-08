---
name: dlab5-mcp-server
description: |
  Build an MCP server over an Amplify Gen 2 backend — stdio transport, three
  tool groups by what each needs, and three ways to authenticate: password,
  Cognito refresh token, or an API key. Use when adding an MCP server to a
  D-LAB-5 style repository, when an agent needs the same data the web app has
  under the same authorization, or when deciding whether to host one publicly.
  Covers why the token store is keyed on the configured client id, why a tool
  that needs credentials must not be silently absent, and how to verify the
  protocol with a foreign client rather than your own.
license: GPL-3.0-or-later
metadata:
  maintainer: "Systems LAB 5"
  reference_implementation: "https://github.com/d-lab-5/blueprinting-dlab5-net"
  last_verified: "2026-08-30"
---

# An MCP server over an Amplify Gen 2 backend

## Related skills

- **dlab5-cognito-api-keys** — build the keys this consumes. Read that first if
  the server needs to run unattended.
- **dlab5-cloud-template** — the framework assumed here.
- **dlab5-git-push** — the gate before pushing.

## stdio, and when to reconsider

Run the server beside the agent that uses it: no endpoint to secure, no token
parked anywhere, and iterating on the tool surface costs a restart rather than
a deploy.

**A hosted transport is usually not what is wanted.** The *data* is already
shared — it lives in AppSync and S3 — and the server is a thin client over it.
A colleague on another machine runs their own against the same backend and sees
the same model, with *their* group memberships, which is the better access
story. A hosted transport earns its place only for an agent that cannot run a
local process, and then it needs real authentication rather than shared
credentials in an environment variable.

## Hosting it, when a client cannot run a process

claude.ai is that client. What it took here (ADR-0014):

- **Per-request identity, never per-process.** Amplify keeps one session per
  process; on a Lambda two keys would share a token. Keep the data calls free
  of Amplify, send each request's own JWT to AppSync with plain fetch, and bind
  the client per request with `AsyncLocalStorage` so the tools need no change.
  Test it with concurrent requests from two keys.
- **The key is the identity.** A key needs a USERNAME to sign in; read the
  key's owner `sub` and scope from its row, then do the custom-auth exchange on
  the client its scope names. Cache tokens by sha256(key), never the key.
- **Stateless streamable HTTP**, a fresh server per request, JSON responses.
  Leave out tools that need the server's disk or local toolchains.
- **Reserved concurrency** is the cheap rate limit.
- Verify with a foreign client over HTTP and **scratch keys of both scopes**:
  the read key must be refused on a write.

## Three tool groups, by what each needs

```ts
export const METAMODEL_TOOLS = [...];  // nothing: no backend, no credentials
export const DIAGRAM_TOOLS   = [...];  // an installed toolchain, no backend
export const MODEL_TOOLS     = [...];  // a backend
export const ALL_TOOLS = [...METAMODEL_TOOLS, ...DIAGRAM_TOOLS, ...MODEL_TOOLS];
```

Serve `connected ? ALL_TOOLS : [...METAMODEL_TOOLS, ...DIAGRAM_TOOLS]`.

**A server with no credentials must still start.** Serving the tools that need
nothing is a feature: it answers questions with no backend to hand. Say what
was withheld and why, on stderr, at startup.

**A tool whose dependency is missing should refuse with an instruction, not be
absent from the list.** "Not installed, run X" is actionable; a tool that
silently does not exist is a dead end for an agent that was told it does.

Assert the composition, or a tool will land in none of the groups:

```js
assert.equal(
  ALL_TOOLS.length,
  METAMODEL_TOOLS.length + DIAGRAM_TOOLS.length + MODEL_TOOLS.length
);
```

## Three ways in

```
BP_USER + BP_PASSWORD    a person at a keyboard
BP_REFRESH_TOKEN         unattended, ~30 days, IS the account
BP_USER + BP_API_KEY     unattended, named, scoped, revocable   ← prefer this
```

All three yield a session carrying the user's real groups, so authorization
downstream is identical to the web app's. Take them in that order of
preference and say which was used at startup.

**Amplify has no "sign in with a refresh token".** Do the raw Cognito
`InitiateAuth` with `REFRESH_TOKEN_AUTH` — what any client does — and write the
result into the same in-memory store Amplify reads from.

**Amplify's `signOut()` REVOKES the refresh token.** That is the revoke
mechanism and it is convenient, but minting one must not sign out. `RevokeToken`
kills one token without touching others, so several can coexist and be retired
independently.

**Store tokens under the CONFIGURED client id**, not the one you authenticated
against. That is where Amplify's token provider looks. For an API-key session
this means the refresh token belongs to a different client — so do not store
it, or Amplify will try to refresh with it and fail in a way that looks like an
expired session. The consequence is a ceiling of one access-token lifetime per
`connect()`. Write that down where it applies.

**Cognito answers every custom-auth failure with "Incorrect username or
password."** No password is involved. Translate it: the key may be wrong,
revoked, expired, belong to another account, or be read-only on the write
client. The server deliberately cannot tell which, so list them rather than
repeat a message that is false.

## Tool descriptions are the interface

An agent chooses from the description alone. Two rules earn their keep:

**State what a tool does NOT do.** A scaffolder that produces a template copy
must say so, or an agent will read a perfect quality score and call the work
finished. If a result can be misread, the tool should say the true thing in the
result, not only in the description.

**Keep the dangerous shape out.** Where a workflow has a human review step,
provide the tools either side of it and none that skips it. An agent annotates;
a person imports. A tool that wrote straight through would make the review
decorative.

## Validate arguments

`String(undefined)` is `"undefined"` — a perfectly good filename. A missing
path once wrote a 387 kB file called `undefined` into the package directory,
noticed only because it turned up staged for commit. Require paths explicitly,
and test that the refusal comes *before* any dependency check, or the test
passes for the wrong reason on a machine without that dependency.

## Verify with a foreign client

Two levels, and only the second tests the protocol:

- `verify:mcp` calls `tool.run(args)` directly. Fast, and skips the stdio
  framing, the registration and the schema conversion entirely.
- `verify:mcp-client` drives the real server over stdio **from Python**, using
  the official SDK. A second implementation in another language cannot share
  your misunderstandings.

Run the Python one with each credential path, including none — the degraded
path is a feature and deserves a check. Note the SDK is snake_case where the
wire is camelCase (`server_info`, `is_error`, `input_schema`).

**Clean up, then audit the environment rather than the test output.** A
verifier that creates a scratch project must delete its row, its Cognito group
*and* its S3 objects. Two verifiers here deleted the first two and left the
third; nothing pointed at the leftovers and nothing complained, which is how a
bucket fills up over weeks.
