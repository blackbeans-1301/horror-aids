from __future__ import annotations

import argparse
import sys
from pathlib import Path

from common import env_bool, get_omnivoice_model, make_fake_wav


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a short OmniVoice preview sample.")
    parser.add_argument("--voice-wav", required=True, help="Reference WAV path for the cloned voice.")
    parser.add_argument("--text", required=True, help="Sample text to synthesize.")
    parser.add_argument("--output", required=True, help="Output WAV file path.")
    parser.add_argument("--model", default="k2-fsa/OmniVoice", help="Model checkpoint path or HF repo id.")
    parser.add_argument("--device", default="auto", help="Device to run on (auto/cpu/cuda/mps).")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_path = Path(args.output)

    if env_bool("HORROR_AIDS_FAKE_TTS", default=True):
        make_fake_wav(output_path, args.text, sample_rate=22050)
        return 0

    import soundfile as sf

    model = get_omnivoice_model(args.model, args.device)
    audios = model.generate(text=args.text, language="vi", ref_audio=args.voice_wav)
    if not audios:
        raise RuntimeError("OmniVoice returned no audio")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_path), audios[0], model.sampling_rate)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001 - surface any failure on stderr for the caller
        print(f"preview_voice failed: {exc}", file=sys.stderr)
        raise
