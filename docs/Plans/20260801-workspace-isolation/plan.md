# Workspace Isolation Plan

Date: 2026-08-01
Spec: `docs/Specification Documents/09_WORKSPACE_ISOLATION_SPEC.md`
Decisions: `./decisions.md`

## Summary

Make it structurally impossible for a coding agent, a bad refactor, or a mistyped command to destroy production content, and stop dev experiments from accumulating in the product.

Three moves, in order of how much they actually protect:

1. **Move content out of the repository** into per-environment roots at `~/Content Creator/.horror-aids-data/<env>/`, so nothing repository-scoped can reach it.
2. **Make destruction impossible rather than discouraged** — no hard deletes anywhere, APFS clone snapshots at every mutation boundary, OS-level immutability on finished stories.
3. **Bind environment explicitly and fail closed** — no `HORROR_AIDS_ENV`, no boot; sentinel mismatch, no boot; production root never auto-created.

Everything precious is currently gitignored (`/data/`, `/stories/`) and there is no snapshot, no trash, and no backup. Phase 0 therefore builds the safety net before any code moves, because the refactor touches exactly the code that writes the irreplaceable files.

## Sequencing Rationale

The phases are ordered by *risk retired per phase*, not by implementation convenience:

- **Phase 0** exists because the refactor is the most dangerous thing about this project. Backup first.
- **Phase 1** changes only how paths are resolved, with the roots still in the repository. This proves environment binding works while a mistake is still cheap.
- **Phase 2** performs the physical move — the single biggest risk reduction (L1) — once resolution is already proven.
- **Phase 3** adds trash and snapshots, after which mistakes stop being permanent and every later phase gets safer.
- **Phase 4** closes the worker/cwd hole, which is the specific mechanism behind agent-worktree accidents.
- **Phases 5–7** add ergonomics, OS-level hardening, and offsite durability.

Phases 0–3 are the ones that matter. If the work stalls after Phase 3, the original problem is substantially solved.

---

## Phase 0: Safety Net — DONE 2026-08-01

Goal: a verified, restorable copy of everything before a single line of application code changes.

Delivered:

```text
~/Content Creator/.horror-aids-data/
  README.md                                       what this is + restore procedure (locked)
  .snapshots/20260801T041549Z-phase0-baseline/    APFS clonefile, locked uchg, pinned
    MANIFEST.sha256                               914 lines
    stories/  data/voices/  data/*.json
```

- 914 files, 953,326,632 bytes. `data/models` excluded (1.5 GB re-downloadable GGUF weights).
- Disk cost measured at **0 KB** — `df` delta before and after the clone.
- **914/914 files verified matching SHA-256** against the source, and again via `shasum -c MANIFEST.sha256`.
- Snapshot and README locked with `chflags -R uchg`; overwriting `MANIFEST.sha256` confirmed blocked.
- Immutability verified against a throwaway tree: `rm -rf` returns `Operation not permitted` on every path, contents intact, and `nouchg` cleanly reverses it.
- Restore rehearsed on three stories, all byte-for-byte identical to the originals: `tic-tac`, `can-phong-cuoi` (16 MB, 0.01 s, `final.wav` = WAVE 24 kHz Int16, 169 s), `quan-tai-quy-3` (714 MB, 0.06 s, `final.wav` 7,880 s, 387 segments). `story.json` and `segments.json` parse; no segment WAV missing.
- Source tree confirmed unlocked and unmodified — the app can still write normally.

Acceptance — all met:

- ✅ Manifest count and total bytes match the source exactly.
- ✅ Rehearsed restores produce byte-identical story folders.
- ✅ Restore procedure is written down in the data root's README, and was exercised rather than assumed.

Findings folded back into the design:

- **`cp -Rc` propagates `uchg` to the clone.** Restoring from a locked snapshot yields a locked story the app cannot write to. Every restore path must end with `chflags -R nouchg` on the restored copy — recorded as D17 and written into the L4 spec section. Found only because the rehearsal actually ran.
- Locked trees remain fully readable, which is what makes locking snapshots viable as a restore source.

Residual risk accepted by the operator (D16): the snapshot shares a volume with the content it protects. **There is currently exactly one physical copy of these 953 MB.** L7 (offsite mirror) is deferred, not solved — no external volume is attached and Time Machine has no destination configured.

Phase 1 is now unblocked.

---

## Phase 1: Workspace Resolution and Fail-Closed Boot

Goal: one module owns "where does content live", and no process starts without declaring its environment. Roots stay inside the repository for this phase.

Touches: `src/lib/paths.ts`, new `src/lib/workspace/`, `package.json` scripts, `.env.example`.

Deliverables:

- `src/lib/workspace/resolve.ts` — reads `HORROR_AIDS_ENV`, `HORROR_AIDS_WORKSPACE_ROOT`, `HORROR_AIDS_CACHE_ROOT`; returns absolute content and cache roots; throws with a diagnostic naming the variable and legal values when unset or invalid.
- `WORKSPACE.json` sentinel: written on `init`, verified on every boot, abort on `env` mismatch or unknown `schemaVersion`.
- `src/lib/workspace/paths.ts` — `resolveContentPath()`, `resolveStoryPath()`, `resolveCachePath()`, each enforcing containment inside its root. `paths.ts` keeps its exports as thin re-exports so no call site changes yet.
- `package.json`: `dev` sets `HORROR_AIDS_ENV=dev --port 3000`, `start` sets `HORROR_AIDS_ENV=prod --port 3100`. No code-level default.
- Startup log line: env, `workspaceId`, absolute content root, absolute cache root.
- Per-environment config merge: `config/app.json` ← `config/app.<env>.json` ← `config/local*.json`.

Acceptance:

- `HORROR_AIDS_ENV=` (unset) → the app exits with a clear message and does not serve a request.
- `HORROR_AIDS_ENV=bogus` → same.
- A dev process pointed at a root whose sentinel says `prod` aborts before any read.
- `npm run dev` and `npm run start` both boot and log different roots and ports.
- Existing stories still list, open, and play — zero behaviour change other than the startup log.

Rollback: revert the commit; `paths.ts` re-exports mean call sites are untouched.

---

## Phase 2: Relocate Content, Split the Cache, Migrate

Goal: production content leaves the repository (guardrail L1), model weights leave the backup set, and today's 21 mixed stories are triaged.

Touches: workspace resolver defaults, `config/app.json` model paths, `.gitignore`, `README.md`, new `ws init` / `ws migrate` commands.

Deliverables:

- `ws init prod` and `ws init dev` create `~/Content Creator/.horror-aids-data/<env>/` with a sentinel. Prod requires interactive confirmation; prod is never auto-created.
- Cache root at `~/Library/Caches/HorrorAids/` holding `models/` and `voice-preview-cache/`; `config/app.json` GGUF paths become cache-root-relative.
- `ws migrate --dry-run` emits `triage.csv`: every story with slug, title, status, segment count, folder size, last-modified, and a *suggested* target (`prod` / `dev`). The operator edits and confirms it — nothing is inferred silently.
- Migration executes copy → verify checksums → flip → rename the originals to `data.pre-workspace/` and `stories.pre-workspace/`. Nothing is deleted.
- `index.json` and `jobs.json` are rebuilt per environment from the stories that actually landed there, rather than copied wholesale.
- `.gitignore` gains the `*.pre-workspace/` names; `README.md` documents the two roots and how to point at them.

Acceptance:

- `ws status` in both environments prints correct absolute roots, story counts, and disk usage.
- Prod contains only operator-confirmed real stories; the junk slugs are in dev.
- Every story that landed in prod opens in the UI and its `final.wav` plays.
- Per-file checksums match between the pre-migration originals and the new prod root.
- `rm -rf` inside the repository checkout, and `git clean -xfd`, leave both content roots untouched — verified deliberately on a throwaway copy.
- `data/models` is absent from the content roots and from the backup set.

Rollback: the `*.pre-workspace/` directories are intact for 30 days; revert the resolver default and the app reads the old location again.

---

## Phase 3: Trash and Snapshots

Goal: destruction becomes recoverable, so mistakes stop being permanent (guardrails L3, L4).

Touches: `src/lib/json-store.ts`, `src/lib/workspace/`, `src/app/api/stories/[slug]/route.ts`, `src/app/api/tts-config/route.ts` (voice delete), `eslint.config.mjs`.

Deliverables:

- Single write chokepoint: `writeJson()`, `writeBinary()`, `trash()`, and the resolvers. All keep the existing atomic temp-write-then-rename behaviour.
- `trash()` moves to `<root>/.trash/<utc>/<relpath>`. Applied to voice deletion (currently a direct `fs.unlink` on an irreplaceable reference clip), story deletion, segment WAV replacement during regeneration, preview-cache eviction, and job `tmp/`/`logs/` cleanup.
- Lint rule: no `node:fs` / `node:fs/promises` import outside `src/lib/workspace/`. This is what keeps the decision from decaying.
- Snapshots via `cp -Rc` (APFS clonefile, verified working on this machine) at `pre-job`, `pre-approval`, `pre-trash`, `pre-restore`, `pre-migration`, `heartbeat` (30 min, skipped when clean), and `manual`.
- Filesystem capability check at `init`: APFS → clonefile; otherwise `rsync --link-dest` hardlinks; neither → refuse to run and say why rather than silently skipping snapshots.
- `ws snapshot`, `ws snapshot list`, `ws restore --all|--story|--file --at <ts>`, `ws restore --from-trash`, `ws diff --at`, `ws trash list`, `ws gc` with retention (7 days all / 30 days daily / 180 days weekly / pins) and trash TTL (prod 30 days, dev 3 days).

Acceptance:

- Deleting a voice moves the WAV to `.trash/` and `ws restore --from-trash` brings it back byte-identical.
- A snapshot of the 920 MB prod root completes in under a second and adds under 1 MB of disk (`du` before/after).
- `ws restore --story <slug> --at <ts>` reproduces that story's exact state, and itself creates a `pre-restore` snapshot first.
- A single file restore works without touching sibling files.
- Killing a TTS worker mid-run and restoring from the `pre-job` snapshot returns the story to its pre-job state.
- `ws gc --dry-run` lists exactly what it would prune and nothing outside policy.
- `grep` finds no `unlink`/`rm` call targeting a content path anywhere in `src/`; the lint rule fails a deliberate violation.

Rollback: snapshots and trash are additive; disable the heartbeat and the app behaves as before.

---

## Phase 4: Worker Handshake

Goal: remove `process.cwd()` from the trust chain — the specific mechanism behind agent-worktree accidents (guardrail L2 extended to workers).

Touches: `workers/common.py`, `workers/process_story.py`, `workers/generate_verify_tts.py`, `workers/concat_audio.py`, `workers/preview_voice.py`, `src/lib/job-runner.ts`, `docs/Specification Documents/03_WORKER_PIPELINE_SPEC.md`.

Deliverables:

- `job-runner.ts` passes `--workspace <abs>`, `--env <env>`, `--cache-root <abs>` on every spawn.
- `WorkerContext` takes the workspace root from the flag instead of `Path.cwd()`, performs the sentinel handshake, and exits non-zero on mismatch or on a missing/invalid `--env`.
- `--story` stays relative to the workspace root, so no path inside `story.json` changes and stories remain portable between roots.
- Worker log lines and result JSON record `env` and `workspaceId`.
- `preview_voice.py` resolves models and the preview cache from `--cache-root`.

Acceptance:

- A worker invoked with `--env dev --workspace <prod root>` exits non-zero without writing anything.
- A worker invoked with no `--workspace` exits non-zero.
- A worker launched with a working directory inside `.ai/worktrees/agent-*` still writes to the correct workspace, and to nothing else.
- Full pipeline — process → TTS → verify → concat — passes end to end in both environments.
- No `Path.cwd()` remains in `workers/`.

Rollback: revert; the flags are additive and old workers ignore unknown arguments only if the parser allows it, so revert both sides together.

---

## Phase 5: Environment Identity in the UI

Goal: make the wrong-window mistake visually impossible.

Touches: `src/app/layout.tsx`, `src/app/globals.css`, `src/features/stories/components/SettingsClient.tsx`, `src/features/stories/components/DashboardClient.tsx`.

Deliverables:

- Persistent amber top bar in non-prod: `DEV WORKSPACE — ~/Content Creator/.horror-aids-data/dev`. Prod renders nothing — the unmarked window is production.
- `[DEV]` document-title prefix in dev.
- Settings → Workspace panel: env, `workspaceId`, absolute content and cache roots, disk usage, snapshot count and newest-snapshot age, trash size, last backup and last verify result, plus "Reveal in Finder".
- Port split already in place from Phase 1 (dev 3000, prod 3100) surfaced in the panel.

Acceptance:

- Both environments run simultaneously on their own ports with visibly different chrome.
- The Settings panel's paths match `ws status` exactly.
- Snapshot age and trash size update after a snapshot and after a trash operation.

Rollback: cosmetic; revert freely.

---

## Phase 6: OS-Level Locks and Agent Gate

Goal: protection that does not depend on application code being correct (guardrails L5, L6).

Touches: approval flow in `src/lib/json-store.ts`, new `ws lock`/`ws unlock`, `.claude/settings.json` (new), `AGENTS.md` (currently empty).

Deliverables:

- On `audio_complete`, apply `chflags -R uchg` to the story folder. `ws unlock <slug>` snapshots, unlocks, and logs the reason; `ws lock <slug>` re-locks.
- Backfill: lock every existing `audio_complete` story during rollout.
- `.claude/settings.json` `PreToolUse` hooks — deny `Bash` commands referencing the prod content root or `HORROR_AIDS_ENV=prod`, deny `rm -rf` / `find … -delete` / `chflags … nouchg` / `git clean` / redirection into a content root; deny `Write`/`Edit` on any content-root path. Denial messages explain the rule and point at dev.
- Hook environment exports `HORROR_AIDS_ENV=dev`, so anything an agent starts binds to dev without the agent thinking about it.
- `AGENTS.md` states the rule in prose: agents work in dev; production content is the operator's.

Acceptance:

- `rm -rf` on a locked story folder fails with `EPERM` — verified against a throwaway locked copy, not assumed.
- The app never needs to write to a locked story during any normal pipeline operation.
- `ws doctor` flags any `audio_complete` story that is unexpectedly unlocked.
- An agent-issued `rm -rf ~/Content\ Creator/.horror-aids-data/prod` is blocked by the hook, and the same command run manually by the operator is blocked by immutability on finished stories.
- Video editing (opening `final.wav` from Finder in an editor) works normally on locked stories.

Rollback: `ws unlock --all` clears every flag; remove the hooks file.

---

## Phase 7: Promotion, Seeding, Offsite Durability

Goal: make the environment split livable and survive hardware loss (guardrail L7).

Deliverables:

- `ws seed dev --from prod [--stories …] [--audio clone|skip]` — clonefile copy at near-zero cost, sentinel rewritten to `dev`, job history not copied, previous dev root trashed rather than merged.
- `ws promote <slug> --to prod [--overwrite] [--dry-run]` — refuses on an existing slug unless `--overwrite` (which snapshots prod first); requires a confirmation echoing title, segment count, and total audio bytes; rebuilds the target index rather than copying it.
- `ws backup --to <path>` — mirror plus SHA-256 manifest, additive by default: files absent from the source move to a dated `.retired/` in the target, never deleted, so a source-emptying bug cannot propagate.
- `ws verify [--against <path>]` — re-hash and report drift.
- `ws doctor` — all eleven spec invariants, including "nothing irreplaceable has drifted into the cache root" and "no absolute paths in stored JSON".
- Nightly scheduled `ws backup` and weekly `ws verify`, with a visible result in the Settings panel.

Acceptance:

- Seeding dev from prod finishes in seconds and adds negligible disk.
- A story created in dev and promoted to prod opens correctly and appears exactly once in the prod index.
- `ws verify` reports clean immediately after a backup, and correctly reports drift when a byte is deliberately flipped in the target.
- Deleting a source file and re-running backup leaves the target copy in `.retired/`, not gone.
- `ws doctor` passes on both roots.

Rollback: all commands are additive and non-destructive to the live roots.

---

## What Success Looks Like

- `rm -rf` in the repository, `git clean -xfd`, or deleting the checkout entirely destroys nothing irreplaceable.
- `rm -rf` on the production root fails on every finished story, and anything it does remove is restorable from a snapshot taken minutes earlier.
- No process can write content without having stated which environment it is in.
- Agents work in a disposable environment by default, with fake TTS, and never see the production root.
- Restoring one file to its state from three days ago is one command.
- `stories/` in production contains only real productions. Experiments live in dev and graduate by promotion.
- A dead disk costs one restore from the mirror, not the archive.

## Estimated Shape

Phases 0–3 carry nearly all the risk reduction and are the natural first milestone. Phases 4–7 are individually small and independently shippable; none of them block the others. Every phase is revertible except the on-disk moves in Phase 2, which is why Phase 0 exists and why the originals are retained for 30 days.

## Follow-Ups Not In Scope

- `jobs.json` rotation past 500 entries into `jobs.archive.json` (it is 72 KB today; worth doing when snapshot churn becomes visible).
- Multi-instance write locking beyond the `.locks/` PID file warning.
- A `scratch` third environment for agent integration runs — deferred until dev fixtures exist and are annoying to lose.
- Whether `voices/` becomes a shared fourth root; see the open decisions in `./decisions.md`.
