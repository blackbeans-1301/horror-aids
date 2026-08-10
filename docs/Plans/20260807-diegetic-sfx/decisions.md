# Diegetic SFX — Decision Log

Date: 2026-08-07
Spec: `docs/Specification Documents/10_DIEGETIC_SFX_SPEC.md`
Plan: `./plan.md`

Decisions taken while scoping the feature, each with what was rejected and why. Recorded before implementation so a later sprint does not relitigate them from scratch.

---

## D1 — SFX placement lives in its own file, never in `segments.json`

**Decision.** Cues live in `stories/[slug]/text/sfx.json`, written only by the SFX pass and the SFX tab.

**Why.** Segment text/speaker/emotion changes are the signal that a segment's TTS audio is stale — the segments PUT route resets `status`/`verification` for exactly those segments, and approving segments gates TTS. If cues lived in the same file, nudging an effect by 200ms would invalidate generated audio and force a re-approval round. The two lifecycles are genuinely independent: the same narration WAV can carry many different cue sets.

**Rejected — an `sfx` array on each segment record.** Fewer files and a natural join, but it couples the cheapest edit in the feature (moving a sound) to the most expensive operation in the product (regenerating audio).

**Reversible.** Yes, but only before cues exist for real stories.

---

## D2 — Gap placement first, word alignment later

**Decision.** Default placement is the inter-segment silence (`audio.segmentGapMs`, currently 500ms). In-sentence placement is a later, optional phase.

**Why.** The gap is always correct: no narration to mask, timing reads as "the sound happened right after that sentence", and the offsets fall out of the timeline `concat_audio.py` already computes. It needs no alignment, no Whisper, and no new failure mode. Word alignment is strictly better when it works, and strictly worse when it silently doesn't.

**Rejected — word-level alignment from the start.** Whisper can emit word timestamps and the pipeline already has Whisper, so this is tempting. But it makes the first shippable version depend on enabling verification (currently off), on alignment accuracy in Vietnamese, and on phrase→word-index mapping. Three new failure modes stacked under a feature nobody has heard yet.

**Reversible.** Yes — `placement` is a per-cue field, so both tiers coexist.

---

## D3 — Closed catalogue, and the model may only choose from it

**Decision.** `data/sfx/manifest.json` is the complete vocabulary. Automated selection returns a catalogue id or nothing.

**Why.** It removes the entire class of "the model invented a filename" failures, makes the whole feature auditable, and keeps licence provenance attached to every sound that ships in a video. It also bounds the review surface — a reviewer learns 15 sounds, not an open set.

**Rejected — generative or search-based SFX sourcing.** Unbounded quality, unbounded licence risk, and no way to make a render reproducible.

---

## D4 — A mention is not an event

**Decision.** Selection must distinguish a sound happening now from a sound being recalled, compared, or imagined. Only events produce cues.

**Why.** Horror narration is retrospective by nature — "tôi vẫn còn nhớ tiếng bước chân đêm đó" is the single most common sentence shape in the genre. A matcher that fires on every occurrence of "bước chân" produces sound on recollections, similes and denials, which reads as broken within the first minute.

**Consequence.** The keyword tier alone is insufficient and is only a scaffold. The LLM prompt must ask the event-vs-mention question explicitly and return a `reason` for review.

**Rejected — regex/keyword matching as the shipped selector.** Cheap and deterministic, but wrong on exactly the sentences the genre is made of.

---

## D5 — Density and repetition are capped in code, not in the prompt

**Decision.** At most one cue per 60–90s and never two in one segment; the same effect may not repeat within 3 minutes. Enforced as a post-filter over generated cues.

**Why.** Model output density is not stable across stories or runs, and "be sparing" in a prompt is not a guarantee. Over-dense SFX is the primary way this feature ruins narration, so the limit belongs somewhere it cannot drift.

**Rejected — trusting the prompt.** Works until the day it doesn't, on a story already rendered and uploaded.

---

## D6 — Ambience beds and pacing variation are a separate feature

**Decision.** Excluded from this spec. Diegetic one-shots only.

**Why.** They were proposed together on 2026-08-07 and the operator wanted only the story-event sounds. They are also a different kind of change: ambience is a continuous bed evaluated on feel, one-shots are discrete events evaluated on correctness. Shipping both at once makes the Phase 1 listen-and-decide gate uninterpretable — a bad render would not say which half was at fault.

**Reversible.** Yes, entirely additive later.

---

## D7 — Missing effect audio degrades, never fails

**Decision.** A cue whose file is absent is skipped with a log line; concat continues.

**Why.** SFX is a garnish on an expensive, hours-long pipeline. Nothing about it justifies the power to fail a final render that has already been generated, verified and approved.
