# Code Review: Docs vs. Codebase, 2026-07-31

Review of `docs/Specification Documents/*` and `docs/Plans/*` against the current implementation (Next.js API routes, `src/lib/*`, `src/features/stories/*`, `workers/*.py`). Findings verified by direct code reading, not just spec inference.

> **Status as of 2026-08-01:** re-verified every finding against the current working tree (~30 uncommitted modified files relative to HEAD). Almost all code-level bugs below are now **already fixed, but uncommitted** — this looks like the review itself prompted a fix pass. Two corrections to the original write-up: **#1 was a false positive** (the Python worker already updates story status independently of the Node layer — my original analysis only checked the Node side), and **#2 is now fixed** (`generate_verify_tts.py` resets `verifiedAudio` on regeneration). Only #3 (partial), #5, #11, and a couple of "Lower severity" items remain genuinely open. The doc-only findings (#16-19) are about documentation, not code, so they stay open until someone edits the docs.

## High severity

### 1. ~~Story status never advances after a successful TTS run~~ — NOT A BUG (original finding was wrong)
`src/lib/job-runner.ts:193-205`, `workers/generate_verify_tts.py:424-434`, `workers/common.py:127-130`

The original claim was that the Node `child.on('exit', ...)` handler never calls `patchStory()`, so status stays stuck at `tts_running`. That's true of the Node layer in isolation, but it's the wrong place to look: **the Python worker itself writes `story.json` directly** before exiting — `story["status"] = "tts_verified"` is set when `unresolved == 0`, then `ctx.write_story(story)` performs an atomic write. `src/lib/json-store.ts:readStory` has no in-memory caching and reads the file fresh on every request, so the dashboard/workspace see the correct status as soon as the worker writes it, independent of anything the Node exit handler does. Verified this write path is unconditional in `main()`'s success path (not gated behind any conditional the review missed). No fix needed here — retract this finding.

### 2. ~~Regenerating a segment after "confirm verified output" doesn't reset that approval~~ — FIXED (uncommitted)
`workers/generate_verify_tts.py:430-434`

`generate_verify_tts.py` now tracks `generated_count` (incremented only when `call_omnivoice` actually re-synthesizes a segment) and, at the end of the run, resets `approvals.verifiedAudio` to `pending` if `generated_count > 0` and it was previously `approved`:
```python
if generated_count > 0 and story["approvals"]["verifiedAudio"]["status"] == "approved":
    story["approvals"]["verifiedAudio"] = {"status": "pending", "approvedAt": None}
```
This closes the gap: confirm → regenerate → re-pass no longer lets concat run without re-confirmation. No action needed — verify it survives once committed.

### 3. Re-running "Process story" silently discards approved/edited segments — PARTIALLY OPEN
`workers/process_story.py:142-144` (approvals reset — correct), `workers/process_story.py:74,84,130` (voice-only carry-forward — still a gap)

Approvals (`segments`/`verifiedAudio`/`finalAudio`) are correctly reset to `pending` every run, so the TTS gate is properly re-blocked — the original "stale approval lets TTS run against unreviewed content" framing was wrong and has been removed.

**What remains a real, open bug:** `segments.json`/`characters.json` are still unconditionally rewritten from scratch; only per-character **voice IDs** are carried forward via `existing_voices` (confirmed: no `existing_segment`/`existing_character` text/speaker carry-forward exists anywhere in the file). A user who has manually edited segment text or speaker assignments and re-runs "Process story" silently loses those edits. Contradicts the spec's "existing manual edits should not be overwritten without confirmation." Not yet fixed.

### 4. ~~`needs_review` job status is dead code~~ — FIXED (uncommitted)
`src/lib/json-store.ts:602-616`, `workers/generate_verify_tts.py:445-451`

`jobStatusFromExitCode` now maps a dedicated `NEEDS_REVIEW_EXIT_CODE = 2` (matching the worker's constant) to `'needs_review'`, so a partially-resolved run (8/10 segments passed) is no longer indistinguishable from a hard crash. Fixed.

### 5. Unsaved edits are silently ignored, not just unsaved — STILL OPEN
`src/features/stories/hooks/useStoryWorkspace.ts:224-227,356-365`

`canProcess`/`canGenerate`/`canConfirmVerified`/`canConcat` now correctly gate on `!isArchived` and `!hasActiveJob` (see #12), but still do **not** check `dirty.story`/`dirty.characters`/`dirty.segments`. The only dirty-state protection added is a `beforeunload` handler (lines 356-365) that warns before closing/refreshing the *browser tab* — it does nothing to stop a same-page click on Process/Approve/Generate while edits are unsaved. Still not fixed.

## Medium severity

### 6. ~~TOCTOU race allows two concurrent jobs on one story~~ — FIXED (uncommitted)
`src/lib/job-runner.ts:36-152`

A module-level `startingJobs = new Set<string>()` guards the whole check-then-commit region synchronously. Confirmed fixed.

### 7. ~~`concat_audio.py` regresses `story.status` backward on success~~ — FIXED (uncommitted)
`workers/concat_audio.py:113-118`

The status write-back is gone; the code now explicitly leaves `story["status"]` as `ready_to_concat` with a comment explaining why regressing it to `audio_validation` would move the badge backward. Fixed.

### 8. ~~`/asset` route's path-prefix check is bypassable~~ — FIXED (uncommitted)
`src/lib/json-store.ts:513-522`

`getAsset` now resolves the path and rejects anything outside `audioRoot` (`storyDir/audio`), closing the `?path=audio/../story.json` bypass. Fixed.

### 9. ~~`sourceType` is a tautology bug~~ — FIXED (uncommitted)
`src/app/api/stories/route.ts:32-34`

Now validates against a whitelist `Set<SourceType>`, defaulting to `'manual'` only for invalid/missing values. Fixed.

### 10. ~~`whisper.enabled` default is inverted from spec~~ — FIXED (uncommitted)
`src/app/api/tts-config/route.ts:58,130`, `workers/generate_verify_tts.py:183`

All three now default to `false` (`?? false` / `default=bool(whisper_config.get("enabled", False))`), matching the spec. Fixed.

### 11. Dirty flags never clear on reprocess — STILL OPEN
`src/features/stories/hooks/useStoryWorkspace.ts:60-66`

`clearDirty` is only called from the explicit save actions (`saveStory`/`saveCharacters`/`saveSegments`); nothing clears it around a `process_story` run. Combined with #5, a subsequent "Save segments" can still clobber a freshly regenerated `segments.json` with stale local data. Not fixed.

### 12. ~~Archived stories have no client-side lockout~~ — FIXED (uncommitted)
`src/features/stories/hooks/useStoryWorkspace.ts:223-227`, `src/features/stories/components/StoryWorkspaceClient.tsx:92-177`

`isArchived` now gates `canProcess`/`canGenerate`/`canConfirmVerified`/`canConcat`, `effectiveBusy = isBusy || isArchived` disables the action buttons, and the workspace now renders an explicit "This story is archived — unarchive it from the dashboard before saving or running..." banner. Fixed.

### 13. ~~`approve-segments` requires voices for `skipped` segments' speakers~~ — FIXED (uncommitted)
`src/app/api/stories/[slug]/approve-segments/route.ts:19-21`

`usedSpeakerIds` now filters out `skipped` segments before checking for assigned voices, matching `assertCanStartJob` and `voicesReady`. Fixed.

### 14. ~~Vietnamese name misclassified as "villain"~~ — FIXED (uncommitted)
`workers/process_story.py:28-36`

`role_for_index` now does a whole-word regex match (`\btoken\b`) instead of a plain substring check, with a comment explicitly calling out the "Mai" case. Fixed.

### 15. ~~`preview_voice.py` ignores configured GGUF paths~~ — FIXED (uncommitted)
`workers/preview_voice.py:23-40`

`load_gguf_config(args.config)` now reads `omnivoice.gguf` from the config file and threads it into `run_omnivoice_cpp`, instead of passing an empty dict. Fixed.

## Lower severity

- ~~`readStory` throws an unhandled `TypeError` for a nonexistent slug~~ — **FIXED**: now throws a clean `Error('Story not found: ${slug}')` (`src/lib/json-store.ts:338-341`).
- "One narrator required" — **addressed differently, effectively fixed**: the Characters UI now disables removing or changing the role of the narrator character (`CharactersTab.tsx:99-100,142-143`), so a narrator can't be removed via the UI even though there's no separate inline validation message.
- ~~Log auto-tail effect torn down by every 3s poll~~ — **FIXED**: the effect now depends on the stable `activeJobId` primitive instead of the `detail` object (`useStoryWorkspace.ts:340-354`, with a comment explaining the original bug).
- ~~Sequential "Play all" can reshuffle mid-playback~~ — **FIXED**: `playerIndex` is now re-synced by looking up the segment's `id` in the recomputed `playableSegments` list rather than trusting a stale index (`useStoryWorkspace.ts:166-192`).
- ~~Speaker-name regex uses a raw Unicode range~~ — **FIXED**: replaced with a curated Vietnamese letter set (`workers/process_story.py:10-22`), same change as #14.
- ~~Per-segment exception handling only catches `(RuntimeError, OSError, ValueError)`~~ — **FIXED**: now catches broad `Exception` with an explicit `# noqa: BLE001` comment so one bad segment can't abort the whole run (`generate_verify_tts.py:323,334,384,457`).
- **STILL OPEN**: blank segments/characters are silently dropped on save with no user feedback — confirmed still true in both `segments/route.ts:71-73` (`if (!text.trim()) return null`) and `characters/route.ts:39-41` (`if (!id || !name) return null`); no error/warning is returned to the caller either way.
- ~~Settings page's three panels shared one dirty-flag/apply action~~ — **FIXED**: each panel now computes its own pending-change flag (`hasModelPendingChanges`/`hasVerificationPendingChanges`/`hasSegmentationPendingChanges`) and applies independently (`SettingsClient.tsx:85-96`), with a comment noting the original cross-panel-commit bug.

## Confirmed matching spec (not bugs)

- All 20 documented API routes exist with matching methods, including the untracked `jobs/stop/route.ts`.
- Path traversal into the story root / project root is correctly blocked by `resolveStoryPath`/`assertValidSlug`; the `/asset` prefix-check bypass (#8) is also now closed.
- Atomic writes (temp file + rename) used consistently for JSON/text writes.
- Archive/unarchive correctly sets/clears `archived`/`archivedAt` without moving the folder, and blocks new jobs on archived stories (now enforced client-side too, #12).
- Model caching per `(repo, device)`, env/config precedence for OmniVoice, unknown-voice-id failing the segment rather than falling back, skip-on-`skipped`, zero-padded 4-digit segment IDs — all verified correct.
- The documented gap "full non-targeted TTS run reprocesses every non-skipped segment" matches the code exactly; a **targeted** `--segments` regenerate correctly skips segments outside the target set.
- `concat_audio.py`'s unconditional `final.wav` overwrite (no prior-approval guard) matches the spec's own acknowledged known gap.
- No `shell=True` usage anywhere in the Python workers; no `dangerouslySetInnerHTML` or raw-HTML rendering of story/log text in the frontend.

## Additional pass: specs 00, 02, 05, 06, 07 and `docs/Plans/*`

The first pass above only cross-checked specs 01, 03, 04, and 08. This pass covers the rest. These are documentation gaps, not code bugs — nothing to "fix" in `src`/`workers` for these; the docs themselves need updating.

### 16. `docs/Plans/MVP/20260612-local-audio-studio/plan.md` describes a TTS engine that no longer exists — outdated, not just incomplete

Lines 12, 24, and 139 describe **VieNue TTS** as the current/production TTS integration. Per `git log` (`e185634 Migrate TTS engine from VieNue to local OmniVoice`, `97f3b86 use omnivoice tts, remove pycache`), the app has fully migrated to local in-process **OmniVoice**. No `VieNue`/`vienue` string remains anywhere in `src/` or `workers/`. Still open — this doc has not been touched by the uncommitted fix pass.

### 17. `02_LOCAL_WORKSPACE_SPEC.md` — workspace layout has drifted from the doc

- Log naming (lines 49-53): doc promises per-command-type files (`process-story.log`, etc.); actual code writes `logs/${jobId}.log`.
- `tmp/` layout (lines 54-59) omits the `tmp/${jobId}.result.json` files the runner actually writes.
- `data/` root layout (lines 11-18) omits `data/models` and `data/voice-preview-cache`.
- Everything else (JSON shapes, status enums, voice registry, role list) matches `src/types/story.ts`. Still open.

### 18. `05_CONTENT_AND_RIGHTS_SPEC.md` — doc already flags itself as aspirational; that self-assessment is accurate

`rightsStatus`/`sourceType`/`sourceUrl` exist on `story.json` and are PATCH-able, but no workspace UI displays or edits them. `metadata/permissions.md`/`metadata/source.md` are never created — only `metadata/notes.md` is. Not a bug, just confirms the doc's own caveat. Still open as a doc/feature gap.

### 19. `06_VIDEO_QUALITY_SPEC.md` — self-annotated as mislabeled; confirmed correct, independently reproduces two bugs already found above

No video/render/mp4/subtitle code exists anywhere, matching the doc's own disclaimer. Its FFmpeg-overwrite concern matches #7 (already fixed) and its Whisper-default concern matches #10 (already fixed) — those code issues are resolved, but the doc itself hasn't been edited to remove the now-stale warnings.

### Confirmed matching / not newly broken

- `00_PRODUCT_REQUIREMENTS.md`: accurate — "not goal: video rendering, image generation, subtitles, YouTube upload" matches reality; core workflow matches the actual pipeline. Only drift is the `metadata/permissions.md` reference noted in #18.
- `07_DEVELOPMENT_PHASES.md`: already carries inline "done"/"not yet implemented"/"partially" annotations that match code. No stale claims.
- `docs/Plans/MVP/Overview.md`: fine, just a pointer to the sub-plan.
