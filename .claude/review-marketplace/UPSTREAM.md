# Vendored review plugin (CCR F11)

`claude-code-review.yml` used to install the `code-review` plugin from
`https://github.com/anthropics/claude-code.git` at whatever its default branch
held on the day of the run, and that marketplace now points on to
`anthropics/claude-plugins-official` at `main`. Code that changed upstream ran
in the review job next to `ANTHROPIC_API_KEY` without anyone here seeing it.

The plugin is now a reviewed copy in this folder, and the review job loads it
as a local marketplace. Because it lives under `.claude/`, the job takes it
from the base branch (the "Reviewer instructions from base branch" step), so
a pull request cannot change its own reviewer.

| | |
|---|---|
| Upstream | `https://github.com/anthropics/claude-plugins-official`, `plugins/code-review` |
| Commit | `0fbfda5a91f4adc311daca25acc99132f40f0b6e` (2026-11-26) |
| Plugin version | 1.0.1 |
| Licence | `plugins/code-review/LICENSE` (kept with the copy) |

To update: copy `plugins/code-review` from a newer upstream commit, read the
diff (it is a prompt and a tool list that run with the API key), update the
commit above, and open a PR. `tests/security/claude-workflow-hardening.invariant.spec.ts`
checks that the job loads only this local copy.
