# opencode PR Review + Issue Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make opencode the sole automated PR reviewer (APPROVE / REQUEST_CHANGES) and the autonomous issue triager (comments, labels, wontfix close, agent-ready PR fixes) in the personal repo `pyw0w/brik`.

**Architecture:** Two GitHub Actions workflows run `opencode run` non-interactively with a custom prompt. The PR-review workflow (`opencode-review.yml`) reads the PR via `gh`, checks the diff against repo standards, and submits a formal review as `OCode-Bot` via `BOT_PAT`. The issue-triage workflow (`opencode-issue-triage.yml`) reads the issue via `gh`, applies triage labels per `docs/agents/triage-labels.md`, and may create a PR fix for `agent-ready` issues. Both restrict opencode to `gh*` bash commands via `OPENCODE_PERMISSION`.

**Tech Stack:** GitHub Actions, opencode CLI (`opencode run`), `gh` CLI, curl installer, `BOT_PAT` secret, `OPENCODE_API_KEY` secret.

## Global Constraints

- Personal repo (`pyw0w/brik`), owner type `User`. Bypass allowances for branch protection are NOT supported via API.
- Author (`pyw0w`) cannot approve own PR; verdict comes from `OCode-Bot` (collaborator, `write`) via `BOT_PAT`.
- Branch protection on `main` stays: `enforce_admins: true`, `required_approving_review_count: 1`, strict status check `test`, `required_conversation_resolution: true`. Do NOT modify it.
- `test.yml` (bun test, typecheck, check:boundaries, docs:build) stays as the required `test` check. Do NOT modify it.
- Modules may import only `../../core/index.ts` (code) and `../../core/testing.ts` (tests). Never `discord.js`, `src/core/internal/**`, `src/core/discord/**`, `src/app/**`.
- Model: `opencode/deepseek-v4-flash-free`. Prompt/command format: `opencode run --auto -m opencode/deepseek-v4-flash-free --title "<title>" "<prompt>"`.
- `OPENCODE_PERMISSION` = `'{ "bash": { "*": "deny", "gh*": "allow" } }'` in both workflows.
- Both workflows trigger only for PRs/issues from this repo's branches (not forks): review workflow uses `if: github.event.pull_request.head.repo.full_name == github.repository`; the `issues` event has no fork dimension, but opencode's PR-fix creation only pushes to this repo.
- Delete `.github/workflows/auto-approve.yml`. Keep `OCode-Bot` as collaborator and keep `BOT_PAT` secret.
- Follow the repo's existing workflow style: `name: <lowercase-hyphen>`, `on:` block, `runs-on: ubuntu-latest`.

---

### Task 1: Add `OPENCODE_API_KEY` secret (manual, user action)

**Files:**
- None (GitHub repo secrets).

**Interfaces:**
- Consumes: nothing.
- Produces: secret `OPENCODE_API_KEY` in repo secrets, required by Task 2 and Task 3 workflows at runtime.

- [ ] **Step 1: Verify `BOT_PAT` secret exists**

Run: `gh secret list --repo pyw0w/brik`
Expected: `BOT_PAT` present (added earlier for the auto-approve bot). Do not print its value.

- [ ] **Step 2: User adds `OPENCODE_API_KEY`**

The user copies their OpenCode Zen key from https://opencode.ai/auth (provider `opencode`, type `api`). Add it to repo secrets:

```bash
gh secret set OPENCODE_API_KEY --repo pyw0w/brik
```

Expected: prompts for value on stdin (paste key, then Ctrl-D). Verify:

```bash
gh secret list --repo pyw0w/brik
```

Expected: both `BOT_PAT` and `OPENCODE_API_KEY` listed.

- [ ] **Step 3: Verify the opencode provider key works for the free model**

Run: `curl -fsSL https://opencode.ai/install | bash` then:
`~/.opencode/bin/opencode run -m opencode/deepseek-v4-flash-free "Reply with exactly: ok"` with `OPENCODE_API_KEY` exported from the secret value.
Expected: prints `ok`. If it fails, the key was copied wrong — redo Step 2.

> Note: This step is a local smoke test; the real proof is in Task 4/5. If you can't export the secret value locally, skip this step and rely on Task 4.

---

### Task 2: Create `.github/workflows/opencode-review.yml` (PR review)

**Files:**
- Create: `.github/workflows/opencode-review.yml`

**Interfaces:**
- Consumes: secret `BOT_PAT`, secret `OPENCODE_API_KEY` (Task 1).
- Produces: on every PR event, a review from `OCode-Bot` (`APPROVED` or `CHANGES_REQUESTED`). Consumed by the `test`-protected merge gate on `main`.

- [ ] **Step 1: Write the workflow file**

Create `.github/workflows/opencode-review.yml`:

```yaml
name: opencode-review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

concurrency:
  group: pr-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    runs-on: ubuntu-latest
    if: github.event.pull_request.head.repo.full_name == github.repository
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install opencode
        run: curl -fsSL https://opencode.ai/install | bash

      - name: Review pull request
        env:
          OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}
          GH_TOKEN: ${{ secrets.BOT_PAT }}
          OPENCODE_PERMISSION: '{ "bash": { "*": "deny", "gh*": "allow" } }'
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: |
          export PATH="$HOME/.opencode/bin:$PATH"
          PROMPT=$(cat <<'PROMPT_EOF'
          A new pull request #$PR_NUMBER has been opened in the repo pyw0w/brik.

          Your job: review this pull request against the repository's standards and submit a formal review verdict using the gh CLI. You MUST use the number from the environment variable PR_NUMBER ($PR_NUMBER) for every gh command.

          Step 1 — Gather context:
          Run `gh pr view $PR_NUMBER` to read the title, body, and metadata.
          Run `gh pr diff $PR_NUMBER` to read the diff.
          Read the FULL content of every changed file (not just the diff) to get proper context.
          Read `AGENTS.md` and `docs/llm.md` to understand the project's architecture and conventions.

          Step 2 — Check against these repository standards:
          - Modules in `src/modules/**` may import ONLY `../../core/index.ts` (code) and `../../core/testing.ts` (tests). They must NEVER import `discord.js`, `src/core/internal/**`, `src/core/discord/**`, or `src/app/**` from a module.
          - Services live in `src/services/<name>/service.ts` (defineService); modules declare them via `services: ['name']` and use typed `ctx.services.<name>`.
          - Tests are co-located next to the code they test; handlers are tested with `runHandler` from `../../core/testing.ts`.
          - Every handler has a `description` (feeds /help).
          - Handlers are pure functions: `run(ctx)` returns a `Result`; the core delivers it. No `ctx.client`.
          - Code follows TypeScript + bun conventions; no commented-out dead code; no debug leftovers.
          - Also look for real bugs: undefined variables, wrong option types, broken boundaries, missing error handling in changed code.

          Step 3 — Submit the verdict. Run exactly one of these as your final action:
          - If the code complies with all standards and has no real issues, run:
            `gh pr review $PR_NUMBER --approve`
          - If there are violations, run:
            `gh pr review $PR_NUMBER --request-changes --body "<numbered list of concrete findings, each with file path and line number, referencing the specific standard violated>"`

          Rules:
          - Do NOT modify any files. Do NOT commit, push, merge, close, or comment on the PR.
          - Do NOT approve if there are real violations; do NOT request-changes for trivia that does not violate the documented standards.
          - The verdict is the ONLY gh pr review command you run. After it, reply with a one-line summary only.
          PROMPT_EOF
          )
          opencode run --auto -m opencode/deepseek-v4-flash-free --title "review PR #$PR_NUMBER" "$PROMPT"
```

- [ ] **Step 2: Validate YAML syntax**

Run: `bunx yaml-lint .github/workflows/opencode-review.yml` (or `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/opencode-review.yml'))"`)
Expected: no error.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/opencode-review.yml
git commit -m "ci(opencode): auto-review pull requests"
```

---

### Task 3: Create `.github/workflows/opencode-issue-triage.yml` (issue triage)

**Files:**
- Create: `.github/workflows/opencode-issue-triage.yml`

**Interfaces:**
- Consumes: secret `BOT_PAT`, secret `OPENCODE_API_KEY` (Task 1).
- Produces: on every opened issue, a triage comment + label (and possibly a closed wontfix issue or an `agent-ready` PR fix). Consumed by humans/agents via the issue tracker.

- [ ] **Step 1: Write the workflow file**

Create `.github/workflows/opencode-issue-triage.yml`:

```yaml
name: opencode-issue-triage

on:
  issues:
    types: [opened]

jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1
          token: ${{ secrets.BOT_PAT }}

      - uses: oven-sh/setup-bun@v2

      - name: Install opencode
        run: curl -fsSL https://opencode.ai/install | bash

      - name: Triage issue
        env:
          OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}
          GH_TOKEN: ${{ secrets.BOT_PAT }}
          OPENCODE_PERMISSION: '{ "bash": { "*": "deny", "gh*": "allow" } }'
          ISSUE_NUMBER: ${{ github.event.issue.number }}
        run: |
          export PATH="$HOME/.opencode/bin:$PATH"
          PROMPT=$(cat <<'PROMPT_EOF'
          A new issue #$ISSUE_NUMBER has been opened in the repo pyw0w/brik. You are the autonomous triager. You MUST use the number from the environment variable ISSUE_NUMBER ($ISSUE_NUMBER) for every gh command.

          Step 1 — Read the issue:
          Run `gh issue view $ISSUE_NUMBER --comments` to read the full thread.
          If the issue already carries one of the triage labels (`triage`, `info-needed`, `agent-ready`, `human-ready`, `wontfix`), stop immediately and do nothing more.

          Step 2 — Understand the code:
          Read `AGENTS.md`, `docs/llm.md`, `docs/agents/issue-tracker.md`, and `docs/agents/triage-labels.md`.
          Inspect the relevant code (`src/modules/**`, `src/services/**`, `src/core/**`) to understand the issue.

          Step 3 — Triage per the repo's conventions. Pick ONE label and act:
          - `info-needed` — not enough detail to act. Comment with specific clarifying questions (what input, what output, what failure). Apply label `info-needed`.
          - `agent-ready` — full specification, clear scope, enough data. Comment with a short analysis (what the issue is, where in the code it lives, how you would fix it). Apply label `agent-ready`. You MAY then create a PR fix (see Step 4).
          - `human-ready` — requires human implementation that cannot be automated. Comment explaining why. Apply label `human-ready`.
          - `wontfix` — out of scope, duplicate, or will not be implemented. Comment with the reason, apply label `wontfix`, and close the issue (`gh issue close $ISSUE_NUMBER`).
          - `triage` — genuinely cannot decide. Apply label `triage` and leave it open.

          Apply a label with: `gh issue edit $ISSUE_NUMBER --add-label "<label>"`

          Step 4 — PR fix (ONLY for agent-ready issues):
          If the issue is clearly `agent-ready` and small enough to implement confidently:
          1. Create a branch: `git checkout -b fix/issue-$ISSUE_NUMBER`
          2. Implement the fix following the repo conventions (modules import only `../../core/index.ts`; co-located tests; handler `description`; pure handlers).
          3. Verify: `bun install --frozen-lockfile`, `bun test`, `bun run typecheck`, `bun run check:boundaries`, `bun run docs:build` — all must pass.
          4. Commit and push: `git add -A && git commit -m "fix: <short description>" && git push -u origin fix/issue-$ISSUE_NUMBER`
          5. Open the PR: `gh pr create --title "fix: <short description>" --body "Fixes #$ISSUE_NUMBER" --base main --head fix/issue-$ISSUE_NUMBER`
          Do NOT open a PR if you cannot make the checks pass or the fix is not confident. Do NOT open PRs for `info-needed`, `human-ready`, `wontfix`, or `triage` issues.

          Rules:
          - Do NOT merge any PR, do NOT close issues except wontfix.
          - Do NOT edit files or run git commands except the ones needed for a PR fix.
          - Do NOT add a comment if the issue already has a triage label.
          - Reply with a one-line summary of what you did.
          PROMPT_EOF
          )
          opencode run --auto -m opencode/deepseek-v4-flash-free --title "triage issue #$ISSUE_NUMBER" "$PROMPT"
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/opencode-issue-triage.yml'))"`
Expected: no error.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/opencode-issue-triage.yml
git commit -m "ci(opencode): auto-triage issues"
```

---

### Task 4: Delete `auto-approve.yml` and verify workflows run on a test PR

**Files:**
- Delete: `.github/workflows/auto-approve.yml`

**Interfaces:**
- Consumes: Task 2 workflow file.
- Produces: a merged PR containing the two workflows and the removal of auto-approve; proof that `opencode-review` approves clean PRs.

- [ ] **Step 1: Delete the auto-approve workflow**

```bash
git rm .github/workflows/auto-approve.yml
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "ci: remove auto-approve bot, opencode reviews instead"
```

- [ ] **Step 3: Create a branch and push**

The `main` branch is protected (requires 1 review + `test` check). Since opencode-review workflow only exists in the branch, it will run on the branch's own PR (it uses the `pull_request` event, which reads the workflow file from the PR's merge ref — same behavior as `test.yml` today).

```bash
git checkout -b chore/opencode-review
git push -u origin chore/opencode-review
```

Expected: branch pushed.

- [ ] **Step 4: Open the PR and verify opencode-review runs**

```bash
gh pr create --head chore/opencode-review --base main --title "ci(opencode): review PRs and triage issues" --body "Adds opencode as sole PR reviewer and issue triager; removes auto-approve bot."
```

Expected: PR opened. Wait up to ~3 minutes. Check runs:

```bash
gh pr checks <number>
gh run list --limit 5
```

Expected:
- `test` check → pass (bun pipeline).
- `opencode-review` check → success; the PR has a review from `OCode-Bot` with state `APPROVED` (the PR adds clean workflow files, so it should be approved):

```bash
gh pr view <number> --json reviews,mergeStateStatus --jq '{reviews: [.reviews[] | {author: .author.login, state: .state}], mergeStateStatus}'
```

Expected: reviews contains `OCode-Bot`/`APPROVED`, `mergeStateStatus` = `CLEAN`.

- [ ] **Step 5: If the review is APPROVED, merge the PR**

```bash
gh pr merge <number> --merge --delete-branch
```

If the review is `CHANGES_REQUESTED`, fix the findings, push, and re-check until it approves. If the review workflow failed (red check), inspect `gh run view <run-id> --log` and fix the workflow, push again.

- [ ] **Step 6: Confirm auto-approve is gone from main**

```bash
ls .github/workflows/ && gh workflow list
```

Expected: only `test`, `opencode-review`, `opencode-issue-triage`; no `auto-approve`.

---

### Task 5: End-to-end verification of review verdicts and issue triage

**Files:**
- None (test artifacts only; remove them after).

**Interfaces:**
- Consumes: merged workflows from Task 4.
- Produces: evidence that opencode approves clean PRs, requests changes on broken PRs, and triages issues.

- [ ] **Step 1: Verify APPROVE on a clean change**

```bash
git checkout main && git pull --ff-only
git checkout -b chore/oc-e2e-clean
printf 'test' > .e2e-marker && git add .e2e-marker
git commit -m "ci: e2e clean marker"
git push -u origin chore/oc-e2e-clean
gh pr create --head chore/oc-e2e-clean --base main --title "ci: e2e clean marker" --body "temp"
```

Expected: after ~2 min, `gh pr view <n> --json reviews` shows `OCode-Bot`/`APPROVED` and mergeStateStatus `CLEAN`.

- [ ] **Step 2: Verify REQUEST_CHANGES on a violating change**

```bash
git checkout -b chore/oc-e2e-violate
mkdir -p src/modules/badmodule
printf 'import { client } from "discord.js";\nexport default {};\n' > src/modules/badmodule/module.ts
git add src/modules/badmodule/module.ts
git commit -m "ci: e2e violating marker"
git push -u origin chore/oc-e2e-violate
gh pr create --head chore/oc-e2e-violate --base main --title "ci: e2e violating marker" --body "temp"
```

Expected: after ~2 min, `gh pr view <n> --json reviews` shows `OCode-Bot`/`CHANGES_REQUESTED` (the module imports `discord.js`, violating the boundary rule).

- [ ] **Step 3: Close and clean up the two e2e PRs and branches**

```bash
gh pr close <clean-pr> --comment "e2e cleanup"
gh pr close <violate-pr> --comment "e2e cleanup"
gh api -X PATCH repos/pyw0w/brik/branches/main/protection/required_pull_request_reviews --input /dev/stdin <<'EOF'
{ "required_approving_review_count": 0 }
EOF
# after both PRs are closed (no push happens), restore:
gh api -X PATCH repos/pyw0w/brik/branches/main/protection/required_pull_request_reviews --input /dev/stdin <<'EOF'
{ "required_approving_review_count": 1 }
EOF
git checkout main
git branch -d chore/oc-e2e-clean chore/oc-e2e-violate
git push origin --delete chore/oc-e2e-clean chore/oc-e2e-violate
git pull --ff-only
```

> Note: closing PRs never pushes to `main`, so the temporary `required_approving_review_count: 0` is only needed if a merge is attempted. If you only close the PRs, skip the protection dance entirely.

- [ ] **Step 4: Verify issue triage on an info-needed issue**

```bash
gh issue create --title "E2E triage test: describe module feature" --body "I want a new module but I'm not sure. Please ask me for details."
```

Expected: within ~2 min, the issue gets a comment from `OCode-Bot` asking clarifying questions and the label `info-needed`:

```bash
gh issue view <n> --json labels,comments --jq '{labels: [.labels[].name], comments: [.comments[].body]}'
```

- [ ] **Step 5: Verify issue triage on an agent-ready issue and clean up**

```bash
gh issue create --title "E2E triage test: wontfix" --body "Implement a cat food dispenser for the Discord bot." --label "wontfix"
```

Expected: `wontfix` issue stays untouched (already labeled) — confirms the "don't touch labeled issues" guard.

Then create a genuinely fixable agent-ready issue and expect `agent-ready` + a PR (if opencode is confident):

```bash
gh issue create --title "E2E triage test: markdown link in /help" --body "The /help output should render descriptions as a bulleted list with a Markdown link to the docs. Add a module-level constant and reuse it in the handler."
```

Expected: issue gets `agent-ready` and possibly a PR `fix/issue-<n>`. Verify and then close the test issues:

```bash
gh issue close <n> --comment "e2e cleanup"
```

- [ ] **Step 6: Final state check**

```bash
git status --short
gh api repos/pyw0w/brik/branches/main/protection --jq '{review_count: .required_pull_request_reviews.required_approving_review_count, enforce_admins: .enforce_admins.enabled, contexts: .required_status_checks.contexts}'
```

Expected: clean working tree; review_count 1; enforce_admins true; contexts `["test"]` (workflow files don't add required checks).
