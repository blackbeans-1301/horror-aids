# Workspace Isolation Specification

Status: proposed (2026-08-01)
Supersedes: the root layout and Archive/Delete sections of `02_LOCAL_WORKSPACE_SPEC.md`.
Story-folder layout, naming rules, JSON schemas, and status values in `02` remain authoritative and unchanged.

## Problem

Every byte of irreplaceable content in this project lives outside version control.

`.gitignore` excludes `/data/` and `/stories/`. Those two directories hold the story index, job history, cloned-voice reference clips, and 917 MB of generated segment audio — the output of hours of TTS compute. Git protects `src/` and `workers/`; it protects none of the actual product.

At the same time, the only thing that decides *which* content a process touches is its working directory:

- `src/lib/paths.ts` derives `dataRoot` and `storiesRoot` from `process.cwd()`.
- `workers/common.py` sets `project_root = Path.cwd()` and resolves `--story stories/<slug>` against it.
- `src/lib/job-runner.ts` spawns workers with `cwd: process.cwd()` and passes relative paths.

Three consequences follow, all of them observable in the repository today:

1. **No separation between experiments and product.** `stories/` currently contains `54r`, `asdfasd`, `dsf`, `fdsf`, `hehe`, `qtq`, `qtq2`, `qtqtest`, `twertew`, and `test-story-1` interleaved with real productions. Every list, every index write, and every bulk operation treats them identically.
2. **No recovery path.** There is no snapshot, no trash, no backup, and no hard-delete guard. `deleteVoice()` calls `fs.unlink` directly. A single mistaken command or one bad refactor of `json-store.ts` destroys content permanently.
3. **Coding agents operate on production by default.** Agents run in git worktrees under `.ai/worktrees/agent-*`, which have no `data/` or `stories/` of their own. An agent that starts the app there silently creates a third empty workspace; an agent that runs commands in the primary checkout is pointed straight at production content with nothing between it and `rm -rf`.

This spec defines the storage model and guardrails that fix all three, for a single-operator, local-first, macOS/APFS deployment.

## Principles

1. **Precious, disposable, and recoverable content are three different things and must live in three different places.**
2. **Environment binding is explicit and fail-closed.** A process with no declared environment does not start. It never guesses, and it never defaults to production.
3. **Nothing is ever deleted in place.** Destructive intent is expressed as a move; reclamation is a separate, explicit, offline act.
4. **Production is protected by the operating system, not by good intentions in application code.** Guards that live only in TypeScript are guards a refactor can remove.
5. **Development is cheap, marked, and disposable.** Isolation only pays off if working in dev is *easier* than working in prod.
6. **Recovery is a routine command, not an incident.** Restoring one file to a state from three days ago should take one command and no thought.

## Non-Goals

- Multi-user access control, authentication, or audit trails for other people. There is one operator.
- Cloud storage, a database, or a server deployment. The app stays local-first.
- Putting audio in git (git-lfs, git-annex). Snapshots and mirrors are a better fit for 1 GB of derived WAVs.
- Staging/CI environments beyond `dev` and `prod`. The model allows more, but only two are specified.
- Continuous replication. Backups are scheduled and explicit.

## Storage Model: Three Roots

| Root | Holds | Per-environment | Recoverable from | Location |
| --- | --- | --- | --- | --- |
| **Code root** | `src/`, `workers/`, `config/`, `docs/`, `package.json` | No — git branches serve this purpose | git | the repository checkout |
| **Content root** | `stories/`, `index.json`, `jobs.json`, `voices.json`, `voices/` | **Yes** | snapshots + offsite mirror only | `~/Content Creator/.horror-aids-data/<env>/`, outside the repository |
| **Cache root** | `models/`, `voice-preview-cache/` | No — shared by all environments | re-download / re-derive | `~/Library/Caches/HorrorAids/` |

Splitting the cache root out is what makes the rest of the design cheap. `data/` is 1.5 GB today, of which 1.5 GB is `data/models` (GGUF weights, re-downloadable) and 1.3 MB is `voice-preview-cache` (regenerable). The genuinely irreplaceable content is:

```text
stories/            917 MB   generated audio, story text, approvals
data/voices/        3.1 MB   recorded reference clips — cannot be regenerated
data/index.json     8 KB
data/jobs.json      72 KB
data/voices.json    4 KB
```

Approximately 920 MB, and 920 MB is small enough to snapshot instantly and mirror nightly. 2.4 GB with the weights included is not.

### Content root layout

```text
~/Content Creator/.horror-aids-data/prod/
  WORKSPACE.json              environment sentinel — see below
  index.json
  jobs.json
  voices.json
  voices/
    [voice-id].wav
  stories/
    [story-slug]/             layout unchanged — see 02_LOCAL_WORKSPACE_SPEC.md
  .snapshots/
    20260801T093000Z-pre-job/
    20260801T101500Z-heartbeat/
    20260801T104500Z-pre-trash/
  .trash/
    20260801T110000Z/
      stories/twertew/
      voices/old-clip.wav
  .locks/
  .backup/
    manifest.json             SHA-256 per file, per backup run
```

`.snapshots/`, `.trash/`, `.locks/`, and `.backup/` are internal to the workspace and never enumerated as stories. Story-folder internals are untouched by this spec: `story.json`, `text/`, `audio/`, `metadata/`, `logs/`, `tmp/` keep the exact shape `02` defines, so paths stored inside `story.json` remain relative and valid.

### Cache root layout

```text
~/Library/Caches/HorrorAids/
  models/
    omnivoice-gguf/
  voice-preview-cache/
```

Deleting the entire cache root must be a safe, boring operation whose only cost is a re-download. `config/app.json` model paths become cache-root-relative rather than repo-relative.

## Environment Binding

### Resolution

```text
HORROR_AIDS_ENV            required, one of: dev | prod          no default, ever
HORROR_AIDS_WORKSPACE_ROOT optional, base directory containing <env>/
                           default: ~/Content Creator/.horror-aids-data
HORROR_AIDS_CACHE_ROOT     optional, default: ~/Library/Caches/HorrorAids
```

The content root is `${HORROR_AIDS_WORKSPACE_ROOT}/${HORROR_AIDS_ENV}`.

Resolution rules:

- `HORROR_AIDS_ENV` unset, empty, or not in the allowed set → the process exits with a diagnostic naming the variable and its legal values. This applies to the Next.js server, every worker, and every CLI command.
- The `dev` content root is created on demand if missing.
- The `prod` content root is **never** created implicitly. It comes into existence only through `workspace init prod`. A missing prod root is an error, not an invitation — this is what stops a stray `HORROR_AIDS_ENV=prod` in the wrong directory from silently forking an empty parallel universe.
- Resolution happens once, at process start, and is logged as an absolute path.

`package.json` scripts set the environment explicitly so the ergonomic path is always the safe one:

```text
npm run dev      → HORROR_AIDS_ENV=dev  next dev  --port 3000
npm run start    → HORROR_AIDS_ENV=prod next start --port 3100
```

There is no code-level default. Running `next dev` bare fails, by design: an agent that invents its own start command gets an error rather than production.

### Sentinel and handshake

Each content root carries `WORKSPACE.json`:

```json
{
  "env": "prod",
  "workspaceId": "wsp_2f9c1a",
  "schemaVersion": 1,
  "createdAt": "2026-08-01T00:00:00.000Z",
  "protected": true,
  "notes": "Primary production content. Do not point dev at this root."
}
```

The handshake, performed by every process that touches a content root:

1. Resolve the root from environment variables.
2. Read `WORKSPACE.json`. Missing → error (except when auto-creating `dev`).
3. If `sentinel.env !== HORROR_AIDS_ENV`, abort before any read or write.
4. If `sentinel.schemaVersion` is newer than the code understands, abort. Older → run migration, which snapshots first.
5. Log `env`, `workspaceId`, and the absolute root path.

Step 3 is the load-bearing one. It means a dev process cannot open the prod root even if someone hand-edits `HORROR_AIDS_WORKSPACE_ROOT` to point at it, and a prod process cannot open a dev root. Mis-binding becomes a startup failure instead of a silent cross-environment write.

### Worker contract change

Workers stop deriving anything from `Path.cwd()`. `src/lib/job-runner.ts` passes the binding explicitly:

```text
python3 workers/generate_verify_tts.py \
  --workspace /Users/lapdt/Content Creator/.horror-aids-data/prod \
  --env prod \
  --cache-root /Users/lapdt/Library/Caches/HorrorAids \
  --story stories/quan-tai-quy \
  --job-id job_20260801_093000_a1b2c3 \
  --config config/app.json
```

`--story` stays relative to the workspace root, so nothing inside `story.json` changes. `WorkerContext` performs the same sentinel handshake and exits non-zero on mismatch. This closes the worktree hole directly: a worker launched from `.ai/worktrees/agent-*` reads its workspace from the flag, and its `--env dev` cannot resolve to the prod root.

### Per-environment configuration

`config/app.json` stays in the code root and under git. Environments layer on top:

```text
config/app.json          committed base
config/app.dev.json      committed dev overrides, merged over the base
config/app.prod.json     committed prod overrides
config/local*.json       gitignored machine-local overrides, merged last
```

Dev defaults are chosen to make dev fast rather than faithful: `HORROR_AIDS_FAKE_TTS=1`, fewer GGUF steps, `whisper.enabled: false`. A dev job should finish in seconds and burn no GPU time. If dev is slow, the operator will work in prod, and the isolation is worthless.

## Guardrails

Seven layers. Each one assumes the ones above it have already failed.

### L1 — Physical separation

Production content is not inside the repository. Nothing that is scoped to the repository can reach it: `git clean -xfd`, `git checkout`, branch switches, worktree creation and pruning, `rm -rf` run from the project directory, a botched `.gitignore` edit, or deleting and re-cloning the checkout.

This single change removes the majority of realistic agent accidents, because agents overwhelmingly operate with the repository as their working directory.

### L2 — Fail-closed environment binding

Covered above. No environment variable, no boot. Sentinel mismatch, no boot. Prod root never auto-created. The failure mode of every ambiguity is "refuse to run", never "assume prod".

### L3 — No hard deletes

`fs.unlink` and `fs.rm` are prohibited on content-root paths. Every destructive operation becomes a move into the trash:

```text
<root>/.trash/<utc-timestamp>/<original-path-relative-to-root>
```

Applies to: story deletion, `deleteVoice()`, voice-preview cache eviction, per-job `tmp/` and `logs/` cleanup, segment WAV replacement during regeneration (the previous WAV is trashed, not overwritten), and any migration that removes a file.

Reclamation is `workspace gc`, an explicit command with a TTL — 30 days in prod, 3 days in dev — that never runs inside a request handler and never runs on a timer without the operator opting in. `workspace restore --from-trash <path>` reverses any trash move.

A single enforced write chokepoint (`src/lib/workspace/`) exposes `resolveContentPath()`, `writeJson()`, `writeBinary()`, and `trash()`. `resolveContentPath()` throws unless the resolved absolute path is inside the active content root — the same containment check `resolveStoryPath()` performs today, lifted to cover the whole workspace. A lint rule bans `node:fs` imports outside that module, so a future refactor cannot quietly reintroduce a direct `unlink`.

### L4 — Snapshots (time travel)

This is the layer that turns "unrecoverable" into "a command".

APFS `clonefile` (`cp -Rc`) copies a directory tree by sharing blocks. A snapshot costs milliseconds and near-zero disk; only blocks changed *after* the snapshot consume space.

Measured on this machine during the Phase 0 baseline snapshot (2026-08-01), not estimated:

```text
source            914 files, 953,326,632 bytes
disk cost         0 KB (df delta before/after the clone)
integrity         914/914 files match SHA-256 against the source
restore 16 MB     0.01 s, byte-for-byte identical to the original
restore 714 MB    0.06 s, byte-for-byte identical to the original
```

A 714 MB story restores in 60 milliseconds at zero storage cost. That is what makes it reasonable to snapshot before every job rather than nightly.

Snapshots are taken automatically at mutation boundaries:

| Reason tag | Trigger |
| --- | --- |
| `pre-job` | before any worker spawn |
| `pre-approval` | before an approval flips or is reset |
| `pre-trash` | before any trash move |
| `pre-restore` | before any restore — restores are themselves reversible |
| `pre-migration` | before any schema migration |
| `heartbeat` | every 30 minutes while the app runs and the root is dirty |
| `manual` | `workspace snapshot --note "..."` |

Retention: keep everything for 7 days; one per day for 30 days; one per week for 180 days; keep pinned snapshots forever. Pruning happens in `workspace gc`.

Restore granularity is a whole root, one story, or one file:

```text
workspace snapshot list [--story <slug>]
workspace restore --story quan-tai-quy --at 20260731T2200Z
workspace restore --file stories/quan-tai-quy/text/segments.json --at latest-before 20260801T0900Z
workspace diff --at <snapshot> [--story <slug>]
```

**Every restore must finish by running `chflags -R nouchg` on the restored copy** — never on the snapshot. `cp -Rc` propagates the `uchg` flag to the clone, so restoring from a locked snapshot otherwise yields a story the app cannot write to and the operator cannot clean up. This was found empirically during the Phase 0 rehearsal (see D17); it is a footgun that only surfaces mid-incident, so it belongs in the restore path itself rather than in a runbook.

Reading a locked snapshot is unaffected — the immutable flag blocks writes and deletes, not reads. That is what makes locking snapshots viable while keeping them usable as a restore source.

Constraint: snapshots live on the same volume as the content they protect. They defeat mistakes; they do not defeat disk failure. That is L7's job.

### L5 — OS-level immutability for finished content

When a story reaches `audio_complete` (final audio approved), the app applies the macOS user-immutable flag to its folder:

```text
chflags -R uchg  <root>/stories/<slug>
```

`rm -rf` on an immutable tree fails with `EPERM` for the owner. Not "is caught by a guard" — fails at the syscall. Verified deliberately on 2026-08-01 against a throwaway locked tree:

```text
$ chflags -R uchg locktest && rm -rf locktest
rm: locktest/sub/precious.txt: Operation not permitted
rm: locktest/sub: Operation not permitted
rm: locktest: Operation not permitted
→ file contents intact; chflags -R nouchg then removes it normally
```

Unlocking is a separate deliberate command:

```text
workspace unlock <slug>     # chflags -R nouchg, snapshots first, logs the reason
workspace lock <slug>
```

Locking only at `audio_complete` keeps it out of the way of legitimate writes: a finished story has no remaining pipeline steps, so the app never needs to write to it again. Every completed production becomes progressively harder to destroy, which matches the value curve — the 723 MB `quan-tai-quy-3` is worth far more than a draft.

Interaction notes: immutable flags survive copies made with `cp -p`, are visible as "Locked" in Finder, and do not interfere with Time Machine or with reading files for video editing. `workspace verify` reports any `audio_complete` story that is unexpectedly unlocked.

### L6 — Agent hard gate

`.claude/settings.json` (currently absent — `.claude` is a symlink to `.ai/`, which holds only worktrees, so this is greenfield) gains:

- **`PreToolUse` on `Bash`**: deny any command whose text references the prod content root or `HORROR_AIDS_ENV=prod`, and deny destructive patterns anywhere — `rm -rf`, `find … -delete`, `chflags … nouchg`, `git clean`, `mv` sourced from the prod root, output redirection into it. The denial message names the reason and points at dev.
- **`PreToolUse` on `Write`/`Edit`**: deny paths under any content root. Content is data; agents change code.
- **Hook environment**: export `HORROR_AIDS_ENV=dev` so any app or worker an agent starts binds to dev even if the agent never thinks about environments.
- **`AGENTS.md`** (currently empty, 0 bytes) states the rule in prose: agents work in `dev`; touching prod content requires the operator.

L6 is deliberately last among the preventive layers. It is convention plus configuration — the weakest kind of guard, trivially bypassed by an agent that writes a script instead of a direct command. It is worth having because it catches the *common* case cheaply, but L1 and L5 are the ones that actually hold.

### L7 — Offsite copy

Snapshots and the live content share a disk. A failed SSD, a wrong `diskutil`, or a filesystem corruption takes all of it.

```text
workspace backup  --to /Volumes/HorrorBackup/prod   # mirror + SHA-256 manifest
workspace verify  --against /Volumes/HorrorBackup/prod
```

Mirror semantics: additive by default. Files absent from the source are moved to a dated `.retired/` folder in the target rather than deleted, so a bug that empties the source cannot propagate as an empty backup. The manifest records SHA-256 per file plus totals; `workspace verify` re-hashes and reports drift. Target is an external volume or a synced folder; run nightly once Phase 7 lands.

### Threat coverage

| Failure | Caught by |
| --- | --- |
| Agent runs `rm -rf` in the project directory | L1 — prod is not there |
| `git clean -xfd` / worktree prune / re-clone | L1 |
| Agent runs `rm -rf` on the prod path deliberately or by expansion | L5 (`EPERM` on finished stories), L6, L4 (restore) |
| Refactor bug in the store deletes or truncates files | L3 (no unlink path exists), L4 |
| Wrong terminal — prod command in a dev session | L2 (explicit env), port split, UI banner |
| Dev process mis-pointed at the prod root | L2 sentinel mismatch → abort |
| Experimental junk accumulating in the product | Environment split + promotion flow |
| Crash mid-job leaves partial audio | L4 `pre-job` snapshot |
| Bad restore makes things worse | L4 `pre-restore` snapshot |
| Disk failure, volume erase, ransomware | L7 |
| Silent corruption over months | L7 `workspace verify` checksums |
| Someone disables a guard in code | L5 (OS-enforced), L7 (out of process) |

Every row has at least one layer that does not depend on application code being correct.

## Workflow Surfaces

### Seeding dev from prod

```text
workspace seed dev --from prod [--stories a,b,c] [--audio clone|skip] [--anonymize]
```

Clonefile makes this nearly free, so the default clones segment audio too — dev should exercise realistic file sizes and durations. Job history is not copied. The seeded root's sentinel is rewritten to `env: dev`, and its `protected` flag is cleared. Re-seeding trashes the previous dev root rather than merging into it.

### Promoting dev → prod

```text
workspace promote <slug> --to prod [--overwrite] [--dry-run]
```

Refuses if the slug already exists in prod unless `--overwrite`, which snapshots prod first. Requires an interactive confirmation that echoes the story title, segment count, and total audio bytes. Only story folders promote; `jobs.json` and `index.json` entries are rebuilt in the target, never copied wholesale.

This gives experiments a legitimate graduation path, which is the reason the environment split survives contact with real use: an operator who starts a real story in dev is not trapped.

### Environment identity in the UI

- Dev renders a persistent amber top bar: `DEV WORKSPACE — ~/Content Creator/.horror-aids-data/dev`. Prod renders nothing. Marking the unsafe environment rather than the safe one means prod feels normal and dev is unmistakable.
- Dev prefixes the document title with `[DEV]`.
- Port split — dev 3000, prod 3100 — so a bookmarked tab cannot silently become the other environment, and both can run simultaneously.
- Settings gains a Workspace panel: env, `workspaceId`, absolute content and cache roots, disk usage, snapshot count and newest snapshot age, trash size, last backup and last verify results, plus "Reveal in Finder".
- Every job log line and every `story.json` write records `env` and `workspaceId`, so a stray file can always be traced to the process that made it.

### CLI surface

One entry point, `npm run ws -- <command>`:

```text
ws status                       resolved roots, sentinel, usage, snapshot/backup health
ws init <env>                   create a content root (prod requires confirmation)
ws snapshot [--note] [--pin]
ws snapshot list [--story]
ws restore --story|--file|--all --at <ts> [--dry-run]
ws restore --from-trash <path>
ws trash list [--since]
ws gc [--dry-run]               prune trash past TTL, prune snapshots per retention
ws lock <slug> | unlock <slug>
ws seed dev --from prod
ws promote <slug> --to prod
ws backup --to <path> | verify [--against <path>]
ws doctor                       full invariant check — see below
```

Every mutating command supports `--dry-run` and prints the absolute paths it would touch. Destructive commands require the environment to be stated in the command itself, not inherited from the ambient shell.

## Invariants

`ws doctor` verifies all of these; CI-equivalent for a local tool.

1. No content-root path resolves outside its declared root.
2. `WORKSPACE.json` exists, is well-formed, and `env` matches the running process.
3. No `node:fs` import exists outside `src/lib/workspace/`.
4. No `unlink`/`rm` call targets a content-root path anywhere in the codebase.
5. Every story in `index.json` has a folder on disk, and every story folder has an `index.json` entry.
6. Every `audio_complete` story folder carries the immutable flag.
7. Snapshot count and total size are within retention policy.
8. The newest snapshot is younger than the heartbeat interval whenever the app is running.
9. Backup manifest checksums match the live content for every file present in both.
10. The cache root contains nothing that is not re-derivable — no story data, no voice clips.
11. No worker or app process is running without a resolved, logged environment.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Clonefile is APFS-only | Detect at `init`; fall back to `rsync --link-dest` hardlink snapshots. Refuse to run on a filesystem supporting neither and say so at startup rather than silently skipping snapshots. |
| Immutable flags block a legitimate write path discovered later | Lock only at `audio_complete`, where the pipeline is finished by definition. `ws unlock` is one command. `ws doctor` flags lock-state surprises. |
| Snapshot directory count grows unbounded | Retention policy plus `ws gc`; `ws status` surfaces count and size; heartbeat is skipped when the root is clean. |
| Trash silently consumes disk | `ws status` reports trash size; `ws doctor` warns past a threshold; TTL sweep in `ws gc`. |
| The migration itself loses data | Phase 0 delivers a verified backup before any code changes. Migration is copy → verify checksums → flip → keep the source as `data.pre-workspace/` for 30 days. Never move-then-verify. |
| Absolute paths leak into stored JSON | Everything in `story.json` stays relative to the story folder; the workspace root is only ever known at runtime. `ws doctor` greps stored JSON for absolute paths. |
| Operator fatigue from confirmations | Confirmations only on genuinely irreversible or cross-environment actions. Everything reversible (it all is, via snapshots) stays frictionless. |
| Two app instances on one root | `.locks/` holds a PID lockfile per root; a second instance warns and continues read-only rather than racing writes. |
| `jobs.json` write amplification with snapshots | `jobs.json` is 72 KB and clonefile shares unchanged blocks; heartbeat coalesces bursts. Job records are rotated past 500 entries into `jobs.archive.json`. |

## Open Decisions

Recorded in `docs/Plans/20260801-workspace-isolation/decisions.md`; the ones still genuinely open:

- Whether to keep a third `scratch` environment for agent integration runs, or let agents share `dev`.
- Whether `voices/` should be a fourth, environment-shared root — reference clips are irreplaceable and identical across environments, but sharing them reintroduces a cross-environment write path.
