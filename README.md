# Horror Aids

Local-first Vietnamese horror audio production studio.

The MVP lets one creator write a story, process it into narrator/character
segments, generate segment WAV files through OmniVoice TTS, verify each
segment with Whisper, confirm verified output in the UI, then concatenate one
final WAV with FFmpeg.

## Requirements

- Node.js 20+
- Python 3.10+
- FFmpeg for final WAV concat
- Optional: local Whisper CLI
- Optional: local OmniVoice (`omnivoice` Python package, already installed in
  `workers/.venv`) — voice cloning only, no server to run. GPU or Apple
  Silicon (MPS) recommended; the first real generation/preview downloads
  model weights from Hugging Face.

The workers include explicit local fallback modes for development verification:

- `HORROR_AIDS_FAKE_TTS=1`
- `HORROR_AIDS_FAKE_WHISPER=1`

Production use should point the app at OmniVoice:

```bash
cp .env.example .env.local
# edit OMNIVOICE_MODEL, OMNIVOICE_DEVICE, and set HORROR_AIDS_FAKE_TTS=0
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
