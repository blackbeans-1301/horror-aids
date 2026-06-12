# Local Workspace Specification

## Principle

One story equals one self-contained audio production workspace.

Assets are grouped by story, not asset type.

## Root Layout

```text
horror-aids/
  data/
    index.json
    jobs.json
    settings.json
  stories/
    [story-slug]/
      story.json
      text/
      audio/
      metadata/
      logs/
      tmp/
  workers/
  config/
```

## Story Folder Layout

```text
stories/can-phong-cuoi-hanh-lang/
  story.json
  text/
    story.md
    characters.json
    segments.json
  audio/
    segments/
      0001-narrator.wav
      0002-main-character.wav
    final.wav
  metadata/
    source.md
    permissions.md
    notes.md
  logs/
    process-story.log
    tts.log
    verify-audio.log
    concat-audio.log
  tmp/
    concat-list.txt
    whisper/
      0001-narrator.txt
      0002-main-character.txt
```

## Naming Rules

- Slugs: lowercase ASCII, numbers, hyphen only.
- Character IDs: lowercase ASCII, numbers, hyphen only.
- Segment IDs: zero-padded 4 digits: `0001`, `0002`, etc.
- Segment audio: `audio/segments/[segment-id]-[speaker-id].wav`.
- Whisper transcript: `tmp/whisper/[segment-id]-[speaker-id].txt`.
- Final audio: `audio/final.wav`.
- Keep filenames stable after segment approval.

## Data Ownership

### `data/index.json`

Purpose: fast story list.

Contains only summary fields:

```json
{
  "stories": [
    {
      "id": "can-phong-cuoi-hanh-lang",
      "title": "Can Phong Cuoi Hanh Lang",
      "status": "segments_review",
      "language": "vi",
      "sourceType": "manual",
      "storyPath": "stories/can-phong-cuoi-hanh-lang/story.json",
      "updatedAt": "2026-06-12T00:00:00.000Z"
    }
  ]
}
```

### `stories/[slug]/story.json`

Purpose: full metadata and workflow state for one story.

Example:

```json
{
  "id": "can-phong-cuoi-hanh-lang",
  "title": "Can Phong Cuoi Hanh Lang",
  "language": "vi",
  "sourceType": "manual",
  "sourceUrl": null,
  "rightsStatus": "original",
  "status": "segments_review",
  "createdAt": "2026-06-12T00:00:00.000Z",
  "updatedAt": "2026-06-12T00:00:00.000Z",
  "text": {
    "storyPath": "text/story.md",
    "charactersPath": "text/characters.json",
    "segmentsPath": "text/segments.json"
  },
  "approvals": {
    "segments": {
      "status": "pending",
      "approvedAt": null
    },
    "verifiedAudio": {
      "status": "pending",
      "approvedAt": null
    },
    "finalAudio": {
      "status": "pending",
      "approvedAt": null
    }
  },
  "audio": {
    "segmentsDir": "audio/segments",
    "finalPath": "audio/final.wav",
    "status": "pending"
  }
}
```

### `text/characters.json`

Purpose: narrator and character voice map.

Example:

```json
{
  "characters": [
    {
      "id": "narrator",
      "name": "Narrator",
      "role": "narrator",
      "voice": "vienue_voice_id"
    },
    {
      "id": "main-character",
      "name": "Main Character",
      "role": "main_character",
      "voice": "vienue_voice_id_2"
    }
  ]
}
```

Roles:

- `narrator`
- `main_character`
- `side_character`
- `villain`
- `other`

### `text/segments.json`

Purpose: ordered contract for TTS generation and verification.

Example:

```json
{
  "segments": [
    {
      "id": "0001",
      "order": 1,
      "speakerId": "narrator",
      "text": "Segment text here.",
      "audioPath": "audio/segments/0001-narrator.wav",
      "whisperTranscriptPath": "tmp/whisper/0001-narrator.txt",
      "status": "pending",
      "verification": {
        "status": "pending",
        "attempts": 0,
        "lastError": null,
        "transcriptPreview": null
      }
    }
  ]
}
```

Segment status:

- `pending`
- `ready`
- `generating`
- `complete`
- `verification_failed`
- `failed`
- `skipped`

Verification status:

- `pending`
- `transcribing`
- `passed`
- `failed`
- `max_attempts_reached`

## Status Values

Story status:

- `story_draft`
- `processed`
- `segments_review`
- `segments_approved`
- `tts_running`
- `tts_verified`
- `audio_validation`
- `ready_to_concat`
- `audio_complete`
- `failed`

Approval status:

- `pending`
- `approved`
- `rejected`

Rights status:

- `original`
- `permission_recorded`
- `reference_only`
- `risk_acknowledged`

Source type:

- `manual`
- `generated_later`
- `reddit_reference_later`
- `reddit_import_later`

## JSON Write Rules

- Use atomic write: write temp file, then rename.
- Create backup before modifying story JSON or segment JSON.
- Validate schema before write.
- Never write binary data into JSON.
- Store paths relative to story folder where possible.

## File Locking

MVP simple rule:

- UI prevents more than one active job per story.
- Active job writes lock marker: `tmp/job.lock`.
- On crash, stale lock can be cleared manually from UI.

## Archive/Delete

Archive:

- Move story folder to `stories/_archive/[slug]/`.
- Mark story removed from `data/index.json`.

Delete:

- MVP should avoid hard delete from UI.
- Provide archive first.

## Validation

Before processing:

- `story.json` exists.
- `text/story.md` exists and is not empty.

Before TTS:

- `text/characters.json` exists.
- `text/segments.json` exists.
- Segments are approved by user button.
- Every segment has valid `speakerId`.
- Every speaker has a VieNue voice.

Before user audio validation:

- Every non-skipped segment has WAV file.
- Every non-skipped segment has Whisper verification status `passed`.
- Failed segments have reached neither unhandled nor silent state.

Before concat:

- User validated verified audio output.
- All non-skipped segments have verified WAV files.
- Segment files are inside `audio/segments/`.
- Output path is `audio/final.wav`.
