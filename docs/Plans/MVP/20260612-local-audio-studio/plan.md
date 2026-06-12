# Local Audio Studio MVP Plan

## Summary

Build a localhost Next.js app plus Python workers that turns a user-written Vietnamese horror story into a verified final WAV.

Pipeline:

1. Write story in `text/story.md`.
2. Process story into `characters.json` and `segments.json`.
3. User edits and approves segments.
4. Generate segment WAV files through VieNue TTS.
5. Verify every segment with Whisper transcription.
6. Regenerate only failed segments until pass or retry limit.
7. User confirms verified output.
8. Concatenate verified WAV files into `audio/final.wav`.
9. User approves final audio.

## Architecture

- Next.js App Router UI and API routes.
- Local JSON/file store under `data/` and `stories/`.
- Python workers under `workers/`.
- VieNue TTS OpenAI-compatible speech endpoint support.
- Whisper verification support with local fallback for development.
- FFmpeg concat support with Python WAV fallback for development.

## Implementation Phases

### Phase 1: Foundation

- Add Next.js, TypeScript, scripts, and app shell.
- Add file-store helpers for atomic JSON writes.
- Add story slug/path validation.
- Add local workspace creation.

Acceptance:

- `npm run build` compiles.
- App can create `stories/[slug]/` with `story.json` and `text/story.md`.

### Phase 2: Story UI

- Dashboard with story list and create form.
- Story workspace route.
- Story editor tab for `text/story.md`.
- Save draft resets downstream approvals when needed.

Acceptance:

- User can create, open, and edit stories.

### Phase 3: Characters And Segments

- Character editor with role and VieNue voice fields.
- Segment editor with speaker/text/order controls.
- Add/delete/split/merge segment actions.
- Explicit approve/accept segments button.

Acceptance:

- TTS actions stay disabled until segments approved and voices assigned.

### Phase 4: Jobs

- Job registry and worker spawning.
- Job status polling and log viewer.
- One active job per story.

Acceptance:

- UI can start workers and inspect logs.

### Phase 5: Workers

- `process_story.py` generates editable characters and segments.
- `generate_verify_tts.py` creates segment WAVs, Whisper transcripts, verification statuses, and failed-segment retry loop.
- `concat_audio.py` validates verified/user-confirmed segments and writes final WAV.

Acceptance:

- One story can move through process -> verify -> concat.

### Phase 6: Review And Reliability

- Segment verification status visible in UI.
- User confirmation gate before concat.
- Final audio player and approval.
- README setup instructions.

Acceptance:

- Final demo checklist in `08_ACCEPTANCE_CRITERIA.md` passes locally.

## Data Contracts

Story workspace:

```text
stories/[slug]/
  story.json
  text/story.md
  text/characters.json
  text/segments.json
  audio/segments/*.wav
  audio/final.wav
  logs/*.log
  tmp/whisper/*.txt
```

Job types:

- `process_story`
- `generate_verify_tts`
- `concat_audio`

Required user gates:

- Segment approval before TTS.
- Whisper verification before concat confirmation.
- User confirmed verified output before concat.
- Final audio approval before `audio_complete`.

## Verification Plan

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Python worker smoke tests:
  - create story fixture
  - run `process_story.py`
  - run `generate_verify_tts.py` in fake local mode
  - run `concat_audio.py`
  - verify `audio/final.wav`

## Assumptions

- Story generation, Reddit import, images, subtitles, video rendering, and YouTube export are outside MVP.
- VieNue local host is the production TTS path.
- Fake local TTS/verification mode is allowed only for development verification when VieNue or Whisper is unavailable.
