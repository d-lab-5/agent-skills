#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Prove the gate refuses what it should: each case plants one fault in a scratch
# copy of this repository and expects check.mjs to fail on it, naming it.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
pass=0

fresh() {
  rm -rf "$tmp/r"; mkdir -p "$tmp/r"
  (cd "$here" && tar --exclude=.git --exclude=.cache --exclude=dist -cf - .) | tar -xf - -C "$tmp/r"
  git -C "$tmp/r" init -q -b main
  git -C "$tmp/r" -c user.name=t -c user.email=t@example.com add -A
  git -C "$tmp/r" -c user.name=t -c user.email=t@example.com commit -qm base
}
commit() { git -C "$tmp/r" -c user.name=t -c user.email=t@example.com commit -qam "$1"; }
expect_fail() { # name, expected text, check args…
  local name=$1 want=$2; shift 2
  if out="$(node "$tmp/r/scripts/check.mjs" "$@" 2>&1)"; then echo "✗ $name: passed, should have failed"; exit 1; fi
  grep -q -- "$want" <<<"$out" || { echo "✗ $name: failed, but not with \"$want\":"; echo "$out"; exit 1; }
  echo "✓ $name"; pass=$((pass + 1))
}
skill="$tmp/r/plugins/dlab5-house/skills/dlab5-mcp-server"

fresh
node "$tmp/r/scripts/check.mjs" >/dev/null && { echo "✓ the real catalogue passes"; pass=$((pass + 1)); }

fresh; ln -s SKILL.md "$skill/linked.md"
expect_fail "a symlink" "is a symlink"

fresh; echo "Account 123456789012 hosts it." >> "$skill/SKILL.md"
expect_fail "an account id" "12-digit"

fresh; echo "Ask admin@example.net." >> "$skill/SKILL.md"
expect_fail "an email address" "an email address"

fresh; echo "See /home/someone/x." >> "$skill/SKILL.md"
expect_fail "a local path" "a local path"

fresh; printf 'Klassenfahrt\n' > "$tmp/deny"; echo "As at the Klassenfahrt." >> "$skill/SKILL.md"
DLAB5_DENYLIST="$tmp/deny" expect_fail "a word on the deny list" "deny list"

fresh; sed -i 's/^name: dlab5-mcp-server/name: something-else/' "$skill/SKILL.md"
expect_fail "a name that is not its folder" "the folder is"

fresh; python3 - "$skill/SKILL.md" <<'P'
import sys; p=sys.argv[1]; s=open(p).read(); open(p,'w').write(s.replace("description: |\n", "description: |\n  " + "x" * 1100 + "\n", 1))
P
expect_fail "a description over 1024" "take 1024 at most"

fresh; echo "One more line." >> "$skill/SKILL.md"; commit "edit without a bump"
expect_fail "a change without a version bump" "bump it" --since HEAD~1

fresh; echo "One more line." >> "$skill/SKILL.md"
sed -i 's/"version": "0.1.0"/"version": "0.1.1"/' "$tmp/r/plugins/dlab5-house/.claude-plugin/plugin.json" "$tmp/r/.claude-plugin/marketplace.json"
commit "edit with a bump"
node "$tmp/r/scripts/check.mjs" --since HEAD~1 >/dev/null && { echo "✓ a change with a bump passes"; pass=$((pass + 1)); }

fresh; python3 - "$tmp/r/.claude-plugin/marketplace.json" <<'P'
import json,sys; p=sys.argv[1]; m=json.load(open(p))
m["plugins"].append({"name":"nowhere","source":{"source":"git-subdir","url":"https://github.com/d-lab-5/no-such-repo-for-the-test.git","path":"plugin"},"description":"x","keywords":["d-lab-5"]})
open(p,"w").write(json.dumps(m))
P
expect_fail "a dangling pointer" "cannot fetch" --remote

fresh; python3 - "$tmp/r/.claude-plugin/marketplace.json" <<'P'
import json,sys; p=sys.argv[1]; m=json.load(open(p)); m["plugins"][0]["keywords"]=["amplify"]; open(p,"w").write(json.dumps(m))
P
expect_fail "an entry with no domain" "name its domain"

echo "$pass passed"
