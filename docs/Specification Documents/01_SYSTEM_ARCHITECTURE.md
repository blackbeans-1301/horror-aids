# MVP System Architecture

## Architecture Style

Local-first monolith UI plus local worker scripts.

```text
Browser
  -> Next.js localhost app
    -> local API routes/server actions
      -> JSON store + story folders
      -> Python worker commands
        -> story processor / VieNue TTS / Whisper verify / FFmpeg concat
```

## Components

### Next.js App

Responsibilities:

- Local dashboard.
- Story list and detail pages.
- Story writing editor.
- Character and voice review UI.
- Segment ordering/editing UI.
- Explicit segment approval button.
- Job start/status/log UI.
- Per-segment verification status UI.
- Audio playback for segments and final WAV.
- User validation button before concat.
- File path validation.

Next.js must not:

- Store audio binary data in JSON.
- Run arbitrary commands from UI input.
- Hide worker command failures.
- Expose local files outside the project root.

### Local JSON Store

Responsibilities:

- Story index.
- Job status.
- App settings.
- Worker registry.

Source of truth:

- `data/index.json` for story list.
- `data/jobs.json` for global active/recent jobs.
- `stories/[slug]/story.json` for story state.
- `stories/[slug]/text/characters.json` for speaker definitions.
- `stories/[slug]/text/segments.json` for ordered TTS segments and verification state.

### Story Workspace

Responsibilities:

- Own all files for one story.
- Keep audio package portable.
- Allow archive/move by folder.

Pattern:

```text
stories/[story-slug]/
  story.json
  text/
    story.md
    characters.json
    segments.json
  audio/
    segments/
    final.wav
  metadata/
  logs/
  tmp/
```

### Python Workers

Responsibilities:

- Long-running text processing and audio tasks.
- File-based input/output.
- VieNue TTS API calls.
- Whisper transcription verification.
- Exact failed-segment regeneration.
- FFmpeg audio normalization/concat.
- Append logs.
- Return machine-readable status.

Workers should receive:

- Story slug.
- Job ID.
- Input/output paths.
- Config path.

Workers should write:

- Output files.
- Job log.
- Structured result JSON.

## Data Flow

### Create Story

1. User enters title/source type.
2. Next.js creates slug.
3. Next.js creates story folder tree.
4. Next.js writes `story.json`.
5. Next.js writes empty `text/story.md`.
6. Next.js updates `data/index.json`.

### Write Story

1. User edits story in browser.
2. Next.js writes `text/story.md` atomically.
3. Story status becomes `story_draft`.
4. Any previous segment approval, verification, and final audio approval are reset if story text changes after processing.

### Process Characters And Segments

1. User starts processing job.
2. Next.js creates job record.
3. Next.js starts `process_story.py`.
4. Worker reads `text/story.md`.
5. Worker writes `text/characters.json` and `text/segments.json`.
6. UI shows editable characters, voices, and ordered segments.
7. User clicks accept/approve segments.
8. Story status becomes `segments_approved` and TTS is enabled.

### Generate And Verify TTS

1. Segments must be approved.
2. Each character used by a segment must have a VieNue voice.
3. Next.js starts `generate_verify_tts.py`.
4. Worker calls local VieNue OpenAI-compatible API per segment.
5. Worker writes `audio/segments/[segment-id]-[speaker-id].wav`.
6. Worker transcribes the segment WAV with Whisper.
7. If Whisper cannot transcribe or verification fails, worker regenerates the exact failed segment and repeats verification.
8. Worker stops retrying a failed segment after configured max attempts and marks it `failed`.
9. Story status becomes `tts_verified` only when every required segment passes.

### User Validate Verified Segments

1. UI shows all segment audio, original segment text, Whisper transcript, and verification status.
2. User can play segments and inspect failed/retried items.
3. User clicks confirm output for concat.
4. Story status becomes `ready_to_concat`.

### Concatenate Final Audio

1. User validation must be complete.
2. All required segment WAV files must be verified.
3. Next.js starts `concat_audio.py`.
4. Worker normalizes segment format if needed.
5. Worker writes FFmpeg concat list in `tmp/`.
6. Worker writes `audio/final.wav`.
7. UI plays final WAV for review.
8. User marks audio complete.

## Process Model

MVP can spawn worker processes directly from Next.js server.

Rules:

- One active job per story by default.
- Worker process ID stored in `data/jobs.json`.
- Logs streamed by polling log file.
- Failed job keeps partial output but does not mark the next stage complete.

Future upgrade:

- Replace direct spawn with queue only if local jobs become unreliable.

## Configuration

Recommended files:

```text
config/app.json
config/voices.json
.env.local
```

VieNue environment/config values:

```text
VIENUE_TTS_BASE_URL=http://localhost:PORT
VIENUE_TTS_API_KEY=optional-local-key
VIENUE_TTS_MODEL=model-name
VIENUE_TTS_ENDPOINT=/v1/audio/speech
```

Whisper environment/config values:

```text
WHISPER_MODEL=base
WHISPER_LANGUAGE=vi
AUDIO_VERIFY_MAX_ATTEMPTS=3
AUDIO_VERIFY_MIN_TEXT_RATIO=0.6
```

Secrets:

- API keys stay in `.env.local`.
- Never write secrets to `story.json`, logs, segment files, or metadata exports.

## Dependency Boundaries

Next.js owns:

- UI.
- API validation.
- JSON atomic writes.
- Human decisions.
- Job spawning/status polling.

Python owns:

- Story processing.
- VieNue TTS calls.
- Whisper transcription verification.
- Failed segment regeneration loop.
- FFmpeg audio concat.
- Heavy file processing.

Shared contract:

- File paths.
- Job status schema.
- Story schema.
- Character schema.
- Segment schema.
- Verification status schema.

## Failure Handling

- Worker exits non-zero -> job status `failed`.
- Missing input file -> validation error before worker starts.
- VieNue segment failure -> mark segment `failed`, keep other generated audio.
- Whisper failure to transcribe -> regenerate exact segment until max attempts, then mark segment `verification_failed`.
- Verification mismatch -> regenerate exact segment until max attempts, then mark segment `verification_failed`.
- FFmpeg failure -> include command and stderr in log.
- App restart -> read existing JSON, audio files, transcripts, and logs.
- Partial TTS output -> keep files but do not mark story `tts_verified` unless all required segments pass.

## Security

- Localhost only for MVP.
- Do not expose app to public network.
- Validate all slugs and paths.
- Disallow `../` path traversal.
- Only allow workers from known command registry.
- Never run arbitrary command from UI text input.
- Do not let story text affect shell command construction.

## Scalability Stance

Do not add database or queue yet.

Add later only when:

- Multiple users.
- Concurrent job scheduling.
- Remote workers.
- Cloud storage.
- Search across hundreds of stories.
