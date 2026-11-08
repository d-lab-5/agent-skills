# CLAUDE.md: agent-skills

This is the D-LAB-5 catalogue of agent skills, a Claude Code plugin
marketplace named `d-lab-5`. The README says how it works. What bites:

- **One home per skill.** Never copy a skill in from another repository. Add a
  `git-subdir` pointer to its home instead. Only skills that belong to no
  single repository live in `plugins/dlab5-house/`.
- **A changed skill needs a version bump**, in its `plugin.json` and its
  catalogue entry. `check.mjs --since` refuses the change otherwise, and
  consumers would never see it.
- **No symlinks, and a description of at most 1024 characters.** `check.mjs`
  refuses both.
- **Public repository.** No account ids, ARNs, hostnames, emails, local paths
  or real names. Invent names in examples. Run `node scripts/check.mjs` and
  `./test.sh` before a push.
- **`main` takes changes only by pull request** (ADR-0015 in
  blueprinting-dlab5-net). Work on `stage`.
- **The first keyword of every catalogue entry is its domain:** `d-lab-5`,
  `digitalhome`, `erp-lab-5`, `atelier-5` or `artdecoris`. Claude Code ignores
  unknown fields, so the domain can't be a field of its own.
- **Scripts are plain Node 22 with no dependencies.** Keep them that way: the
  gate runs on a bare runner, with `--ignore-scripts` habits elsewhere.
