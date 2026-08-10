# Automated video assembly stage (after audio_complete)

## Context

Horror Aids currently stops at verified, mastered narration audio
(`audio/final.m4a`, story status `audio_complete`). Turning that into a
published YouTube video is still 100% manual editing today. The operator
wants that editing step folded into the same local-first pipeline the rest
of the app already uses — not a web video editor, but a **formula**: every
story's video is built from the same fixed recipe (intro card → looped
ambience footage under the narration, with a music bed and rain bed mixed
underneath), pulling from small reusable libraries plus exactly one
per-story input (the intro image). This is exactly the "worker script +
job queue + human-approval-gate" shape the TTS/concat pipeline already
uses, so the plan below extends that architecture rather than inventing a
new one.

Two adjacent things already in the repo confirm this direction and its
conventions: `docs/Specification Documents/10_DIEGETIC_SFX_SPEC.md` (a
closed-vocabulary catalog + per-story placement file + concat-time mixing,
designed but not yet built) and the voice-cloning registry
(`data/voices.json` + `data/voices/*.wav`, the existing precedent for "a
small shared media registry with an upload UI"). Neither is a media-asset
library for music/video — `src/features/library` is unrelated, it's a git
submodule browser for story *text*.

Decisions locked in with the operator: landscape **1920x1080**, intro
duration is a configurable number of seconds (default in `config/app.json`,
overridable per story), the media library needs a proper upload/manage UI
(nothing exists to reuse), and per-story asset picks are **auto-selected
(random) then reviewable/overridable** before rendering — the goal is to
save editing time, not to force manual selection every time.

The FFmpeg filter graphs, schemas, and file layout below were designed and
**verified by executing them against this machine's real ffmpeg 8.1.1**
(`-f null -` dry runs against real segment audio) — durations, frame
counts, and the concat seam all came out exact. This is a technical design,
not a guess.

## Recommended approach

### 1. Media catalog — new shared registry, distinct from `/library`

One manifest, one directory tree, following the `data/voices.json` /
`10_DIEGETIC_SFX_SPEC.md` precedent:

```
data/media/
  manifest.json
  bg_music/       bg-dread-drone-01.m4a
  rain_ambience/  rain-heavy-window.m4a
  intro_music/    intro-whisper-bell.m4a
  scene_video/    scene-rain-window-night.mp4
```

`data/media/manifest.json`:

```jsonc
{
  "schemaVersion": 1,
  "media": [
    {
      "id": "bg-dread-drone-01",
      "category": "bg_music",
      "name": "Dread drone, chậm, không nhịp",
      "tags": ["drone", "u ám"],
      "path": "data/media/bg_music/bg-dread-drone-01.m4a",
      "loopable": true,
      "durationMs": 187000,
      "integratedLufs": -18.4,
      "defaultGainDb": -22,
      "license": "CC0",
      "source": "freesound.org/s/123456",
      "notes": "",
      "addedAt": "2026-08-10T09:00:00.000Z"
    },
    {
      "id": "scene-rain-window-night",
      "category": "scene_video",
      "name": "Mưa trên cửa sổ, ban đêm",
      "tags": ["mưa", "cửa sổ"],
      "path": "data/media/scene_video/scene-rain-window-night.mp4",
      "loopable": true,
      "durationMs": 42000,
      "width": 1920, "height": 1080, "fps": 30,
      "hasAudioStream": true,
      "license": "Pexels License",
      "source": "pexels.com/video/1234567",
      "notes": "",
      "addedAt": "2026-08-10T09:00:00.000Z"
    }
  ]
}
```

`src/types/story.ts` additions:

```ts
export type MediaCategory = 'bg_music' | 'rain_ambience' | 'intro_music' | 'scene_video';

export interface MediaAssetBase {
  id: string; category: MediaCategory; name: string; tags: string[];
  path: string; loopable: boolean; durationMs: number | null;
  license: string; source: string; notes: string; addedAt: string;
}
export interface AudioMediaAsset extends MediaAssetBase {
  category: 'bg_music' | 'rain_ambience' | 'intro_music';
  integratedLufs: number | null;   // measured at ingest via ffmpeg loudnorm
  defaultGainDb: number;
}
export interface VideoMediaAsset extends MediaAssetBase {
  category: 'scene_video';
  width: number | null; height: number | null; fps: number | null;
  hasAudioStream: boolean;
}
export type MediaAsset = AudioMediaAsset | VideoMediaAsset;
export interface MediaLibraryFile { schemaVersion: number; media: MediaAsset[] }
```

Why one manifest, not four: every category shares almost every field
(a discriminated union on `category`), and the operations that actually
matter — "does this id still exist", "who references this id before I
delete it", "does every asset have a recorded licence" — are one-liners
over one array and awkward over four files.

Why `integratedLufs` at ingest instead of peak-normalizing files (the SFX
manifest's approach): that works for one-shot SFX but is wrong for
continuous beds — a sparse drone and dense rain loop at the same peak dBFS
sound very different in loudness. Measuring integrated LUFS once (via
`ffmpeg -af loudnorm=print_format=json -f null -`) and applying
`volume = (REF_LUFS − integratedLufs) + gainDb` at render time makes
`defaultGainDb: -22` mean the same thing for every asset, without
re-encoding operator-supplied files (which would cost quality and muddy
licence provenance). If ffprobe/ffmpeg can't probe a file at ingest, accept
it anyway with `null` metadata (adding an asset must not require a working
toolchain; rendering already requires one and will fail there instead).

`json-store.ts` additions: `readMediaLibrary`, `addMediaAsset` (multipart
upload — a 60MB scene video as base64-in-JSON, `addVoice`'s current
approach, is a non-starter), `deleteMediaAsset` (409 + `referencedBy` list
of stories if any non-archived story's plan still points at it, `force`
overrides), `findMediaReferences`, `resolveMediaAssetFile`. Same
`ensureDataFiles()` bootstrap pattern as `voices.json`.

Ids are global (not per-category) — a plan stores bare ids, so one
`Map` lookup answers "does this exist", same `slugify()`+suffix pattern as
`addVoice`. `license`/`source` are required at the API boundary (400 on
empty) — this audio/video ships in published videos
(`05_CONTENT_AND_RIGHTS_SPEC.md`).

### 2. Per-story video plan — `stories/[slug]/video/plan.json`

New `video/` directory, sibling to `audio/` (not `text/`, unlike
`sfx.json`): the plan references a shared catalog and produces a render
artifact, it isn't part of narration authoring, and mirroring
`audio/{segments,final.m4a}` means the whole video side reveals/zips/
deletes as one unit.

```
stories/[slug]/video/
  plan.json      operator's choices — auto-seeded, then reviewable
  intro.jpg      the one true per-story upload
  final.mp4      render output
  render.json    render receipt (written by the worker, licence/source audit trail)
```

```ts
export interface VideoPlanFile {
  schemaVersion: number;
  introImagePath: string | null;         // 'video/intro.jpg'
  introMusicId: string | null;
  introDurationMs: number;               // seeded from config.video.introDurationMs
  introMusicGainDb: number;
  sceneVideoId: string | null;
  bgMusicId: string | null;
  bgMusicGainDb: number;
  rainAmbienceId: string | null;
  rainAmbienceGainDb: number;
  leadInMs: number;                      // silence before first word, under the beds
  tailOutMs: number;                     // beds continue after last word before fade
  transitionMs: number;                  // intro -> main dip-to-black length
  duckingEnabled: boolean;
  updatedAt: string;
}
```

`null` vs "id no longer in the catalog" are deliberately different states:
`null` = "this story has no music bed", a valid editorial choice, rendered
silently by omitting that mix layer. A **dangling id** = a broken choice
and always hard-fails before rendering (see §5) — silently rendering it as
silence would ship a mix that doesn't match what the plan claims.

**Auto-selection (the operator's explicit ask — auto-pick, then let me
change it before rendering):** the first time a story's video plan is
requested (`GET /api/stories/[slug]/video-plan` finds no `plan.json` on
disk), the server randomly picks one asset per category from the current
catalog (uniform random over that category's entries; a category with zero
entries is left `null`), writes the result to `plan.json` so the pick is
stable across reloads/reruns, and returns it. The Video tab shows these
picks pre-filled with a **"🎲 Random hoá lại"** button that re-rolls all
four picks via `POST /api/stories/[slug]/video-plan/randomize` (same random
logic, re-persisted) — for when the auto-pick doesn't fit the story.
Manual per-field overrides via the four `<select>`s always win until the
operator randomizes again. `introImagePath` is never auto-filled — it has
no catalog to pick from, it is the one true manual input.

Gains are seeded from each asset's `defaultGainDb` at pick/override time,
then become a story-local value the catalog can't move later (mirrors
`sfx.json`'s cue-level gain override).

`render.json` (written on success, never read back by the pipeline) is the
audit trail satisfying `05_CONTENT_AND_RIGHTS_SPEC.md`: every third-party
asset used, its licence/source, and the actual applied gain after loudness
normalization.

### 3. FFmpeg composition pipeline (verified against real ffmpeg)

Timeline: `introSec` is `plan.introDurationMs`, snapped to a whole number
of frames (an unsnapped seam causes a duplicated/dropped frame at the
single most-watched moment of the video). `mainSec = leadInMs + narrationSec
+ tailOutMs`, where `narrationSec` comes from `ffprobe` on
`audio/final.m4a`.

**Looping — `-stream_loop -1` bounded by an input-level `-t <mainSec>`,
not the `loop`/`aloop` filters.** `aloop`/`loop` buffer decoded frames in
memory; looping a 42s 1080p clip that way needs ~3.9GB of raw YUV420p.
`-stream_loop` re-demuxes from the start with constant memory and works
identically for the scene video, bg music, and rain bed. Verified:
`-stream_loop -1 -t 95 -i <32.6s file>` → exactly `time=00:01:35.00`. The
scene video's own audio stream (if any) is always discarded — the graph
never maps it — logged once if present, so the operator isn't puzzled by
silent footage.

**Intro branch (image + Ken Burns):** blurred-fill backdrop (computed at a
480x270 proxy then upscaled — ~50x cheaper than blurring at full res, no
visible difference) behind a centered fitted foreground, so an
arbitrary-aspect-ratio intro image never shows black pillarboxes; composite
built at 2x target resolution, `zoompan` (with `d=1`, animated via `on`,
*not* `d=<frames>` — the classic zoompan-on-a-still bug) scales down to
target, which hides its 1px crop-window jitter. Default push-in
`zoomEnd=1.12` over the intro duration.

**Main branch (video):** scale+crop to fill 1920x1080 (never letterbox —
ambience footage cropping its edges costs nothing), `setpts=N/FRAME_RATE/TB`
after the loop to rebuild monotonic timestamps (defends against PTS
discontinuities at each `-stream_loop` boundary surviving into `concat` and
causing drift over a 25-minute program), a light config-driven grade
(`eq` brightness/saturation + `vignette`) so stock footage reads as this
channel's look rather than raw stock.

**Main branch (audio) — three-layer leveling:**
1. Static catalog normalization (`integratedLufs` → common loudness, above).
2. **Sidechain-duck the music bed against the narration; do not duck the
   rain.** Rain is spectrally dense/continuous — ducking it makes it
   audibly "breathe" with the narrator, the most common tell of an
   automated mix. Music has content that genuinely competes with speech
   and ducks inaudibly with a long release. `sidechaincompress`:
   `threshold=0.05 ratio=6 attack=50 release=1000 makeup=1 detection=rms`.
   **`release=1000` is load-bearing** — `config/app.json`'s
   `segmentGapMs: 500` means a shorter release would pump the music back up
   in every inter-segment gap across the whole narration. Rain instead gets
   a static gain 4dB under the music default (`-26` vs `-22`).
3. `loudnorm` (`I=-16:TP=-1.5:LRA=11`) on the summed main bus — the SFX
   spec's own rule ("adding layers invalidates the levels the mastering
   chain assumes") applied at the mix stage, since `concat_audio.py`'s
   mastering sets levels for narration alone.

The narration is `aformat`ted to stereo *before* `asplit` (sidechain key
and bed must match sample rate/layout or the filter errors), and the split
happens *after* `adelay`/`apad` for lead-in (so the duck key is
time-aligned with what's actually heard).

**Intro→main transition: hard cut through black (`fade` out + `fade` in +
the `concat` filter), not `xfade`/`acrossfade`.** `xfade`'s offset must be
computed from an exact seconds value derived from an `ffprobe`'d M4A
duration — a rounding error there causes `xfade` to silently freeze/drop
frames rather than error, the worst failure mode in a pipeline reviewed
once per story. `concat` is deterministic as long as both branches are
forced to matching resolution/SAR/pixel-format/fps (video) and
rate/layout/format (audio) — verified exact: 6s + 8s branches → exactly 420
frames at 30fps. The beat of black (intro music fades → black → rain rises
→ first word) is also editorially the right feel for "a story is
starting," better than a cross-dissolve into moving footage.

**Encoder: `libx264 -preset medium -crf 20`** by default (config-overridable
to `h264_videotoolbox` for fast iteration at a size/quality cost). x264
specifically suits this content: after the scene video's first loop cycle,
motion estimation finds near-perfect matches against the previous cycle and
bitrate collapses — VideoToolbox's H.264 encoder is markedly weaker at that
regime. `-c:a aac -b:a 192k -ar 48000 -ac 2` (departs from the narration
mastering's mono 96k — the mix now carries stereo beds and YouTube expects
48kHz stereo).

Output is written to `video/.final.mp4.partial` and atomically renamed to
`video/final.mp4` only after a clean exit and non-zero size — a killed
10-minute render must never leave a truncated file the UI would offer for
download. Progress is read from `-progress pipe:1` and logged (via
`ctx.log()`, ≤ once every 5s) so the existing LogsTab doesn't look hung
during a long encode.

Full graph text, exact filter chains, and the assembled `ffmpeg` invocation
are written out in full in the design agent's report (this session) and
should be transcribed directly into `workers/render_video.py` — they were
verified to produce exact durations/frame counts against this machine's
ffmpeg, not just theorized.

### 4. Job / status / approval wiring (extends existing pipeline exactly)

- `JobType` gains `'render_video'`; `workerScripts` in `job-runner.ts` gains
  `render_video: 'render_video.py'`; `JOB_TYPES` in `json-store.ts` (for
  analytics) gains it too.
- New `workers/render_video.py`, same `WorkerContext`/`ctx.log`/`ctx.result`
  contract as the other workers, **plus** `install_stop_handler()` (unlike
  `concat_audio.py`) — a render can run for minutes and must be stoppable;
  forwards SIGTERM to the ffmpeg child. Exit 0 / `STOPPED_EXIT_CODE` (75) /
  failure — no `NEEDS_REVIEW` case, a render is all-or-nothing.
- Concurrency: generalize `MAX_CONCURRENT_TTS_JOBS` into a per-type map so
  `render_video` gets its own cap (`HORROR_AIDS_MAX_RENDER_JOBS`, default 1)
  independent of the TTS cap — x264 is CPU-bound, OmniVoice is GPU/Metal
  bound, so they can genuinely run concurrently without halving each other.
- **One new `StoryStatus`: `'video_complete'`.** Following the
  `concat_audio` precedent exactly: `render_video` does **not** move
  `story.status` (stays `audio_complete`), it sets a new `story.video`
  block's status to `complete` and resets `approvals.finalVideo` to
  pending; approving that gate is what sets `status = 'video_complete'`.
  No `video_rendering` status — `concat_audio` has none either and the
  existing `ActiveJobBanner` already communicates in-flight work.
- `StoryRecord` gains `approvals.finalVideo: ApprovalStatus` and a `video:
  { planPath, finalPath, status, durationMs, renderedAt }` block, both
  **backfilled in `readStory()`** the same way `archived`/`sourceContentId`
  already are (every story.json on disk today lacks them) — skipping this
  crashes the workspace UI on `undefined.status`. `writeStoryText()` resets
  `finalVideo` approval like the other three, but must **not** touch
  `plan.json`/`intro.jpg` — those are expensive human choices that survive
  a text edit and a re-render.
- `assertCanStartJob`'s new `render_video` branch (mirrors the existing
  `concat_audio` branch's strictness): requires `finalAudio` approved +
  file exists; requires a plan exists with `introImagePath` set and the
  file present; resolves every non-null `*Id` against the catalog,
  hard-failing on a dangling id or wrong-category id (not just "missing" —
  see §5); requires `sceneVideoId` specifically (the one non-optional
  layer); sanity-bounds `introDurationMs`/`leadInMs`/`tailOutMs`. Because
  `launchJob()` already re-validates at launch (existing behavior), a media
  asset deleted while a render sits queued fails cleanly instead of
  spawning a doomed worker — no new machinery needed.
- New API routes: `GET/POST/DELETE /api/media`, `GET /api/media/asset`
  (streaming preview, reusing the existing Range/ETag asset-streaming code),
  `GET/PUT /api/stories/[slug]/video-plan`, `POST
  /api/stories/[slug]/video-plan/randomize`, `POST/DELETE
  /api/stories/[slug]/intro-image`, `POST
  /api/stories/[slug]/approve-final-video`, `POST
  /api/stories/[slug]/reveal-final-video`. The existing
  `/api/stories/[slug]/asset` route's hard `audio/`-only guard widens to
  allow `video/` too (same path-escape check, `.mp4`/`.jpg`/`.png`/`.webp`
  content-type mapping added).
- UI: a **"Media Library" panel in Settings** (near-copy of the existing
  Voice Library panel: category select, name/tags/license/source inputs,
  file input, table with preview + delete) and a **new "Video" tab** in
  `StoryWorkspaceClient.tsx` (copy of `AudioTab.tsx`'s shape: intro-image
  upload, four category `<select>`s pre-filled by auto-pick with a
  randomize button, numeric fields for durations/gains, Render/Approve
  buttons, `<video>` player + Download + Reveal-in-Finder for
  `video/final.mp4`).

### 5. Failure modes (fail closed on anything that changes what ships)

The governing rule, refined from the SFX spec's "skip with a log line,
never hard-fail": that's correct for a layer whose absence is purely
cosmetic (an omitted music/rain bed — plan says `null`, renders as
"no bed", nothing broken). It's wrong for anything whose absence means the
output isn't the video the operator asked for:

- **No intro image, or `sceneVideoId` null/missing file → hard fail at
  `assertCanStartJob`**, before any ffmpeg process starts. Neither has a
  sane fallback (a black card instead of the intro image, or a black
  screen instead of scene footage, is not "the video minus one layer," it's
  a different, broken video that could ship by accident).
- **A referenced id (any role, including the optional beds) exists in the
  plan but no longer exists in the catalog → hard fail**, distinct from
  `null`. Rendering a dangling `bgMusicId` as silence would silently ship a
  different mix than the plan record claims — the plan is meant to be the
  reproducibility/audit record.
- `introMusicId: null` → soft, silent intro (an `anullsrc` input) — a quiet
  intro card is a legitimate, complete choice.
- `bgMusicId`/`rainAmbienceId: null` → soft, that mix layer is omitted
  (`amix` input count adjusts).
- Deleting a catalog asset some non-archived story's plan references →
  `DELETE /api/media` returns 409 + the list of referencing story slugs;
  `force=1` overrides (the dangling reference then fails at render time per
  above, which is fine — replacing a badly-sourced file is a real need).
- `ffmpeg`/`ffprobe` missing → hard fail, same phrasing style as
  `concat_audio.py`'s existing message. No Python-only fallback (unlike WAV
  concat) — there isn't a meaningful one for video.
- Ingest-time probe failure when *adding* a catalog asset → soft, accept
  with `null` metadata (adding must not require a working toolchain;
  rendering already does and will fail there if truly needed).
- Stop button mid-render → cooperative SIGTERM → ffmpeg child killed →
  `.partial` file left (overwritten next run), `final.mp4` untouched, job
  status `cancelled`.

### 6. Relationship to the (proposed, unbuilt) workspace-isolation spec

Build for today's in-repo `data/`+`stories/` layout — `09` is *proposed*,
not scheduled, and half-adopting its environment-binding model would
contradict its own "no guessing, no partial adoption" principle. But avoid
creating a second way to migrate later: add `mediaRoot`/`mediaManifestPath`
to `src/lib/paths.ts` (nowhere else joins `'data'`+`'media'` directly),
keep every manifest `path` value project-root-relative POSIX (same shape as
`VoiceRecord.wavPath`, so whatever migration `09` eventually writes handles
media for free), and resolve Python-side through a `load_media_library`/
`resolve_media_asset` pair in `common.py` right next to the existing
`load_voice_registry`/`resolve_voice_wav` (never `Path.cwd()` directly).
Worth a one-line flag for whenever `09` is actually written up: a scene
video library and `video/final.mp4` renders are the first *content* (not
cache) in this project that will grow past hundreds of MB, which changes
`09`'s current backup-size assumptions.

### 7. `config/app.json` addition

```jsonc
"video": {
  "width": 1920, "height": 1080, "fps": 30,
  "encoder": "libx264", "crf": 20, "preset": "medium",
  "videoBitrate": "6000k", "audioBitrate": "192k",
  "sampleRate": 48000, "channels": 2,
  "referenceLufs": -16,
  "loudnorm": { "targetLufs": -16, "truePeakDb": -1.5, "loudnessRange": 11 },
  "introDurationMs": 10000,
  "introZoomEnabled": true, "introZoomEndScale": 1.12,
  "leadInMs": 800, "tailOutMs": 4000, "transitionMs": 1000,
  "grade": { "brightness": -0.05, "saturation": 0.85, "vignette": true },
  "ducking": { "enabled": true, "threshold": 0.05, "ratio": 6, "attackMs": 50, "releaseMs": 1000 },
  "defaultGainDb": { "introMusic": -3, "bgMusic": -22, "rainAmbience": -26 }
}
```

Merged over defaults in `render_video.py` exactly like `concat_audio.py`
merges `DEFAULT_MASTERING` (including re-merging nested sub-dicts like
`grade`/`ducking`/`loudnorm` individually — `concat_audio.py` already does
this for `dynamicEq`; skipping it silently drops partial-config overrides).

## Suggested build order (each step independently shippable/testable)

1. **Media catalog**: manifest + `json-store.ts` CRUD + ffprobe/loudnorm
   ingest probe + `/api/media` routes + Settings "Media Library" panel.
   Ship it, add a handful of real assets.
2. **Video plan**: `plan.json` schema + auto-random-seed-on-first-read +
   randomize endpoint + `/video-plan`/`/intro-image` routes + Video tab
   (no render button yet). Verifiable alone — picks persist, overrides
   stick.
3. **Render worker**: `config.video`, `workers/render_video.py` (transcribe
   the verified filter graphs), `JobType`/`StoryStatus`/
   `approvals.finalVideo`/`story.video` + `readStory` backfill,
   `assertCanStartJob` branch, per-type concurrency. Render button lights
   up — **render one real 25-minute story end to end and listen/watch it**
   before building anything further; this is the "does the formula actually
   sound and look right" gate, same role as the SFX plan's Phase 1.
4. **Approval + polish**: final-video approval gate, `finalVideoExists`,
   widened `/asset` route, reveal-in-Finder, dashboard bucket
   (`audio_complete` → "ready to render", `video_complete` → done).

## Critical files

- `src/types/story.ts` — new types (`MediaAsset*`, `VideoPlanFile`), extend
  `JobType`/`StoryStatus`/`StoryRecord`.
- `src/lib/json-store.ts` — media CRUD, video-plan read/write,
  `readStory()` backfill, `setApproval()` key union, `JOB_TYPES`.
- `src/lib/job-runner.ts` — `workerScripts` map, per-type concurrency,
  `assertCanStartJob`'s new branch.
- `src/lib/paths.ts` — `mediaRoot`/`mediaManifestPath`.
- `workers/concat_audio.py` — direct template for `workers/render_video.py`
  (config merge pattern, ffmpeg subprocess + log-on-failure pattern, atomic
  output, `ctx.result()` usage).
- `workers/common.py` — add `load_media_library`/`resolve_media_asset`
  next to `load_voice_registry`/`resolve_voice_wav`.
- `src/features/stories/components/workspace/AudioTab.tsx` +
  `StoryWorkspaceClient.tsx` + `useStoryWorkspace.ts` — template and wiring
  for the new Video tab.
- `src/app/api/voices/route.ts` + `src/app/api/stories/[slug]/asset/route.ts`
  — templates for `/api/media` (multipart upload) and the widened asset
  route.
- `config/app.json` — new `video` block.

## Verification

- **Media catalog**: add a test asset per category through the Settings
  panel; confirm `data/media/manifest.json` + the file under
  `data/media/<category>/` appear; delete it and confirm the file and
  manifest entry are both removed; confirm 400 on missing license/source.
- **Video plan**: open a story's Video tab with an empty catalog → fields
  show placeholders, render disabled with a clear reason. Add assets, open
  a fresh story's Video tab → four picks auto-filled, `plan.json` written;
  reload the page → same picks persist (not re-randomized); click Randomize
  → picks change and persist; manually override one `<select>` → survives a
  page reload without being clobbered by re-randomization.
- **Render pipeline** (the real gate): on a story already at
  `audio_complete`, upload an intro image, keep the auto-picked assets,
  render. Confirm: `video/final.mp4` exists and plays; duration ≈
  `introDurationMs + leadInMs + narration duration + tailOutMs`; the intro
  image displays correctly regardless of its aspect ratio (no black bars);
  the scene video loops without a visible frame hitch at the intro→main
  seam; narration is clearly audible over both beds throughout, including
  during segment gaps (no audible "pumping"); Stop mid-render actually
  stops the ffmpeg process and leaves `final.mp4` untouched from any prior
  render.
- **Failure modes**: start a render with no intro image → rejected with a
  clear message before any process spawns. Pick an asset, delete it from
  the catalog, attempt render → hard-fail naming the missing id. Set
  `bgMusicId` to `null` → renders successfully with no music bed audible.
- **Regression**: existing audio pipeline (process → TTS → verify → concat
  → approve) still works unchanged; `data/jobs.json` analytics still
  compute for the three original job types with `render_video` added
  alongside.
