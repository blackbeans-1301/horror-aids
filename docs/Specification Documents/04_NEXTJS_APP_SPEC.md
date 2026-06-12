# Next.js Local App Specification

## Goal

Localhost control room for writing stories and producing verified final narration WAV files.

The app manages story text, character voices, segments, TTS jobs, Whisper verification, user validation, final concat, audio review, and logs.

## App Constraints

- Runs locally.
- No login required for MVP.
- No external database.
- Reads/writes local files only.
- Does not expose public network by default.
- Does not require image, video, subtitle, or YouTube integrations.

## Main Screens

### Dashboard

Route: `/`

Shows:

- Story list.
- Status.
- Last updated.
- Active job.
- Verification summary.
- Final audio availability.
- Quick actions.

Actions:

- Create story.
- Open story.
- Archive story.

### Create Story

Route: `/stories/new`

Fields:

- Title.
- Source type, default `manual`.
- Optional initial story text.

Actions:

- Create empty workspace.
- Create workspace with initial `text/story.md`.

### Story Workspace

Route: `/stories/[slug]`

Tabs:

- Overview.
- Story Editor.
- Characters.
- Segments.
- Audio.
- Logs.

Shows:

- Story status.
- Segment approval state.
- Verification state.
- User concat validation state.
- Final audio approval state.
- File tree summary.
- Current active job.

### Story Editor Tab

Capabilities:

- View/edit `text/story.md`.
- Save draft.
- Start story processing.

Rules:

- Editing story after segment processing resets segment approval, verification, concat validation, and final audio approval.
- Empty story cannot be processed.

### Characters Tab

Capabilities:

- View/edit `text/characters.json` through form UI.
- Add/remove character.
- Set role: narrator, main character, side character, villain, other.
- Assign VieNue voice ID per character.

Rules:

- One narrator is required.
- Every segment speaker must reference an existing character.
- TTS is disabled until every used character has a voice.

### Segments Tab

Capabilities:

- View ordered segments from `text/segments.json`.
- Edit speaker, text, and order.
- Add/delete/split/merge segments.
- Approve/reject segments for TTS.
- Show a clear accept/approve button that unlocks TTS.

Rules:

- Segment IDs stay stable after approval where possible.
- Editing approved segments resets TTS and verification readiness for changed segments.
- TTS is disabled until segments are approved.

### Audio Tab

Capabilities:

- Generate and verify TTS for all approved segments.
- Regenerate selected segment audio.
- Rerun Whisper verification for selected segment audio.
- Play per-segment audio.
- Show source text, Whisper transcript, attempt count, and verification status per segment.
- Show unresolved failed segments.
- Confirm verified output for concat.
- Concatenate final WAV after user confirmation.
- Play `audio/final.wav`.
- Approve/reject final audio.
- Show local output paths.

Rules:

- Generate/verify is disabled until segments are approved and voices are assigned.
- Concat confirmation is disabled until every non-skipped segment verification status is `passed`.
- Concat is disabled until user confirms verified output.
- Final audio approval resets if final WAV is regenerated.

### Logs Tab

Capabilities:

- Show active/recent job logs.
- Refresh logs.
- Show worker command.
- Show error status.
- Show verification failure details.

## API Endpoints

Recommended local API routes:

```text
GET    /api/stories
POST   /api/stories
GET    /api/stories/[slug]
PATCH  /api/stories/[slug]
GET    /api/stories/[slug]/story-text
PUT    /api/stories/[slug]/story-text
GET    /api/stories/[slug]/characters
PUT    /api/stories/[slug]/characters
GET    /api/stories/[slug]/segments
PUT    /api/stories/[slug]/segments
POST   /api/stories/[slug]/approve-segments
POST   /api/stories/[slug]/confirm-verified-audio
POST   /api/stories/[slug]/approve-final-audio
POST   /api/stories/[slug]/jobs
GET    /api/jobs
GET    /api/jobs/[jobId]
GET    /api/jobs/[jobId]/log
```

Allowed job types from UI:

- `process_story`
- `generate_verify_tts`
- `concat_audio`

## UI State Rules

- Disable worker buttons when story has active job.
- Disable processing when story text is empty.
- Disable TTS until segments are approved and voices are assigned.
- Disable verified-output confirmation until all required segments pass Whisper verification.
- Disable concat until verified output is confirmed by user.
- Show destructive actions as archive, not delete.
- Show local file paths for outputs.

## Local File Access Rules

- Server side only reads filesystem.
- Client receives sanitized metadata.
- API validates slug.
- API resolves paths under project root only.
- API does not accept arbitrary filesystem paths from client.

## Job Launch Rules

When user starts job:

1. Validate story state.
2. Create job ID.
3. Write job record.
4. Spawn known Python worker.
5. Return job record.
6. UI polls status/log.

## Design Requirements

- Functional over decorative.
- Dense but clear dashboard.
- Story status easy to scan.
- Characters and segments easy to correct.
- Segment approval button prominent.
- Verification status easy to scan.
- Concat confirmation button prominent after all segments pass.
- Logs/errors visible.
- Audio players available where useful.
- No marketing landing page.

## MVP Acceptance Criteria

- User can create a story from browser.
- Story folder appears on disk.
- User can write/edit story text.
- User can process story into characters and segments.
- User can edit and approve segments.
- User can assign VieNue voices.
- User can start generate/verify TTS job only after segment approval.
- User can see Whisper transcript and verification status per segment.
- Failed verification regenerates exact segment.
- User can confirm verified output before concat.
- User can start concat job only after verified output confirmation.
- User can see job status and logs.
- User can play per-segment audio and final WAV.
- User can approve final audio.
