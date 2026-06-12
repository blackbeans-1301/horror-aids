# MVP Acceptance Criteria

## End-To-End Scenario

User can produce one verified Vietnamese horror narration WAV locally.

Flow:

1. Open Next.js app on localhost.
2. Create story.
3. Write story in Story Editor.
4. Process story into characters and segments.
5. Review/edit characters and assign VieNue voices.
6. Review/edit ordered segments.
7. Click approve/accept segments button.
8. Generate per-segment WAV files through VieNue TTS.
9. Auto-transcribe every segment with Whisper.
10. Regenerate exact failed segment until it passes or reaches retry limit.
11. Show verified segment output in UI.
12. User validates output and clicks confirm concat.
13. Concatenate verified segment WAV files with FFmpeg.
14. Review `audio/final.wav`.
15. Approve final audio.

## Functional Acceptance

### Story Management

- Create story workspace.
- List stories.
- Open story.
- Update story metadata.
- Archive story.

### Story Editor

- Edit `text/story.md`.
- Save draft.
- Prevent processing empty story.
- Reset segment approval, verification, concat validation, and final approval if story changes after processing.

### Characters

- Generate characters from story processing.
- Edit character name, role, and VieNue voice.
- Require one narrator.
- Ensure every used segment speaker exists.

### Segments

- Generate ordered segments from story processing.
- Edit segment speaker/text/order.
- Add/delete/split/merge segments.
- Approve/reject segments through explicit UI button.
- Reset affected audio and verification readiness when approved segment text changes.

### Jobs

- Start allowed worker job.
- Prevent concurrent story jobs.
- Show status.
- Show logs.
- Show failure reason.
- Recover after app restart.

### Audio Verification

- Generate narration from approved segments.
- Store per-segment WAV files inside `audio/segments/`.
- Transcribe each segment with Whisper.
- Store Whisper transcript under `tmp/whisper/`.
- Mark segment verification status.
- Regenerate exact segment when Whisper cannot transcribe or verification fails.
- Stop regeneration at configured max attempts and show actionable failure.
- Play segment audio in UI.
- Regenerate selected segment audio manually.
- Show source text, Whisper transcript, attempt count, and verification status.

### User Validation And Concat

- Show all verified segments in UI.
- Block concat until all required segments pass verification.
- User confirms verified output before concat.
- Concatenate final WAV with FFmpeg.
- Store final output at `audio/final.wav`.
- Play final WAV in UI.
- Approve/reject final audio.

## Non-Functional Acceptance

- No database server required.
- No cloud storage required.
- No image generator required.
- No video renderer required.
- No subtitle generator required.
- No YouTube upload/export required.
- App works from local filesystem.
- JSON files remain valid after normal operations.
- Large audio files are not embedded in JSON.
- Worker logs are inspectable.
- Paths cannot escape project root.

## Quality Acceptance

For segment audio:

- Every required segment has WAV output.
- Every required segment has Whisper transcript.
- Every required segment verification status is `passed`.
- Failed/regenerated segments are visible.

For final audio:

- `audio/final.wav` opens in browser/player.
- Has audible narration.
- Has no obvious missing sections.
- Has no obvious duplicated sections.
- Segment order is correct.
- Character voice assignment is acceptable.
- Duration is close to expected segment total.
- Final approval recorded.

## Safety Acceptance

- API keys are not written to story folders.
- Worker commands are selected from known registry.
- User cannot run arbitrary shell command from UI.
- Story source/rights status is recorded.
- Non-original sources support permission/risk notes.

## MVP Not Accepted If

- App requires PostgreSQL/Redis/S3.
- App requires image provider.
- App requires video rendering.
- App requires subtitle generation.
- App requires YouTube upload/export.
- TTS can run before segment approval.
- Concat can run before every required segment passes Whisper verification.
- Concat can run before user validates verified output.
- Failed verification silently passes.
- Failed worker silently succeeds.
- JSON contains audio binary data.
- Story cannot be moved/archived as one folder.

## Final Demo Checklist

- Fresh clone/setup works.
- Create one manual story.
- Write story text.
- Process story.
- Edit/approve characters and segments.
- Generate per-segment audio.
- Verify segment audio with Whisper.
- Regenerate failed segment if verification fails.
- Confirm verified output in UI.
- Concatenate final WAV.
- Play final WAV.
- Approve final audio.
- Show all files under one `stories/[slug]/` folder.
