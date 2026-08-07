# Local Workspace Specification

> Partially superseded by `09_WORKSPACE_ISOLATION_SPEC.md` (proposed 2026-08-01): the Root Layout and
> Archive/Delete sections below describe in-repo `data/`+`stories/` roots and direct deletes, both of
> which `09` replaces with per-environment content roots outside the repository and a no-hard-delete
> rule. Story-folder layout, naming rules, JSON schemas, status values, and validation rules in this
> document remain authoritative.

## Principle

One story equals one self-contained audio production workspace.

Assets are grouped by story, not asset type.

## Root Layout

```text
horror-aids/
  data/
    index.json
    jobs.json
    voices.json
    voices/
      [voice-id].wav
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
      "updatedAt": "2026-06-12T00:00:00.000Z",
      "archived": false,
      "archivedAt": null
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
  "archived": false,
  "archivedAt": null,
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

### `data/voices.json`

Purpose: cloned-voice registry shared across all stories.

Example:

```json
{
  "voices": [
    {
      "id": "ong-noi-ke-chuyen",
      "name": "Ong Noi Ke Chuyen",
      "wavPath": "data/voices/ong-noi-ke-chuyen.wav",
      "createdAt": "2026-06-12T00:00:00.000Z"
    }
  ]
}
```

Reference clips live under `data/voices/[id].wav` (uploaded from Settings, 3-5s recommended); only the path is stored in JSON.

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
      "voice": "ong-noi-ke-chuyen"
    },
    {
      "id": "main-character",
      "name": "Main Character",
      "role": "main_character",
      "voice": "some-other-voice-id"
    }
  ]
}
```

`voice` is an ID from `data/voices.json`, resolved to its reference WAV by the worker at generation time; an unknown ID fails that segment rather than silently falling back.

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
      "emotion": "storytelling",
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

`emotion` is `natural` (default for dialogue) or `storytelling` (default for the narrator); segment text can also carry inline cues like `[cười]`/`[thở dài]`/`[hắng giọng]` that the UI documents as typed directly into the segment text.

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

- UI prevents more than one active job per story by checking `data/jobs.json` for a `running` job on that story (no separate lock file).
- Known gap: if the Next.js process is killed mid-job, the job record stays `running` forever with no stale-lock recovery UI yet.

## Archive/Delete

Archive:

- Set `archived: true` and `archivedAt` (ISO timestamp) on `story.json` and its `data/index.json` entry via `PATCH /api/stories/[slug]`.
- Story folder is never moved — this avoids breaking any relative path a running or reopened job depends on.
- Dashboard hides archived stories from the default (Active) view behind a filter toggle.
- Unarchiving clears `archived`/`archivedAt`, restoring the story to the Active view and re-enabling jobs.

Delete:

- MVP has no hard delete from UI.
- Archive is the only removal-from-view mechanism.

## Validation

Before processing:

- `story.json` exists.
- `text/story.md` exists and is not empty.

Before TTS:

- `text/characters.json` exists.
- `text/segments.json` exists.
- Segments are approved by user button.
- Every segment has valid `speakerId`.
- Every speaker has a voice assigned from `data/voices.json`.

Before user audio validation:

- Every non-skipped segment has WAV file.
- Every non-skipped segment has Whisper verification status `passed` (or is `complete` without transcription if verification is disabled — see `03_WORKER_PIPELINE_SPEC.md`).
- Failed segments have reached neither unhandled nor silent state.

Before concat:

- User validated verified audio output.
- All non-skipped segments have verified WAV files.
- Segment files are inside `audio/segments/`.
- Output path is `audio/final.wav`.
