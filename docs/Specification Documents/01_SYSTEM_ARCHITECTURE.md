# MVP System Architecture

## Architecture Style

Local-first monolith UI plus local worker scripts.

```text
Browser
  -> Next.js localhost app
    -> local API routes/server actions
      -> JSON store + story folders
      -> Python worker commands (spawned via the workers/.venv interpreter)
        -> story processor / OmniVoice TTS / Whisper verify (optional) / FFmpeg concat
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
- Voice-cloning registry.

Source of truth:

- `data/index.json` for story list.
- `data/jobs.json` for global active/recent jobs.
- `data/voices.json` for the cloned-voice registry (reference clips live under `data/voices/*.wav`).
- `config/app.json` for OmniVoice model/device and the Whisper verification toggle (not a `data/` file — see Configuration).
- `stories/[slug]/story.json` for story state.
- `stories/[slug]/text/characters.json` for speaker definitions.
- `stories/[slug]/text/segments.json` for ordered TTS segments and verification state.

### Story Workspace

Responsibilities:

- Own all files for one story.
- Keep audio package portable.
- Allow archiving without moving the folder (see Data Flow's Archive Story section).

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

### Voice-Cloning Registry

Responsibilities:

- Store uploaded reference WAV clips (3-5s each) used to clone a voice for OmniVoice.
- Expose voices to the Characters tab so a character can be assigned one by ID.
- Support preview (synthesize a short sample) and delete from the Settings screen.

Pattern:

- `data/voices.json` — `{ voices: [{ id, name, wavPath, createdAt }] }`, managed via `src/lib/json-store.ts`'s `addVoice`/`deleteVoice`/`readVoices`.
- `data/voices/[id].wav` — the reference clip itself; only the path is stored in JSON, never the audio bytes.
- API surface: `GET/POST/DELETE /api/voices`, `GET /api/voice-preview` (spawns `workers/preview_voice.py`).

### Python Workers

Responsibilities:

- Long-running text processing and audio tasks.
- File-based input/output.
- In-process OmniVoice model calls (no network TTS provider).
- Whisper transcription verification, when enabled.
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
2. Each character used by a segment must reference a voice in `data/voices.json`.
3. Next.js starts `generate_verify_tts.py`.
4. Worker loads the OmniVoice model in-process (cached for the run) and generates each segment from its reference clip.
5. Worker writes `audio/segments/[segment-id]-[speaker-id].wav`.
6. If Whisper verification is enabled (`whisper.enabled` in `config/app.json`), worker transcribes the segment WAV with Whisper; if disabled, the segment is accepted immediately after generation.
7. If Whisper cannot transcribe or verification fails, worker regenerates the exact failed segment and repeats verification.
8. Worker stops retrying a failed segment after configured max attempts and marks it `failed`.
9. Story status becomes `tts_verified` once every required segment passes (or is accepted, if verification is disabled).

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

### Archive Story

1. User clicks archive from the dashboard.
2. Next.js sets `archived: true` and `archivedAt` on `story.json` and its `data/index.json` entry.
3. Story folder is left in place — nothing moves on disk.
4. Dashboard hides archived stories from the default (Active) view; a filter toggle shows them.
5. Starting a new job on an archived story is rejected; unarchiving clears the flag and re-enables jobs.

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

Actual files:

```text
config/app.json
data/voices.json
.env.local
```

OmniVoice environment/config values (`.env.local` overrides `config/app.json`'s `omnivoice` block):

```text
OMNIVOICE_MODEL=k2-fsa/OmniVoice
OMNIVOICE_DEVICE=auto
```

Whisper environment/config values:

```text
WHISPER_MODEL=base
WHISPER_LANGUAGE=vi
AUDIO_VERIFY_MAX_ATTEMPTS=3
AUDIO_VERIFY_MIN_TEXT_RATIO=0.6
AUDIO_VERIFY_ENABLED=0
```

`config/app.json`'s `whisper.enabled` (default `false`) is the persisted toggle set from the Settings screen; `AUDIO_VERIFY_ENABLED` can override it per environment.

Secrets:

- OmniVoice runs as a local Python model with no API key — there is nothing to keep secret for TTS.
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
- OmniVoice TTS generation (in-process model call).
- Whisper transcription verification, when enabled.
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
- OmniVoice generation failure -> mark segment `failed`, keep other generated audio.
- Whisper failure to transcribe (when enabled) -> regenerate exact segment until max attempts, then mark segment `verification_failed`.
- Verification mismatch (when enabled) -> regenerate exact segment until max attempts, then mark segment `verification_failed`.
- FFmpeg failure -> include command and stderr in log.
- App restart -> read existing JSON, audio files, transcripts, and logs. Note: a job left `running` when the app process was killed has no automatic recovery today — this is a known gap, not yet built.
- Partial TTS output -> keep files but do not mark story `tts_verified` unless all required segments pass (or are accepted, if verification is disabled).

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
