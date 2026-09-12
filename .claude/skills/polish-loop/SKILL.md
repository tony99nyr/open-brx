---
name: polish-loop
description: Iterative team-review-then-fix workflow. Spawns 2-3 parallel agents (different lenses — correctness, security, UX) to critique recent code changes, consolidates findings, fixes every Critical/High/Medium severity item, validates the build, then runs a fresh review pass and repeats until a clean pass or 3 iterations. Use this skill whenever the user says "polish loop", "polish-loop", "review-fix loop", "team review and fix", "critical review then fix all medium and up", "review with an agent team and fix issues", or any iterative-review-then-fix phrasing. Common trigger context — after shipping a feature, before committing, after a substantial diff. Do NOT substitute a single review pass for this — the iterative loop is the point. If the user passes a scope hint as an argument (e.g., "/polish-loop the last 3 commits"), respect it; otherwise infer scope from git state.
---

# Polish Loop

A workflow that hardens recent changes by spawning a parallel review team, fixing the medium-and-up findings, and repeating until clean.

## What it does

```
1. Identify scope          ← what to review
2. Spawn parallel agents   ← 2-3 lenses, single tool-use block
3. Consolidate findings    ← apply severity rubric strictly
4. Fix Critical/High/Medium ← Low items get noted, not fixed
5. Validate                ← typecheck/lint/tests
6. Loop                    ← fresh review pass; stop when clean or 3 iters
7. Wrap up                 ← summarize + (optionally) commit
```

The loop is the point. Don't collapse to a single review pass.

## Step 1 — Determine scope

In priority order:

1. **Explicit user scope** — if they said "the last 3 commits" or "the auth refactor", use that.
2. **Uncommitted changes** — if `git status` shows pending edits, default to those (`git diff` for staged + unstaged).
3. **Recent commits** — if the working tree is clean, default to commits since the last review point. Heuristic: commits since `main` if on a feature branch; otherwise commits since the most recent commit whose message starts with "Log * review", "Polish round", or similar marker. If unclear, ask the user once.

State the scope explicitly before spawning agents — wasted agent runs are costly.

## Step 2 — Spawn the review team in parallel

Pick 2-3 lenses based on what changed. **Use a single tool-use block with multiple Agent calls** so they run in parallel.

> **No spawn tool?** (Codex, Cursor, a plain chat session.) Run the same lenses yourself, one after another, each as a
> fresh read of the diff with that lens's prompt; keep the findings in a scratch file instead of `TaskCreate`/`TaskUpdate`.
> The loop and the severity rubric are the point, not the parallelism.

### Pick lenses based on what changed

| Lens | Include when |
|---|---|
| **Correctness + types + edge cases** | Always for code changes |
| **Security** | Auth, sessions, env vars, CSP, OAuth, HMAC, redirects, user input parsing, API keys |
| **UX + a11y + visual** | UI changes (HTML/JSX/CSS, route file rendering, layout, copy) |

For pure refactors with no UI/security surface, two lenses (correctness + one focused on the refactor's risk area) is enough. Don't spawn lenses with nothing to look at.

### Per-agent prompt template

Adapt this for each lens. Each agent should be self-contained — it walks into the room cold.

```
You are doing a {lens} review of recent changes.

**Repo:** {absolute path}
**Range:** {commits a..b, or "uncommitted diff"}

**Context:** {1-2 paragraphs of business + technical context the agent
needs to evaluate fairly. What is this code? Who uses it? What's
already known to be deferred / out of scope?}

**Files in scope:**
{paths, one per line}

**Investigate:**
1. {specific concern}
2. {specific concern}
... (5-10 specific things, not generic)

**Severity rubric — apply STRICTLY, do not inflate:**
- Critical: breaks core functionality OR exploitable security hole
- High: silent data loss / silent failure / a11y blocker for some users
- Medium: notable issue worth fixing now
- Low: nit / polish / preference / "could be more general"

When in doubt, downgrade.

**Output format:**

# {Lens} Review

## Critical
- file:line — description — one-line fix

## High
- ...

## Medium
- ...

## Low / nits
- ...

## What's solid
- 2-3 lines on what's well-done

Cap at ~600 words. Be specific (file:line). Don't generate fixes longer
than one line. Don't echo any secrets you read while inspecting .env.
```

### Why parallel matters

Each agent runs in its own context with no shared memory. Spawning them in one tool-use block runs them concurrently — typically 30-90s vs 3x that sequentially.

## Step 3 — Consolidate findings

When all agents return:

- **Merge** Critical / High / Medium across lenses
- **Dedupe** — multiple agents often flag the same thing
- **Apply the rubric a second time** — if a "Critical" reads like a nit, downgrade it. Agents inflate; you don't have to honor that.
- **Spot-check** uncertain findings against the actual code (read the file, verify the issue is real)

Use `TaskCreate` to track each finding you'll fix, so the user can see progress in the harness (no task tool: the scratch file from Step 2's fallback).

## Step 4 — Fix the Critical/High/Medium items

For each:

- Apply the fix (typically a few lines per item)
- Don't bundle unrelated changes or refactor beyond the finding — scope creep here turns a tight loop into a sprawl
- **Skip Low** — note them in a TODO comment, the project's followups doc, or a memory entry, but don't fix them in the loop. The loop is for things that matter; Low items are for the next dev session

`TaskUpdate` (or tick the scratch file) each item completed as you go.

## Step 5 — Validate

After the fix pass, run validation appropriate to the project. Detect by repo files at the root:

| Repo signal | Validation commands |
|---|---|
| **This repo** (Open BRX) | `cd mcp && python3 run_tests.py` (Python server + Mission Control); `cd webapp/mc && npm test` (+ `npm run e2e`/`npm run e2e:m2` for a UI change) (Mission Control web UI); `cd app && npm test` (phone app); `cd site && npm test` (public site, needs `cd app && npm run build` first) |
| `package.json` with `pnpm-lock.yaml` | `pnpm typecheck`; `pnpm test` if it exists and changes touched tested behavior; `pnpm lint` if clean (skip if pre-existing failures) |
| `package.json` with `package-lock.json` | `npm run typecheck`; same logic |
| `package.json` with `yarn.lock` | `yarn typecheck`; same logic |
| `pyproject.toml` or `requirements.txt` | `pytest` if tests exist; `mypy` if configured; `ruff check .` if configured |
| `go.mod` | `go build ./...`; `go test ./...` if tests touched |
| `Cargo.toml` | `cargo check`; `cargo test` if tests touched |

If validation fails: fix, re-run, then proceed. Don't move to the next iteration with a broken build.

If a dev-browser MCP / Playwright session is available **and** UI changed: take a screenshot to verify visual changes look right. (For UI changes specifically, the validation isn't complete without an eyeball check.)

## Step 6 — Loop or stop

Spawn another fresh review pass (Step 2) to catch issues the fixes might have introduced and to converge on quality.

**Stop conditions (any one):**

- The new pass returns **no Critical / High / Medium findings** (only Low or "What's solid")
- **3 iterations** have completed (hard cap — diminishing returns past this)
- The user signals to stop

Each iteration's agents run in fresh contexts — they re-read code from scratch, so previous fixes are evaluated independently. This catches both "did the fix work?" and "did the fix introduce something new?"

## Step 7 — Wrap up

Summarize:

- **What was fixed** (per iteration if it took more than one)
- **What was deferred to Low** (and where it's noted)
- **Non-obvious decisions** — e.g., "downgraded a Critical to Medium because the agent misunderstood the auth context"
- **Validation status** — clean? Pre-existing lint failures noted?

If the user asked for commit/push:

- One commit per iteration is usually overkill. Squash the loop into one commit unless iterations addressed clearly distinct concerns.
- Commit message: lead with what was fixed, mention reviewer team if relevant, follow the project's commit style.

If validation didn't pass cleanly, surface that loudly — don't bury it in a wrap-up paragraph.

## Severity rubric — apply conservatively

Agents inflate severity. Be skeptical. Apply this rubric strictly:

| Severity | Means | Examples |
|---|---|---|
| **Critical** | Breaks core functionality OR exploitable security hole | HMAC short-circuit, page crashes on first load, action mutates the wrong record, secret leaked to client, page renders 500 for valid users |
| **High** | Silent data loss / silent failure / a11y blocker | Quantity field user-mutable in devtools and silently overwrites stock, auto-decimal-points truncating money, focus rings missing on a primary button |
| **Medium** | Notable issue worth fixing now | API contract drift (type mismatch), missing safeguard the bulk endpoint honors, color inconsistency that confuses users at a glance, validation gap that allows obviously bad input |
| **Low** | Nit, preference, polish | Variable naming, "could be more general", missing JSDoc, CSS class organization, unused-but-imported types |

**When in doubt, downgrade.** A loop that exhausts itself fixing nits is a loop that wastes the user's time and trust.

## When NOT to invoke this skill

- **Single-file question** — "review this file" is a one-shot read, not a loop
- **Architectural decisions** — those need synthesis, not a fix-the-issues loop
- **Design / direction questions** — "should I use X or Y?" is a different conversation
- **Tiny changes** — a one-line typo fix doesn't need a 3-agent team

For those, do the right tool directly. Reserve the loop for substantive changes that benefit from fresh adversarial eyes.

## Common pitfalls

- **Spawning agents sequentially when you HAVE a spawn tool** — defeats the parallelism. One tool-use block, multiple Agent calls. (Without one, sequential passes are the documented fallback, not this pitfall.)
- **Honoring inflated severity** — agents will mark style preferences "Critical". Push back.
- **Bundling fixes with refactors** — the loop is for findings, not for "while I'm in here let me also..."
- **Fixing Low items in the loop** — surface them, don't fix them. They're noise; the user can pick what they want next session.
- **Running >3 iterations** — past the cap, the work is broader-rework territory, not loop territory.
- **Skipping validation** — the loop is incomplete without a clean build/typecheck signal.
