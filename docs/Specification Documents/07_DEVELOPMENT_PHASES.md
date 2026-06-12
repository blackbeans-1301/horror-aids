# MVP Development Phases

## Phase 1: Project Foundation

Goal: create runnable Next.js localhost app and local folder contracts.

Deliverables:

- Next.js app skeleton.
- Local API utilities.
- JSON atomic read/write helpers.
- Story slug/path validation.
- Folder creation helper.
- Basic dashboard.

Acceptance:

- App runs on localhost.
- User can create story.
- `stories/[slug]/` folder tree created.
- `story.json`, `text/story.md`, and `data/index.json` written.

## Phase 2: Story Editor UI

Goal: let the user write and manage original stories locally.

Deliverables:

- Story detail route.
- Story Editor tab.
- Markdown/plain text editor for `text/story.md`.
- Save draft action.
- Status transitions for story draft.

Acceptance:

- User can write and edit story text from UI.
- Empty story cannot be processed.
- Editing story after processing resets segment approval, verification, concat validation, and final audio approval.

## Phase 3: Character And Segment Review UI

Goal: manage narrator/characters and ordered TTS segments.

Deliverables:

- Characters tab.
- Segment tab.
- Character role and VieNue voice fields.
- Segment speaker/text/order editor.
- Explicit approve/accept segments button.
- Segment approval/rejection.

Acceptance:

- User can edit characters and voices.
- User can edit segment order/speaker/text.
- UI blocks TTS until segments are approved and voices assigned.
- Segment approval is recorded before TTS starts.

## Phase 4: Worker Integration

Goal: Next.js can run Python workers safely.

Deliverables:

- Worker command registry.
- Job creation.
- Process spawn.
- Job status polling.
- Log viewer.
- One active job per story.

Acceptance:

- UI can start a test worker.
- Logs appear in UI.
- Failed job marks status failed.
- App restart can read previous job records.

## Phase 5: Story Processing Worker

Goal: process written story into editable character and segment files.

Deliverables:

- `process_story.py`.
- `text/characters.json` output.
- `text/segments.json` output.
- Review flow integration.

Acceptance:

- Worker reads `text/story.md`.
- Worker identifies narrator/characters.
- Worker creates ordered speaker segments.
- User can edit generated output before TTS.

## Phase 6: VieNue TTS And Whisper Verification Worker

Goal: generate one WAV per approved segment and verify it automatically.

Deliverables:

- `generate_verify_tts.py`.
- VieNue config/env support.
- Whisper config/env support.
- Per-character voice use.
- Per-segment audio outputs.
- Per-segment Whisper transcript outputs.
- Failed-segment regeneration loop.
- Audio player UI for segment files.
- Verification status UI.

Acceptance:

- Approved segments can produce WAV files.
- Audio stored under `audio/segments/`.
- Whisper transcript stored under `tmp/whisper/`.
- If Whisper cannot transcribe a segment, exact segment is regenerated.
- Regeneration loop stops only when segment passes or reaches max attempts.
- Failed segments are visible and rerunnable.
- Secrets are not written to logs/story files.

## Phase 7: User Validation And FFmpeg Final Audio Concat

Goal: let user validate verified output, then create final WAV.

Deliverables:

- Verified segment output UI.
- Confirm verified output button.
- `concat_audio.py`.
- FFmpeg concat list generation.
- Final WAV output.
- Final audio player UI.
- Final approval.

Acceptance:

- UI blocks concat until all required segments pass verification.
- UI blocks concat until user confirms verified output.
- Segment WAV files concatenate in order.
- `audio/final.wav` generated.
- User can play final WAV in browser.
- User can approve final audio.

## Phase 8: Polish And Reliability

Goal: make local audio tool usable repeatedly.

Deliverables:

- Error states.
- Stale lock handling.
- Archive story.
- Basic validation messages.
- Audio QC checks.
- Verification retry visibility.
- README setup instructions.

Acceptance:

- One complete audio package can be produced end to end.
- Failed jobs are recoverable.
- Failed verification is visible and actionable.
- User can understand required setup.

## Dependencies

Required local tools:

- Node.js.
- Python 3.
- FFmpeg.
- Whisper implementation available locally.
- Package manager.
- Local VieNue TTS host with OpenAI-compatible API.

## Build Order

Recommended order:

1. Folder and JSON contracts.
2. Story editor UI.
3. Character/segment UI.
4. Worker integration.
5. Story processing worker.
6. VieNue TTS + Whisper verification worker.
7. User validation + FFmpeg concat worker.
8. Audio review and reliability polish.

Reason:

- TTS needs stable character/segment contracts first.
- Verification needs reliable per-segment WAV files first.
- Final concat needs verified and user-confirmed segment output first.
- Video/image/subtitle work should wait until audio pipeline is dependable.
