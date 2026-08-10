# Diegetic SFX Plan

Date: 2026-08-07
Spec: `docs/Specification Documents/10_DIEGETIC_SFX_SPEC.md`
Decisions: `./decisions.md`

Status: **not started.** Deferred to a later sprint by the operator on 2026-08-07; written down now so the reasoning survives.

## Summary

Insert story-event sounds — footsteps, a door knock, thunder — at the point the narration reaches the event, driven off a fixed catalogue and mixed at concat time.

The hard part is not detection. It is **placement** (a sound in the wrong 300ms reads as a mistake) and **suppression** (knowing when a mentioned sound should *not* play). Both are addressed before any clever tooling: ship the boring, always-correct placement first, and only then attempt in-sentence timing.

## Phasing

Each phase is independently shippable and independently useful. Stop after any of them.

### Phase 1 — catalogue and mixing (no automation)

Build the plumbing with hand-written cues, so the mix path is proven before anything generates cues.

1. `data/sfx/manifest.json` + 10–15 CC0 effects covering the recurring beats of the genre: footsteps (slow/running), door (knock/creak/slam), thunder, wind gust, phone ring, breathing, glass break, whisper.
2. Normalise every file: mono, project sample rate, peak −3 dBFS.
3. `stories/[slug]/text/sfx.json` reader in `concat_audio.py`; cues placed in the inter-segment gap; `adelay` + `amix` + `loudnorm` after the existing mastering chain.
4. Hand-author cues for one real story and listen to the whole render.

**Exit criterion:** a story with hand-written cues renders correctly, and the same story with all cues disabled renders byte-identically to today.

Phase 1 is where the feature is proven or abandoned. If hand-placed effects at gap boundaries do not sound good on a real story, no amount of automation will fix that, and the remaining phases should be dropped.

### Phase 2 — SFX tab

The review surface, before automation, because automation without review is unusable.

1. Tab listing cues against segment text; enable/disable, change effect, nudge offset, adjust gain.
2. Preview a cue mixed against its own segment WAV.
3. Its own API route — **not** the segments PUT, which resets approvals.

**Exit criterion:** a cue can be added, auditioned, moved and disabled without touching segment state.

### Phase 3 — automated suggestion

1. **Keyword tier**: match catalogue `tags` against segment text. Deterministic, free, and it establishes the cue-generation shape.
2. **LLM tier**: one pass over approved segments, choosing only from catalogue ids, and answering per candidate: *is this an event happening now, or a mention/recollection?* Only events become cues. The model returns a `reason`, which the tab shows — an unreviewable suggestion is not worth having.
3. Apply density cap and repeat suppression as a post-filter, in plain code, not in the prompt.
4. Re-running preserves `source: manual` cues.

**Exit criterion:** on a 30-minute story, generated cues stay inside the density cap and a review pass rejects fewer than ~1 in 4.

### Phase 4 — word-aligned placement (optional)

Only if Phase 1–3 land well and gap placement proves too coarse.

1. Enable Whisper word timestamps for segments that carry a cue.
2. Map the matched phrase to a word index → millisecond offset inside the segment.
3. Place the effect after the phrase completes, never over it.
4. Fall back to gap placement whenever alignment is uncertain.

## Risks

| Risk | Mitigation |
| --- | --- |
| SFX makes narration sound cheap | Density cap in code; Phase 1 is a listen-and-decide gate before any automation is built |
| Effect masks the words naming it | Gap placement by default; word alignment only when confident |
| Licence contamination in published videos | `license` + `source` mandatory in the manifest; CC0 only |
| SFX work invalidates TTS audio | Separate file, separate route, separate lifecycle — see spec constraint 1 |
| A missing effect file breaks a final render | Missing files are skipped with a log line, never fatal |

## Out of scope

Ambience beds, punctuation-driven pacing, transition stingers. Considered on 2026-08-07 and declined — worth revisiting separately, but they are atmosphere features, not story-event features, and mixing the two in one sprint muddies the listen-and-decide gate in Phase 1.
