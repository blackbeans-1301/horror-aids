# Horror Aids MVP Product Requirements

## Product

Local-first Vietnamese horror audio production studio for one creator.

Goal: help the creator write a horror story, split it into narrator/character audio segments, generate local OmniVoice TTS audio, optionally verify each generated audio segment with Whisper, and concatenate approved narration into one WAV file.

Not goal: video rendering, image generation, subtitles, YouTube upload, or fully automated content farming.

## Target User

- Single operator.
- Own horror channel or audio library.
- Writes stories manually in the app.
- Works locally on laptop/desktop.
- Wants controlled audio quality before any future video work.

## Core Workflow

1. Create story workspace.
2. Write story in the Next.js editor.
3. Process story into character definitions.
4. Segment story text by narrator and characters in reading order.
5. Review/edit characters, voices, and segments.
6. Click approve/accept segments to unlock TTS.
7. Generate per-segment WAV files through the local OmniVoice model.
8. If Whisper verification is enabled, auto-verify each segment with Whisper transcription.
9. If Whisper cannot transcribe a segment or verification fails, regenerate that exact segment and verify again.
10. Repeat the regenerate/verify loop until every required segment passes or reaches the retry limit.
11. Show verified segment output in the UI for user validation.
12. User clicks confirm concat.
13. Concatenate verified segment WAV files with FFmpeg.
14. Review final `audio/final.wav` in the app.
15. Mark audio complete.

## MVP Scope

### In Scope

- Next.js app running on localhost.
- Local JSON files as database.
- Story-based workspace folders under `stories/[story-slug]/`.
- Story writing editor backed by `text/story.md`.
- Character/narrator definition workflow.
- Ordered segment review workflow with explicit accept button.
- Per-character voice assignment from a local voice-cloning registry (`data/voices.json`).
- Python workers for story processing, OmniVoice TTS generation, optional Whisper verification, segment regeneration, and FFmpeg concat.
- Final audio output as WAV.
- Human approval before TTS and before final concat.
- Optional auto verification loop before user concat confirmation (Whisper on/off toggle in Settings, default off).
- Archive a story to hide it from the active dashboard view without deleting it.

### Out Of Scope

- Hosted SaaS.
- Multi-user auth.
- PostgreSQL/Redis/S3.
- Kubernetes/cloud deploy.
- Story generation as required workflow.
- Reddit scraping/import as MVP workflow.
- Image generation.
- Subtitle generation.
- Video rendering.
- Thumbnail generation.
- YouTube metadata/export/upload.
- Monetization guarantee.
- Copyright/legal guarantee.

## Success Criteria

- User can create a new story from UI.
- System creates `stories/[slug]/` with required folders.
- User can write and edit the story in `text/story.md`.
- System can create editable `characters.json` and `segments.json`.
- User can assign cloned voices to narrator/characters from the voice registry.
- User can approve ordered segments with an explicit UI button.
- Python worker can generate one WAV per segment.
- Python worker can verify segment audio by transcribing it with Whisper when verification is enabled.
- Failed verification regenerates only the exact failed segment.
- UI shows verification status for every segment.
- User can validate verified output before concat.
- Python worker can concatenate all verified segment WAV files into `audio/final.wav`.
- User can play final WAV in the UI.
- All story assets stay inside the story folder.
- No large media stored inside JSON.

## Content Policy

- MVP assumes stories are user-written or manually pasted by the creator.
- Generated/reddit workflows are later-phase only unless explicitly added.
- Non-original source notes can be stored in `metadata/source.md`.
- Permission records can be stored in `metadata/permissions.md`.
- Each produced audio package should have source status recorded in `story.json`.

## Quality Principles

- Fewer stories, better narration quality.
- Consistent narrator voice.
- Character voices must be intentionally assigned.
- Segments must preserve reading order.
- Audio should avoid clipping, harsh volume jumps, repeated lines, and missing lines.
- When Whisper verification is enabled, a segment must pass it before becoming eligible for concat; when disabled, a segment is accepted as soon as it generates and should be spot-checked by ear instead.
- Final concat requires user validation of verified segment output.
- Final WAV review required before story is marked complete.

## Non-Functional Requirements

- Runs locally without external database.
- Works with filesystem as source of truth.
- Recoverable after app restart.
- Jobs must write logs.
- Failed jobs must not corrupt approved text or existing audio.
- JSON writes must be atomic.
- Worker commands must be visible and reproducible.
- OmniVoice runs in-process locally; there are no TTS provider secrets to protect.
- Whisper verification failures must be recorded per segment when verification is enabled.

## Risks

- Character segmentation may misidentify speakers.
- Voice assignment mistakes create confusing audio.
- OmniVoice generation errors may leave partial segment audio.
- Whisper can produce false negatives on stylized voices or noisy output.
- Running with verification disabled means bad audio can only be caught by manual listening.
- Regeneration loop can get stuck if provider repeatedly returns bad audio; use a retry limit and manual failure state.
- FFmpeg concat can fail if segment formats differ.
- Long stories can create many segment files.
- JSON corruption if multiple writes happen at once.

## MVP Definition Of Done

- One user-written story can move from draft text to reviewed final WAV.
- Operator can inspect story text, characters, segments, per-segment audio, Whisper verification results (if enabled), final audio, and logs in local folders.
- No infrastructure required beyond Node, Python, FFmpeg, optional Whisper, and the bundled OmniVoice model/venv.
