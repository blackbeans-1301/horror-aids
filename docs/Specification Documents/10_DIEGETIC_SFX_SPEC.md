# Diegetic SFX Specification

> **Status: planned, not implemented (as of 2026-08-07).** Nothing described here exists in the codebase yet. Scheduled for a later sprint — see `docs/Plans/20260807-diegetic-sfx/plan.md`.

## Goal

Place story-event sound effects — footsteps, a door knock, thunder, a phone ringing — at the moment the narration reaches that event, so the audio carries the scene instead of only describing it.

The effects are **diegetic**: they exist inside the story world. A sound is inserted because the story says the character heard it, not to decorate a transition.

## Scope

**In scope.** One-shot effects tied to a narrated event, selected from a fixed catalogue, placed against a specific segment.

**Explicitly out of scope** (considered and declined 2026-08-07 — separate features, cheap to add later, but not what this spec is for):

- Continuous ambience beds under the whole narration.
- Variable inter-segment pacing driven by punctuation or emotion.
- Chapter transition stingers.

## Non-negotiable constraints

1. **SFX data never lives in `segments.json`.** Segment text/speaker/emotion changes invalidate TTS audio (see `src/app/api/stories/[slug]/segments/route.ts`). Storing SFX there would make "nudge a sound 200ms later" reset generation state for that segment and force a re-approval round. SFX placement lives in its own file with its own lifecycle.
2. **SFX never triggers TTS regeneration**, and TTS regeneration never invalidates SFX. The two pipelines only meet at concat time.
3. **The catalogue is a closed vocabulary.** Any automated selection step picks an existing catalogue id or nothing. It may never invent a filename.

## Data contracts

### Catalogue — `data/sfx/manifest.json`

Shared across stories. Audio files sit beside it in `data/sfx/`.

```json
{
  "sfx": [
    {
      "id": "door-knock-slow",
      "name": "Gõ cửa chậm, 3 tiếng",
      "path": "data/sfx/door-knock-slow.wav",
      "tags": ["gõ cửa", "đập cửa", "tiếng gõ"],
      "durationMs": 2400,
      "defaultGainDb": -20,
      "license": "CC0",
      "source": "freesound.org/s/123456"
    }
  ]
}
```

- `tags` are Vietnamese surface forms used by the keyword tier and given to the LLM tier as context.
- `license` and `source` are mandatory — this audio ships in published videos.
- All files: mono, same sample rate as `audio.sampleRate` in `config/app.json`, peak-normalised to −3 dBFS so `defaultGainDb` means the same thing across the catalogue.

### Placement — `stories/[slug]/text/sfx.json`

Per story, owned by the SFX pass and the SFX tab. Never written by the TTS worker.

```json
{
  "cues": [
    {
      "id": "cue-0001",
      "segmentId": "0042",
      "sfxId": "door-knock-slow",
      "placement": "after_segment",
      "offsetMs": 120,
      "gainDb": -20,
      "enabled": true,
      "source": "llm",
      "reason": "Nhân vật nghe tiếng gõ cửa lần đầu tiên"
    }
  ]
}
```

- `placement`: `after_segment` | `before_segment` | `in_segment`. `in_segment` additionally requires `atMs` (offset from the segment's own start) and is only produced by the word-aligned tier.
- `offsetMs` is relative to the placement anchor and may be negative.
- `source`: `keyword` | `llm` | `manual`. Manual cues are never overwritten by a re-run of the automated pass.
- `enabled: false` keeps a rejected suggestion visible in the UI without mixing it.

## Placement rules

### Tier 1 — gap placement (default)

Segments are concatenated with `audio.segmentGapMs` (500ms) of silence between them. That gap is a free, always-correct slot: no narration to mask, and the timing reads as "the sound happens right after the sentence that described it".

Anchor offsets are computed the same way `concat_audio.py` already computes the timeline — cumulative segment durations plus gaps.

### Tier 2 — word-aligned placement (upgrade)

Whisper (already in the pipeline, currently disabled via `whisper.enabled`) can emit word-level timestamps for a generated segment WAV. That gives the exact millisecond the narration says "gõ cửa", so the effect can land inside the sentence.

Requires: Whisper run with word timestamps on the segment WAV, and a mapping from the matched phrase back to a word index. Only attempt this after Tier 1 is shipped and the catalogue has proven itself.

## Selection rules

These are the failure modes that make automated SFX sound fake. All of them are selection problems, not mixing problems.

1. **A mention is not an event.** "Tôi vẫn còn nhớ tiếng bước chân đêm đó" is recollection; "Tiếng bước chân vang lên sau lưng tôi" is an event. Only the second gets a sound. Regex cannot tell these apart — this is the reason the LLM tier exists, and the prompt must ask for the distinction explicitly.
2. **Never mask the phrase that names the sound.** An effect firing while the narrator says "tiếng gõ cửa" destroys both. Place after the phrase completes (Tier 2) or in the following gap (Tier 1).
3. **Density cap.** At most one cue per 60–90 seconds of narration, never two cues in the same segment. Over-dense SFX is the most common way horror narration is ruined; the cap is enforced in the generator, not left to taste.
4. **Repeat suppression.** The same `sfxId` may not fire twice within 3 minutes. A recurring knock must escalate or stay silent.

## Mixing

Handled in `concat_audio.py`, after concat and before mastering:

- Each cue becomes an `adelay` on the catalogue file, summed with `amix` (`normalize=0`) against the narration.
- Effective gain: `cue.gainDb` (default `-20`), i.e. clearly under the voice. Nothing above −14 dB.
- Run `loudnorm` after the mix — adding layers invalidates the levels the current mastering chain assumes.
- A cue whose audio file is missing is skipped with a log line, never a hard failure: SFX must not be able to break a story's final render.

## App surface

An **SFX tab** in the story workspace, available once segments are approved:

- Lists cues next to their segment text, with the reason the pass gave.
- Enable/disable, change effect, nudge offset, adjust gain.
- Preview a cue against its segment WAV.
- "Suggest SFX" re-runs the automated pass, preserving `source: manual` cues.

Manual review is not optional. Some suggestions will always land in the wrong place; the tab is what makes that a 10-second fix instead of a reason to abandon the feature.

## Acceptance criteria

- Editing a segment's text does not disturb `sfx.json`, and editing `sfx.json` does not reset any segment's `verification` state.
- A story with no `sfx.json` concatenates exactly as it does today, byte-comparable output.
- Every cue in the shipped render traces to a catalogue entry with a recorded licence.
- On a 30-minute story, the generated cue count stays inside the density cap without manual pruning.
- Disabling every cue produces the same final audio as a story with no cues.
