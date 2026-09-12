---
name: doc-rot-review
description: Repo-wide review of every tracked file for accuracy, relevance, placement and DRY-ness, run as a read-only agent team, consolidated into one prioritised report, then (only when asked) applied. Use whenever the user says "doc rot", "doc-rot review", "review the repo for rot", "is this still accurate", "fresh no-rot repo", "should this be checked in", "what is stale / duplicated / in the wrong place", "audit the docs", or wants the repo tidied before a release or a handoff. Also use for one directory ("doc-rot review docs/spec"). Do NOT use for a code-quality or bug review (that is /code-review or /polish-loop); this skill hunts rot, not defects.
---

# Doc-rot review

A repo accretes rot in five shapes: **stale** (says X, code does Y), **duplicate** (the same fact
in two places, drifting), **misplaced** (a status line in a spec, a spec in a runbook), **dead weight**
(one-off scripts, exports, sheets that already ran) and **should-not-be-tracked** (generated output,
binaries, scratch). This skill finds all five across the whole tree with a parallel, strictly
read-only agent team, and produces one report the maintainer can act on. Applying the report is a
separate, explicitly requested phase.

```
0. Guardrails            ← read-only, peers, conventions
1. Inventory             ← every tracked file: date, commits, bytes; untracked list
2. Lanes                 ← disjoint file sets, one agent each, models sized to the lane
3. Consolidate           ← one table, dedupe, re-rank, cross-lane insights
4. Report                ← the deliverable (artifact + scratch file); nothing changed yet
5. Apply (on request)    ← smallest safe moves first, tests green, three-writes close
6. Refresh this skill    ← new rot signatures go in the checklist below
```

## Step 0 — Guardrails (do these before spawning anything)

1. **Read the conventions the repo judges itself by.** Here: `CLAUDE.md`, `docs/README.md`,
   `docs/archive/README.md`, `docs/manual/README.md`, `docs/site/FORMAT.md`, and the mechanical
   guard `mcp/tests/test_docs_hygiene.py` (what is ALREADY enforced is not a finding; what it misses is).
   Distil them into a short "conventions" paragraph that every lane prompt carries verbatim.
2. **Concurrent sessions.** `ListAgents`; message every busy peer session on this repo asking (a) which
   modified/untracked files are theirs, (b) which docs they are actively rewriting, (c) whether they will
   commit in the next hour. Check `git worktree list` too: a peer in its own worktree does not own the
   main tree's edits. Do not wait for replies to start the lanes; fold the replies into consolidation
   (in-flight work is never "rot"; untracked scratch that belongs to a peer is theirs to delete).
3. **Read-only, said explicitly.** Every lane prompt says: no file edits, no repo scripts (`.sh`, `.py`,
   `.mjs`, `npm`, `python -m`, tests — bench scripts touch real hardware), no state-changing git. A
   reviewer once ran `setup-mac.sh` and overwrote `~/.zshrc`. Allowed: `git log/blame/show/ls-files/
   status/diff`, `grep`, `wc`, `find`, `cat`, `sed -n`, `du`, and `python3 -c` with `ast` for parsing only.
4. **The working tree is reviewed as-is**, and every finding on a modified/untracked file says so.

## Step 1 — Inventory

One shell pass, saved to the scratchpad, gives every lane the same ground:

```
git ls-files | wc -l
git ls-files | awk -F/ 'NF>1{print $1"/"$2}' | sort | uniq -c | sort -rn
git ls-files | grep -v -E '^(<bulk dirs: tests, captures, shots, www, src>)' | while read f; do
  echo "$(git log -1 --format=%as -- "$f") $(git log --oneline -- "$f" | wc -l) $(wc -c <"$f") $f"; done | sort
git status --porcelain
```

Read the inventory for shape before splitting lanes: which dirs are big, which files have one commit
and an old date (one-offs), which have 100+ commits (living, but check size), what is untracked.

## Step 2 — Lanes

**Disjoint file sets**, each small enough to actually read (~15–40 files or ~500 KB), grouped by
*what they are judged against*, not by directory:

| lane | judged against | model |
|---|---|---|
| root + tooling + hardware (README/CLAUDE/AGENTS/CONTRIBUTING, dotfiles, skills, hardware/) | the paths and commands they cite | opus |
| status layer + runbooks + bench sheets (HANDOFF, FOLLOWUPS, triage, log, gotchas, field-*, bench-*) | the repo's own status rules; the log; CLI flags | opus |
| design docs + ADRs + vision + site docs | spec/, code, HANDOFF | opus |
| spec of record + API contract + component READMEs | `api.py`, `types.py`/`types.ts`, `engine.js`, argparse, package.json scripts | opus |
| manual + platform pages + site generator | protocol/, reference/, the build's own rules | opus |
| protocol + reference + data | the log, HANDOFF retractions, the manual | opus |
| archive | inbound links from the living tree; git history | sonnet |
| bench scripts / one-off tools | CLI subcommands, bench_common, FOLLOWUPS ids | sonnet |
| main package + tests | import graph, docstring ids vs closed followups, golden files | opus |
| phone app | package.json scripts, .gitignore, spec/node.md | opus |
| web UI | types.py, the mock's Python twin, image ↔ catalog ids | opus |

Sonnet is enough where the lane is an inventory with a rubric (archive, scripts); judgment lanes get
opus. Spawn all lanes in ONE tool-use block. Give each lane:

- the conventions paragraph and the read-only rules (verbatim);
- its exact file list, with sizes for the big ones;
- **verification tasks, not reading tasks**: "pick 10 commands and compare the three copies",
  "enumerate routes in API.md and in api.py, diff them", "grep each image basename in src", "extract
  every id from both files and intersect";
- the five questions per file: should it be tracked · accurate today (cite the contradicting
  file:line) · still relevant or archive/delete · DRY (name the canonical home) · right place/size
  (split/merge/move/rename);
- the output contract below, written to `<scratchpad>/findings/<lane>.md` AND returned.

Output contract (identical for every lane, so consolidation is a concatenation):

```
# Lane: <name>
## Critical insights        (3–6 bullets, each with evidence)
## Findings                 | sev | path | problem | evidence | recommended action |
## Reviewed and fine        (one line per file → proves coverage)
```

`sev`: **P1** stale and actively misleading (a doc that recruits the next reader into a wrong belief,
a hazard, a contract drift) · **P2** rot, duplication or wrong place · **P3** tidy.
`problem`: one of stale / duplicate / dead / misplaced / should-not-be-tracked / split / merge /
delete / archive / rename / hazard / content-lost.

## Step 3 — Consolidate

1. `cat findings/*.md` into one table. Dedupe: two lanes will both find the doc that duplicates
   another lane's file; keep one row, cite both.
2. **Re-rank across lanes.** A lane's P1 is a P1 for that lane; the repo-level P1s are the ones that
   would make the *next agent* do the wrong thing (a runbook flag that no longer exists, a spec route
   that was never built, a retracted reading still in the ground-truth file).
3. Find the **cross-lane insights** a single lane cannot see: the same fact in four files across four
   lanes (weapons numbers in weapon-design, reference/weapons, weapons.json, demo-catalog.js); a
   "status" layer that has re-grown outside the three status files; a whole directory whose only
   inbound links are from itself.
4. Subtract the peers' in-flight work.
5. Coverage check: every tracked file appears in some lane's Findings or Reviewed-and-fine. List the
   gaps honestly.

## Step 4 — Report (the deliverable)

Publish as an artifact (the audience is the maintainer over several sittings) and keep the markdown
in the scratchpad. Shape:

- **Headline numbers**: files reviewed, P1/P2/P3 counts, bytes that could leave the tree.
- **Critical insights** (≤ 8): the cross-lane findings, each with evidence and the fix in one line.
- **The move list**, grouped by action (delete · archive · move · merge · split · fix-stale ·
  untrack · guard-with-a-test), each row: path → action → why (evidence) → blast radius (inbound links,
  tests, the site build). Order within a group: smallest blast radius first.
- **What is fine** (so nobody re-reviews it next month).
- **Guards to add**: every finding class that a 20-line test could have caught goes here
  (the repo already has `test_docs_hygiene.py` as the home).

Nothing is changed in this step. Say so in the message.

## Step 5 — Apply (only when the user asks)

- Work from the move list, smallest blast radius first: untrack/delete → archive → move+fix links →
  merge → fix-stale text → split.
- **Concurrent sessions share one git index** here: `git commit --only <paths>` for every commit;
  never `git add -A`.
- After every group: see CLAUDE.md → Environment for the four suites — run the Python suite
  (link/stamp/id guards) always, and the site suite too if `docs/manual/` or `docs/platform/` moved.
- A file that leaves the living tree because its work ran goes to `docs/archive/` with its name kept;
  its FOLLOWUPS ids get one dated line in `docs/archive/followups-closed.md`. Deleting is for
  scratch, generated output and one-off tool exports that git history already holds.
- Close the session with the three writes (log entry · FOLLOWUPS diff · HANDOFF replacement).
- **Then run `polish-loop` over the apply commits before calling the pass done.** A cleanup pass writes its
  own rot (dated breadcrumbs, "GENERATED" headers that outrun the generator, a hedge pasted four times, a guard
  that cannot fail); on 2026-09-12 three review rounds found ~25 such items in the apply commits themselves.
- Push a subagent per disjoint group (sonnet for mechanical moves); keep design decisions and
  commits in the main session.

### Apply-phase lessons (2026-09-12, eight lanes, ten commits)

- **Ownership must be exclusive and written down.** Give each lane a "files this lane OWNS" list
  and name the other lanes' files it must not touch; two lanes still both edited `bench-queue`,
  `VISION.md`, `session-findings` and `gotchas.md`. Sequential edits in one working tree do not
  conflict in git, but a lane's `Write` can clobber another's edit, so tell every lane to re-read
  right before writing and to keep shared-file edits line-level.
- **The peer's dirty set is authoritative, and it moves.** Have every lane run `git status
  --porcelain` itself at start and treat that list as off-limits; a file that was clean at review
  time (`webapp/mc/README.md`, `client.test.ts`) was dirty by apply time and the lane correctly
  skipped it. Route the skipped items to the deferred list, not to a retry.
- **`git commit --only <new file>` fails until the path is known**: `git add <exact path>` first,
  then `--only` the same paths. `--only <dir>` picks up tracked changes under it and ignores
  untracked files there, which is the safe default when another lane is creating files nearby.
- **A "one-off" can be a library.** The inventory classed `f11_ab.py` as a closed experiment; it
  was imported by 18 scripts. Before deleting any script, grep for `from <name> import` and
  `import <name>`, not just the basename in docs.
- **Lanes cannot touch the three status files** (HANDOFF, FOLLOWUPS, log): every lane writes its
  closed lines, new rows and repoints to `scratchpad/status-writes/<lane>.md`, and the main session
  applies them once, after the peer's close has landed. Same for `docs/README.md`.
- **Expect two red tests mid-pass** and know why: the link check goes red while sheets move and the
  index has not caught up; the shots guard goes red on a dirty UI tree. Both must be green before
  the close.
- **A lane will find the review was wrong** (objective time IS sent; the two "exclusive" reference
  facts were already in the manual). Ask each lane to re-verify evidence before editing and to report
  contradictions rather than obey the brief.
- **Model choice held**: sonnet was enough for prune, tools, root and webapp; the four lanes that
  had to rewrite prose against code (move, manual, design, guards) needed opus.

## Step 6 — Refresh this skill

Every run finds a rot shape this checklist does not name. Add it below with a one-line example.

## Rot signatures checklist (grows per run)

Mechanical checks a lane should run before reading anything. Each line names a shape found on a
real run; the 2026-09-12 run (625 files, ~200 findings, ~55 P1) added everything below the first
group.

- **A retraction lands in one file of a pair.** For every "retracted / corrected / CLOSED / now
  suspect" line in HANDOFF, the log and FOLLOWUPS, grep the retracted phrase across the tree; a
  hit outside the file that carries the correction is a P1. The public mirror (`docs/manual/`) is
  the usual survivor.
- **A file that says it is a publish of another** ("built from", "one-way") and has no generator or
  diff test: compare ten rows.
- **Nine status snapshots outside the three status files**: grep `Status:`, `not built`, `roadmap`,
  `at amendment A\d+`, `becomes .* on sign-off`, `Honest gaps`, per-mode status tables. Each is
  behind the code, never ahead.
- **A "GENERATED from X" header with no generator in the repo**: `grep -rl GENERATED`, then look
  for the script; compare six values, not ids.
- **Ids cited as authority but defined only in the archive** (F11 in 13 living files).
- **A ratified index row citing a symbol that does not exist**: for each amendment/ADR row, grep
  the function, route or constant it names.
- **Wire kinds specified but absent from a validator whitelist** (`MC_KINDS`, twice already).
- **Two fake backends and a hand-ported twin** (`fakes.py` / `mock/backend.ts` / `stage.py`): list
  the behaviours of each and the guard between them; a six-case mirror test is not a mirror.
- **Three engines for one rule set**: same-fix-three-places commits (`git log --stat` for commits
  touching `modes/`, `mc/` and `app/src` together) are the tell.
- **A `.bat`/shell launcher for an architecture that moved** (MC on the Windows venv).
- **Personal shell config in a public repo**, and a script that `cp`s over `~/.zshrc`.
- **Memory-file slugs (`[[name]]`) leaking into repo docs.**
- **Guards that read `HEAD` while the tree is dirty**, count lines while bytes grow, or walk one
  directory while the stale paths live in another.
- **Sheet-relative test names** (`test_mc_block_b.py`) and rung labels that collide with register
  ids (`A1 B1 B2` in three sheets).
- **Byte-identical asset directories** described as "downscaled copies" (md5 three files).
- **The same product under four names on the public site** (grep the app's name variants).
- **An index table that stopped at a date** (the log index, the FOLLOWUPS lane index).

Original list:

- **Generated output tracked**: a `.md` "generated from" a tracked `.json`; `www/` build output;
  screenshots not in the manifest. `git ls-files` × `.gitignore` × "generated" in the header.
- **Orphan assets**: image basenames with no grep hit in `src/`; captures no doc names;
  fixtures no test loads.
- **Two copies of one catalog**: weapon/mode/sound tables in a `.json`, a `.md`, a `.js` and a
  `.tsx` mock. Pick six numbers and compare.
- **Two fake backends**: a Python fake and a TS mock of the same server, no drift guard.
- **The status layer re-grows**: any file outside HANDOFF/FOLLOWUPS/log carrying "open", "TODO",
  "not yet", "as of 2026-", a "status per X" table; bench sheets whose ids all appear in the log.
- **Closed ids in comments**: `F\d+|S\d+|A\d+` in code/docs comments ∩ `followups-closed.md`.
- **Stale runbook commands**: every `--flag`, `npm run x`, `python -m y z`, port and path in a
  runbook, grepped against argparse / package.json / the code.
- **Contract drift**: routes in API.md vs `api.py`; fields in `types.ts` vs `types.py`; messages in
  `contracts.md` vs `envelope.*`.
- **Retracted readings still in ground truth**: HANDOFF/log "retracted"/"CLOSED" items grepped in
  `protocol/brx-protocol.md` and `docs/manual/`.
- **One-off scripts**: a script with 1–2 commits whose docstring names a question that FOLLOWUPS
  has since closed, or that duplicates a CLI subcommand.
- **Personal files in a public repo**: dotfiles, machine paths, sticker ids, `~/` logs.
- **Archive with inbound links**: the hygiene test's link check means an archived file cannot be
  deleted while a living file links it; grep first.
- **Three "start here" pages**: root README, docs index and the landing all orienting the same
  reader; one should own it and the others point.
