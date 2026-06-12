# Horror Aids

Local-first Vietnamese horror audio production studio.

The MVP lets one creator write a story, process it into narrator/character
segments, generate segment WAV files through VieNue TTS, verify each segment
with Whisper, confirm verified output in the UI, then concatenate one final WAV
with FFmpeg.

## Requirements

- Node.js 20+
- Python 3.10+
- FFmpeg for final WAV concat
- Optional: local Whisper CLI
- Optional: local VieNue TTS OpenAI-compatible host

The workers include explicit local fallback modes for development verification:

- `HORROR_AIDS_FAKE_TTS=1`
- `HORROR_AIDS_FAKE_WHISPER=1`

Production use should point the app at VieNue:

```bash
cp .env.example .env.local
# edit VIENUE_TTS_BASE_URL, VIENUE_TTS_MODEL, and voice IDs in the UI
```

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Workflow

1. Create a story workspace.
2. Write story text.
3. Process story into characters and segments.
4. Assign VieNue voice IDs.
5. Accept segments for TTS.
6. Generate and verify audio.
7. Confirm verified output.
8. Concatenate final WAV.
9. Approve final audio.

Generated story data lives under `stories/[story-slug]/` and is ignored by git.
