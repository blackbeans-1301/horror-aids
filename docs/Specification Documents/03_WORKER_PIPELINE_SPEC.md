# Worker Pipeline Specification

## Goal

Python workers perform local story processing, TTS generation, Whisper verification, and final audio concat tasks.

Next.js starts workers and tracks status.

## Worker Principles

- File in, file out.
- Deterministic paths.
- Append logs.
- Return structured result.
- No hidden state.
- No large stdout payloads.
- Do not delete existing approved outputs unless explicitly requested.
- Regenerate only the exact segment that fails TTS or Whisper verification.

## Worker Command Contract

Recommended command shape:

```bash
python3 workers/[worker].py   --story stories/[slug]   --job-id job_20260612_000001   --config config/app.json
```

Worker must:

- Validate input files.
- Create output directories if missing.
- Write logs to `stories/[slug]/logs/[job-id].log`.
- Write result to `stories/[slug]/tmp/[job-id].result.json`.
- Exit `0` on success.
- Exit non-zero on unrecoverable failure.

## Job Schema

`data/jobs.json`:

```json
{
  "jobs": [
    {
      "id": "job_20260612_000001",
      "storyId": "can-phong-cuoi-hanh-lang",
      "type": "generate_verify_tts",
      "status": "running",
      "pid": 12345,
      "startedAt": "2026-06-12T00:00:00.000Z",
      "finishedAt": null,
      "logPath": "stories/can-phong-cuoi-hanh-lang/logs/job_20260612_000001.log",
      "resultPath": "stories/can-phong-cuoi-hanh-lang/tmp/job_20260612_000001.result.json",
      "error": null
    }
  ]
}
```

Job status:

- `pending` — accepted and queued, no process spawned yet. Every job starts here; only `generate_verify_tts` can stay here for any length of time (see Job Queue below).
- `running`
- `needs_review`
- `complete`
- `failed`
- `cancelled`

Job types:

- `process_story`
- `generate_verify_tts`
- `concat_audio`

## Job Queue

Jobs are queued in the app process, not started on demand.

- **One active job per story**, as before: a story with a `pending` or `running` job rejects new job starts.
- **One `generate_verify_tts` job at a time across all stories.** TTS saturates the machine — every segment shells out to `omnivoice-tts`, which loads the GGUF model and takes the GPU — so two stories generating at once halve each other's throughput and double peak memory for no gain. Additional TTS jobs stay `pending` and start automatically when a slot frees. Override with `HORROR_AIDS_MAX_TTS_JOBS`.
- **`process_story` and `concat_audio` are never queued.** They are cheap and do not contend for the GPU.
- **Queued jobs are re-validated at launch, not only at enqueue.** A job can wait hours, during which the operator may edit segments (resetting the approval) or remove a character's voice. A job that is no longer startable is marked `failed` with the reason rather than spawning a worker that would certainly raise.
- **Stopping a `pending` job** removes it from the queue; there is no process to signal.
- **`startedAt` is stamped when the job starts running**, not when it is queued, so it measures the run rather than the wait.
- **Orphaned jobs are reconciled on read**: a `running` job whose pid is dead — or which still has no pid more than 60s after starting — is marked `failed`, and for TTS the story's status is recomputed from the segments that actually finished. Without this, one orphan would block its story forever and hold a queue slot against every other story.
- **`data/jobs.json` mutations are serialised** in-process. Enqueue, pid recording, queue claims and exit handlers are all read-modify-write cycles; unserialised, two of them interleaving drops an update — a finished job left `running`, or a queued job spawned twice.

## MVP Workers

### `process_story.py`

Input:

- `text/story.md`.
- Optional existing `characters.json` and `segments.json` for regeneration hints.

Output:

- `text/characters.json`.
- `text/segments.json`.

Responsibilities:

- Identify narrator and characters.
- Assign character roles: narrator, main character, side character, villain, other.
- Segment story text by speaker in reading order.
- Preserve original story wording as much as possible.
- Mark generated segments `pending`.

Notes:

- User must review and approve output with a UI button before TTS.
- Existing manual edits should not be overwritten without confirmation.

### `generate_verify_tts.py`

Input:

- Approved `text/segments.json`.
- `text/characters.json` with voice IDs from `data/voices.json`.
- OmniVoice config/env.
- Whisper config/env, if verification is enabled.

Output:

- `audio/segments/[segment-id]-[speaker-id].wav`.
- `tmp/whisper/[segment-id]-[speaker-id].txt` (only written when verification is enabled).
- Updated segment statuses in result JSON.

OmniVoice generation contract (in-process, no HTTP call):

```python
model = get_omnivoice_model(model_repo, device)  # workers/common.py, cached per (repo, device)
audios = model.generate(text=segment_text, language="vi", ref_audio=str(resolve_voice_wav(voice_id)))
```

Config precedence: `OMNIVOICE_MODEL`/`OMNIVOICE_DEVICE` env vars override `config/app.json`'s `omnivoice.model`/`omnivoice.device`, which default to `k2-fsa/OmniVoice`/`auto`.

Rules:

- No API key or network call — OmniVoice is a local Python model loaded from `workers/.venv`.
- Generate one audio file per segment.
- Skip segments marked `skipped`.
- A full (non-targeted) "Generate + verify" run resumes rather than restarts. "Already done" means **the segment's WAV exists on disk and its verification passed** — deliberately not `status == "complete"`, because approving segments rewrites every status to `ready`, and the operator has to re-approve after each text edit. Keying the resume off `status` made a full run restart from segment 0001 after every edit. A segment whose verification passed but whose audio file is missing is regenerated with a reset attempt counter. Use an explicit `--segments` regenerate request to force a segment that is already done.
- Log model repo/device/voice ID/segment ID — there is no secret to withhold.
- `HORROR_AIDS_FAKE_TTS=1` (or unset, since it defaults on) generates a placeholder tone WAV instead of running the real model, for fast local development without downloading weights.

Whisper verification contract (only runs when `whisper.enabled` in `config/app.json`, or `AUDIO_VERIFY_ENABLED`, is true — default is **disabled**):

- Transcribe each generated segment WAV after TTS generation.
- Write transcript to `tmp/whisper/[segment-id]-[speaker-id].txt`.
- If Whisper cannot produce readable text, treat the segment as bad audio.
- If transcript is empty, too short, or fails configured comparison checks, treat the segment as failed verification.
- Regenerate only that exact segment and rerun Whisper verification.
- Repeat until verification passes or `AUDIO_VERIFY_MAX_ATTEMPTS` is reached.
- If max attempts is reached, mark segment `verification_failed` and job `needs_review` or `failed` depending whether any unresolved segment remains.

When verification is disabled:

- Each segment is marked `verification.status: "passed"` and `status: "complete"` immediately after generation, without ever being transcribed. `transcriptPreview` stays `null`.
- This is the default because Whisper (model load + transcription pass per batch) was the slowest part of a generation run; the tradeoff is that bad audio is only caught by listening to the output, not automatically.

Recommended verification checks:

- Whisper process exits successfully.
- Transcript text is not empty.
- Transcript length ratio against source segment text is above `AUDIO_VERIFY_MIN_TEXT_RATIO`.
- Transcript has enough Vietnamese text signal to indicate audible speech.

### `concat_audio.py`

Input:

- User-validated `text/segments.json`.
- Verified segment WAV files under `audio/segments/`.

Output:

- `tmp/concat-list.txt`.
- `audio/final.wav`.

Responsibilities:

- Validate user confirmed verified output.
- Validate every required segment audio exists in order.
- Validate every required segment verification status is `passed`.
- Generate FFmpeg concat list.
- Concatenate audio by segment order.
- Produce one final WAV.
- Validate final file exists and has non-zero size.

Recommended FFmpeg behavior:

- Normalize sample rate/channel format before concat if segment formats differ.
- Keep intermediate normalized files under `tmp/`.
- Write full FFmpeg command and stderr to log on failure.

## Pipeline Gates

### Story Processing Gate

Required before:

- Character editing.
- Segment approval.
- TTS.

### Segment Approval Gate

Required before:

- TTS generation.

Approval means:

- User clicked accept/approve segments button.
- Characters are correct enough.
- Speaker IDs are correct.
- Segment order is correct.
- Voices are assigned.

### Verification Gate

Required before:

- User audio validation.
- FFmpeg concat.

Verification means:

- Every required segment has a WAV file.
- Whisper can transcribe every required segment.
- Verification status is `passed` for every required segment.
- Any failed segment has been regenerated and rechecked until pass or retry limit.

### User Audio Validation Gate

Required before:

- FFmpeg concat.

Approval means:

- UI shows verified segments.
- User can play/check segment audio.
- User clicked confirm output for concat.

### Audio Completion Gate

Required before:

- Story status `audio_complete`.

Approval means:

- `audio/final.wav` exists.
- User reviewed final WAV.
- No obvious missing, duplicated, or incorrect segment remains.

## Error Handling

Worker failure:

- Keep log.
- Keep partial outputs.
- Mark job `failed`.
- Do not update story status to next stage.

OmniVoice generation failure:

- Mark failed segment in result.
- Keep successful segment audio.
- Let user rerun failed segments.

Whisper failure:

- If transcription fails for one segment, regenerate only that segment.
- Increment segment verification attempt count.
- Stop after configured max attempts.
- Keep the last failed audio and transcript/error for inspection.

FFmpeg failure:

- Include command and stderr in log.
- Keep input segment files unchanged.
- Known gap: `concat_audio.py` currently overwrites `audio/final.wav` on every run regardless of prior approval — there is no "don't clobber an approved final WAV" guard yet.

## Quality Checks

Before generate/verify job `complete`:

- Every non-skipped segment has audio file.
- Every non-skipped segment has Whisper transcript, when verification is enabled.
- Every non-skipped segment verification status is `passed` (or `complete` without transcription if verification is disabled).
- Output files are size > 0.

Before concat job `complete`:

- User validation status is approved.
- `audio/final.wav` exists.
- Final file size > 0.
- Final duration is close to sum of segment durations.

## Manual Overrides

User can:

- Edit story text.
- Edit characters.
- Edit segment speaker/text/order.
- Replace per-segment audio manually.
- Regenerate one or more segments.
- Rerun verification.
- Confirm verified output for concat.
- Rerun concat.
- Mark final audio approved/rejected from UI.
