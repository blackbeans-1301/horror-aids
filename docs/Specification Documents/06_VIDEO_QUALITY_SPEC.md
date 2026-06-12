# Audio Quality Specification

## Goal

Make verified narration audio good enough to become the foundation for future Vietnamese horror videos.

Quality over output volume.

## Target Format

- Final output: `audio/final.wav`.
- Segment output: `audio/segments/[segment-id]-[speaker-id].wav`.
- Whisper transcript output: `tmp/whisper/[segment-id]-[speaker-id].txt`.
- Language: Vietnamese.
- Style: dark, tense, clear narration.
- Duration target: story-dependent; MVP should support long stories by segmenting audio.

## Story Requirements

- Strong hook early in the story.
- Clear premise.
- Escalating tension.
- Payoff ending.
- Natural Vietnamese wording.
- Avoid stiff translation style.
- Avoid overly long exposition without audio pacing breaks.

## Character Requirements

- One narrator is required.
- Main characters should be clearly identified.
- Side characters and villains should be separate when voice distinction matters.
- Minor one-line speakers can share an `other` voice if needed.
- Every used character must have a VieNue voice before TTS.

## Segment Rules

Segments live in `text/segments.json`.

Each segment should:

- Have one speaker only.
- Preserve reading order.
- Avoid cutting mid-sentence unless intentional.
- Be short enough for reliable TTS generation.
- Preserve punctuation needed for pacing.
- Reference a valid character ID.
- Be approved by user before TTS starts.

## Narration Requirements

- Consistent narrator voice across story.
- Clear pronunciation.
- Slow enough for horror mood.
- No harsh clipping.
- No distracting robotic cadence.
- Audio normalized before final concat.

Minimum QC:

- No missing lines.
- No repeated paragraphs.
- No wrong speaker on obvious dialogue.
- No long silent gaps unless intentional.
- No volume spikes between segments.

## VieNue TTS Requirements

- Use local VieNue host through OpenAI-compatible API.
- Request WAV output.
- Generate one WAV per segment.
- Keep segment files after final concat for debugging/regeneration.
- Do not log API key.
- Record model and voice IDs in logs or result JSON.

## Whisper Verification Requirements

- Every generated segment WAV must be transcribed by Whisper before concat.
- If Whisper cannot transcribe the audio, the segment is treated as bad audio.
- If transcript is empty, too short, or fails comparison checks, the segment is treated as failed verification.
- Failed verification regenerates only the exact failed segment.
- Regenerated segment loops through Whisper verification again.
- The loop stops when the segment passes or reaches configured max attempts.
- Segments that reach max attempts require user intervention and cannot be concatenated.

## FFmpeg Concat Requirements

- Concat only after user confirms verified output in UI.
- Concat by segment `order`.
- Validate every segment WAV exists before concat.
- Validate every required segment has verification status `passed`.
- Normalize/resample if segment formats differ.
- Write final output to `audio/final.wav`.
- Do not overwrite previously approved final WAV unless regeneration is explicitly requested.

## Quality Gates

### Story Gate

Must pass:

- Story text exists.
- Story is readable and coherent.
- Source/rights status is recorded.

### Segment Gate

Must pass:

- Characters exist.
- Segment order is correct.
- Speaker assignment is correct enough.
- All used speakers have voices.
- User clicked approve/accept segments button.

### TTS Verification Gate

Must pass:

- Every non-skipped segment has WAV output.
- Every non-skipped segment has Whisper transcript.
- Every non-skipped segment verification status is `passed`.
- Failed segments are visible.
- User can regenerate failed/bad segments.

### User Validation Gate

Must pass:

- UI shows verified segment output.
- User validates output.
- User clicks confirm concat button.

### Final Audio Gate

Must pass:

- `audio/final.wav` opens and plays.
- Final audio has audible narration.
- Duration is close to sum of segment durations.
- No obvious missing, duplicated, or shuffled segments.
- Final audio approval is recorded.

## Review Checklist

Before final approve:

- Check every segment verification status is passed.
- Inspect any regenerated segment.
- Listen to first 60 seconds.
- Scrub middle sections.
- Listen to ending.
- Check character voice consistency.
- Check obvious dialogue speaker changes.
- Check audio peak/volume.
- Confirm final WAV path.
- Confirm rights/source status.

## Metrics To Track

Per story:

- Segment count.
- TTS generation duration.
- Whisper verification duration.
- Failed verification count.
- Regeneration count.
- Final WAV duration.
- Number of regenerated segments.
- Final approval notes.

Channel later:

- Audience comments about voice/story quality.
- Retention when audio is later used in video.
