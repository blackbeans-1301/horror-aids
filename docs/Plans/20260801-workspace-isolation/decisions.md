# Workspace Isolation — Decision Log

Date: 2026-08-01
Spec: `docs/Specification Documents/09_WORKSPACE_ISOLATION_SPEC.md`

Decisions taken on the operator's behalf, each with what was rejected and why. Anything reversible is marked; anything that shapes on-disk layout is not.

---

## D1 — Content roots live outside the repository

**Decision.** Per-environment content lives at `~/Content Creator/.horror-aids-data/<env>/`, not in the checkout.

**Why.** Coding agents work with the repository as their working directory. Nearly every realistic accident — `rm -rf`, `git clean -xfd`, worktree pruning, delete-and-re-clone, a `.gitignore` mistake — is repository-scoped. Moving 920 MB of irreplaceable content out of that blast radius is the cheapest large risk reduction available, and it requires no runtime enforcement to work.

**Rejected — `var/<env>/` inside the repo.** Simpler pathing and a single directory to back up, but leaves everything inside exactly the blast radius that keeps causing the problem. A gitignored directory inside a repository is still a directory an agent will `rm -rf` while "cleaning up".

**Rejected — a symlink `./data` → active root** for backward compatibility. `rm -rf data/` follows the symlink and empties the target. A convenience that converts a survivable mistake into a fatal one is worse than the pathing churn it saves. No symlinks anywhere in this design; `ws status` prints resolved paths instead.

**Reversible.** Yes — the roots can be relocated with `HORROR_AIDS_WORKSPACE_ROOT`.

---

## D2 — Three roots: code, content, cache

**Decision.** Split storage by recoverability, not by type. Code (git-recoverable), content (irreplaceable), cache (re-derivable).

**Why.** `data/` is 1.5 GB, of which `data/models` is 1.5 GB of re-downloadable GGUF weights and `voice-preview-cache` is 1.3 MB of regenerable audio. Treating that as precious would make every snapshot and every backup 2.5× larger and slower for zero recovery value. Excluding it leaves ~920 MB, which is small enough that snapshots become instant and nightly mirrors become trivial.

**Rejected — one root per environment holding everything.** Conceptually tidier, but it would duplicate 1.5 GB of model weights per environment and put weights in every backup.

**Consequence.** `config/app.json` GGUF paths become cache-root-relative rather than repo-relative. Deleting the cache root must always be safe; `ws doctor` asserts nothing irreplaceable has drifted into it.

---

## D3 — Environment binding is explicit, with no default

**Decision.** `HORROR_AIDS_ENV` is required. Unset or invalid → the process refuses to start. This applies to the app, every worker, and every CLI command.

**Why.** The current bug class is *implicit* binding: whatever `process.cwd()` happens to be decides which content gets written. Replacing an implicit default with a different implicit default keeps the bug. A default of `dev` would be safe but would silently strand the operator's real work in the wrong root; a default of `prod` is indefensible. Fail-closed makes every ambiguity a startup error.

**Rejected — default to `dev`.** Tempting, and safe against destruction, but it produces the confusing failure "I made a story and it vanished" when the operator meant prod. Errors that name the problem beat silence that hides it.

**Rejected — infer environment from `NODE_ENV`.** `NODE_ENV` means "optimize the build", not "which content". `next dev` against production content is a legitimate thing to want (debugging a real story), and conflating the two removes the ability to express it.

**Mitigation for ergonomics.** `npm run dev` and `npm run start` set the variable themselves, so the everyday paths never require thought and the safe one is the default keystroke.

---

## D4 — Sentinel handshake, and prod is never auto-created

**Decision.** Every content root carries `WORKSPACE.json` declaring its `env`. Any process whose `HORROR_AIDS_ENV` disagrees aborts before reading or writing. A missing `dev` root is created on demand; a missing `prod` root is a hard error, creatable only via `ws init prod`.

**Why.** Environment variables are easy to get wrong and easy for a tool to set on the operator's behalf. The sentinel makes the *root itself* assert its identity, so mis-binding fails loudly instead of writing dev experiments into production. Refusing to auto-create prod prevents the worst version of the mistake: a stray `HORROR_AIDS_ENV=prod` in an unexpected directory forking an empty parallel production workspace that looks plausible and quietly diverges.

**Not reversible.** The sentinel becomes part of the on-disk contract.

---

## D5 — Workers receive their workspace explicitly

**Decision.** `job-runner.ts` passes `--workspace <abs>`, `--env <env>`, and `--cache-root <abs>`. `workers/common.py` stops using `Path.cwd()` and performs the same sentinel handshake. `--story` remains relative to the workspace root.

**Why.** `WorkerContext.project_root = Path.cwd()` is the exact mechanism by which a worker spawned from an agent worktree operates on the wrong tree. Passing the binding explicitly removes cwd from the trust chain entirely; the handshake means even a wrong flag fails rather than corrupting.

Keeping `--story` relative is deliberate: every path stored in `story.json` stays relative to its story folder, so no stored data acquires machine-specific absolute paths and stories remain portable between roots.

---

## D6 — No hard deletes; trash plus explicit GC

**Decision.** `unlink`/`rm` are prohibited on content-root paths. Destruction is a move to `<root>/.trash/<utc>/<relpath>`. Reclamation is `ws gc`, an explicit command with a TTL (prod 30 days, dev 3 days) that never runs inside a request handler.

**Why.** `deleteVoice()` currently calls `fs.unlink` on an irreplaceable recorded clip, and segment regeneration overwrites WAVs in place. Both are one-keystroke permanent losses. Converting every destructive verb to a move makes the entire application non-destructive by construction, which matters more than any individual guard because it survives refactoring: there is no delete function left to call by mistake.

Separating reclamation from deletion is the point. Automatic sweeping on a timer would reintroduce the failure — an operator who realizes their mistake on day two must find the file still there.

**Enforcement.** A single write chokepoint at `src/lib/workspace/` plus a lint rule banning `node:fs` imports elsewhere. Without the lint rule this decision decays the first time someone adds a "quick" direct write.

---

## D7 — APFS clonefile snapshots as the primary recovery mechanism

**Decision.** Snapshot the content root with `cp -Rc` (APFS copy-on-write clones) at mutation boundaries and on a 30-minute heartbeat. Retain 7 days of everything, 30 days of dailies, 180 days of weeklies, plus manual pins.

**Why.** Verified on this machine: the volume is APFS and `cp -c` succeeds. Clonefile shares blocks, so a snapshot of 920 MB takes milliseconds and consumes almost no space — only blocks changed after the snapshot accrue cost. That price makes it reasonable to snapshot *before every job*, which is precisely when partial-write corruption happens. Recovery becomes a routine command instead of an incident.

**Rejected — git or git-lfs for content.** Wrong tool for 1 GB of derived WAVs; the index churn and storage cost are severe, and the operator would still need a story-level restore, which git does not express naturally.

**Rejected — Time Machine alone.** Hourly at best, no story-level granularity, no pre-job hook, and restores route through a GUI. Good as an additional layer, not as the mechanism.

**Rejected — native APFS volume snapshots (`tmutil localsnapshot`).** Whole-volume granularity, requires elevated privileges, and cannot be tagged per job. Directory clones give per-story restore.

**Known limit.** Snapshots share the volume with the content they protect. They defeat mistakes, not hardware. Hence D9.

---

## D8 — OS-level immutability for finished stories

**Decision.** On `audio_complete`, apply `chflags -R uchg` to the story folder. Unlocking requires `ws unlock <slug>`.

**Why.** Every other preventive layer lives in code that a refactor can break or an agent can bypass. `chflags uchg` makes `rm -rf` fail at the syscall with `EPERM` for the owner. It costs nothing, applies exactly where value is highest (a finished 723 MB production), and is invisible during normal use because a finished story has no remaining pipeline writes by definition.

**Why only at `audio_complete`.** Locking earlier would fight the pipeline — workers legitimately write segment audio, logs, and `tmp/` throughout. Gating on the terminal state means the lock never blocks a write the app actually needs to make, so there is no pressure to add an automatic unlock path that would defeat it.

**Rejected — read-only permissions (`chmod -w`).** The owner can override without an extra step, and `rm -rf` succeeds on a directory whose parent is writable. It documents intent without enforcing it.

**Rejected — locking everything immediately.** Constant unlock friction, and the app would need an automatic unlock that reduces the lock to decoration.

---

## D9 — Offsite mirror with checksums, additive by default

**Decision.** `ws backup --to <path>` mirrors the content root and writes a SHA-256 manifest. Files missing from the source are moved to a dated `.retired/` folder in the target rather than deleted. `ws verify` re-hashes and reports drift.

**Why.** Snapshots do not survive disk loss or a mistaken `diskutil`. Additive-by-default mirroring is the important detail: a strict mirror faithfully propagates a bug that emptied the source, turning one failure into two. Checksums catch slow corruption that neither snapshots nor mirrors would notice, which matters for WAVs the operator may not open for months.

---

## D10 — Environment asymmetry is a feature

**Decision.** Dev gets shallow snapshots, a 3-day trash TTL, no immutability locks, no offsite backup, fake TTS by default, and fewer GGUF steps. Prod gets everything.

**Why.** Isolation only holds if working in dev is *easier* than working in prod. Applying the full protective apparatus to dev would make experiments slow and ceremonious, the operator would drift back to prod for convenience, and the split would exist only in documentation. Cheap-and-disposable dev is what makes the boundary self-enforcing.

---

## D11 — Mark dev in the UI, not prod

**Decision.** Dev shows a persistent amber banner and a `[DEV]` title prefix. Prod shows nothing.

**Why.** Prod is where most real work happens; a permanent warning there becomes wallpaper and trains the operator to ignore banners. Marking the *unusual* state keeps the signal meaningful — an unmarked window is production, and that is a rule that stays legible after months of use.

**Supporting decision.** Port split (dev 3000, prod 3100) so a bookmarked tab cannot silently become the other environment, and both can run at once for comparison.

---

## D12 — Migration triage is operator-confirmed, never inferred

**Decision.** The migration generates a triage manifest listing all 21 existing stories with size, status, segment count, and last-modified date, plus a *suggested* classification. The operator edits it. Nothing moves until it is confirmed, and nothing is deleted at all — dev-classified stories are copied to dev, and the original in-repo `data/`/`stories/` are renamed to `data.pre-workspace/`/`stories.pre-workspace/` and kept 30 days.

**Why.** The names strongly suggest which are junk (`54r`, `asdfasd`, `dsf`, `fdsf`, `hehe`, `twertew`, `qtq`, `qtq2`, `qtqtest`, `test-story-1`) and which are real (`quan-tai-quy*`, `can-ho-404`, `can-nha-cuoi-ngo`, `can-phong-cuoi`, `rung-monongahela`, `tic-tac`, `maichi`). Strongly suggest is not the same as know. `quan-tai-quy-2-2` could be a real second take or an accidental duplicate, and a tool cannot tell. The entire point of this project is to stop guessing about irreplaceable content.

---

## D13 — Safety net before refactor

**Decision.** Phase 0 delivers a verified, checksummed backup of the current in-repo content before any code changes. The refactor does not begin until `ws verify`-equivalent output is clean.

**Why.** The refactor touches `json-store.ts`, `paths.ts`, `job-runner.ts`, and `workers/common.py` — precisely the code that writes irreplaceable files. The work of protecting the content is itself the most likely thing to destroy it, and right now there is no rollback. Backup first is non-negotiable ordering.

---

## D14 — Agent hooks are the weakest layer and are ordered last

**Decision.** `.claude/settings.json` gains `PreToolUse` denials for prod paths and destructive commands, plus `HORROR_AIDS_ENV=dev` in the hook environment. This ships in Phase 6, after L1–L5.

**Why.** Pattern-matching command text is trivially bypassed — an agent that writes a Python script instead of running `rm` sails through. Hooks are worth having because they catch the common case for free and they document intent at the point of action, but ordering them first would create false confidence and delay the layers that actually hold. L1 (physical separation) and L5 (OS immutability) do not care what an agent intends.

---

## D15 — Content-root home: `~/Content Creator/.horror-aids-data/<env>/`

**Decision.** Operator's choice, 2026-08-01. Content roots sit next to the existing `~/Content Creator/` working tree rather than at `~/HorrorAids/`.

**Why.** Finder ergonomics during video editing — `final.wav` files get dragged into an editor regularly, and keeping them adjacent to the rest of the content-creation tree matters more than a shorter path. L1 is unaffected: the repository lives at `~/Content Creator/youtube/horror-channel/horror-aids`, so the data root is still entirely outside it and out of reach of anything repository-scoped.

**Note.** The leading dot keeps it out of casual Finder browsing while remaining reachable by path. `HORROR_AIDS_WORKSPACE_ROOT` still overrides it.

---

## D16 — In-place snapshots first; offsite deferred

**Decision.** Operator's choice, 2026-08-01. Phase 0 ships as an APFS clonefile snapshot on the same volume, immutability-locked. The offsite mirror (L7) is deliberately deferred.

**Why.** No external volume is currently attached and Time Machine has no destination configured, so an offsite copy could not be produced today at all. An in-place snapshot is available immediately, costs nothing, and closes the *present* threat — agent and typo-driven deletion. Waiting for hardware to close that gap would have meant leaving 953 MB with zero copies for however long the wait lasted.

**Accepted residual risk, stated plainly.** Snapshots share `/dev/disk3s1` with the content they protect. A failed SSD, a mistaken `diskutil`, or filesystem corruption still destroys both the live content and every snapshot. **There is currently exactly one physical copy of 953 MB of irreplaceable content.** L7 remains the single largest open gap in this design; it is not closed, only sequenced later.

---

## D17 — Restore must clear immutable flags on the restored copy

**Decision.** Every restore path (`ws restore`, and the manual procedure documented in the data root's README) runs `chflags -R nouchg` on the *restored copy* as its final step.

**Why.** Discovered empirically during the Phase 0 restore rehearsal, not predicted: **`cp -Rc` propagates the `uchg` flag to the clone.** Restoring from a locked snapshot therefore produces a locked story — and the app could not write to it, nor could the operator clean it up. The rehearsal's own cleanup `rm -rf` failed with `EPERM` for exactly this reason.

This is a genuine footgun in a recovery path, which is the worst place to have one: it surfaces during an incident, when the operator is already under pressure. Unlocking the restored copy (never the snapshot) is a one-line addition that removes it.

**Also confirmed.** The immutable flag blocks writes and deletes but not reads — a locked snapshot is fully usable as a restore source, which is what makes locking snapshots viable at all.

---

## Still open
- **A third `scratch` environment** for agent integration runs, versus letting agents share `dev`. Sharing risks an agent trashing hand-made dev fixtures; a third root adds a seeding step. Deferred until dev fixtures exist and are annoying to lose.
- **Whether `voices/` should be a shared fourth root.** Reference clips are irreplaceable, identical across environments, and only 3.1 MB. Sharing avoids duplicating them and avoids dev drifting out of sync; sharing also reintroduces exactly one cross-environment write path, which is the thing this design otherwise eliminates. Current lean: keep them per-environment and let `ws seed` clone them, because 3.1 MB is not worth a hole in the model.
