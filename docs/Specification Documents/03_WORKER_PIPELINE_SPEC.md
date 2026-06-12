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

- `pending`
- `running`
- `needs_review`
- `complete`
- `failed`
- `cancelled`

Job types:

- `process_story`
- `generate_verify_tts`
- `concat_audio`

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
- `text/characters.json` with VieNue voice IDs.
- VieNue config/env.
- Whisper config/env.

Output:

- `audio/segments/[segment-id]-[speaker-id].wav`.
- `tmp/whisper/[segment-id]-[speaker-id].txt`.
- Updated segment statuses in result JSON.

VieNue API contract:

```text
POST {VIENUE_TTS_BASE_URL}{VIENUE_TTS_ENDPOINT}
```

Default endpoint:

```text
/v1/audio/speech
```

Request shape:

```json
{
  "model": "${VIENUE_TTS_MODEL}",
  "voice": "vienue_voice_id",
  "input": "Segment text.",
  "response_format": "wav"
}
```

Headers:

```text
Authorization: Bearer ${VIENUE_TTS_API_KEY}
```

Rules:

- API key is optional for local VieNue host if not required.
- Generate one audio file per segment.
- Skip segments marked `skipped`.
- Do not overwrite completed and verified segment audio unless user requests regeneration.
- Log provider/model/voice/segment ID, but never log API key.
- Normalize/resample output if needed before verification/concat.

Whisper verification contract:

- Transcribe each generated segment WAV after TTS generation.
- Write transcript to `tmp/whisper/[segment-id]-[speaker-id].txt`.
- If Whisper cannot produce readable text, treat the segment as bad audio.
- If transcript is empty, too short, or fails configured comparison checks, treat the segment as failed verification.
- Regenerate only that exact segment and rerun Whisper verification.
- Repeat until verification passes or `AUDIO_VERIFY_MAX_ATTEMPTS` is reached.
- If max attempts is reached, mark segment `verification_failed` and job `needs_review` or `failed` depending whether any unresolved segment remains.

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

VieNue failure:

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
- Do not overwrite last approved final WAV unless concat succeeds.

## Quality Checks

Before generate/verify job `complete`:

- Every non-skipped segment has audio file.
- Every non-skipped segment has Whisper transcript.
- Every non-skipped segment verification status is `passed`.
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
