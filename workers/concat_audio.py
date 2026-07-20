from __future__ import annotations

import shutil
import subprocess
import wave
from pathlib import Path

from common import atomic_write, load_context


DEFAULT_SEGMENT_GAP_MS = 500


def silence_frames(params: wave._wave_params, gap_ms: int) -> bytes:
    frame_count = int(params.framerate * gap_ms / 1000)
    # 8-bit PCM is unsigned, so silence sits at the 0x80 midpoint.
    fill = b"\x80" if params.sampwidth == 1 else b"\x00"
    return fill * (frame_count * params.nchannels * params.sampwidth)


def write_silence_wav(path: Path, params: wave._wave_params, gap_ms: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(params.nchannels)
        output.setsampwidth(params.sampwidth)
        output.setframerate(params.framerate)
        output.writeframes(silence_frames(params, gap_ms))


def python_concat(output_path: Path, input_paths: list[Path], gap_ms: int) -> None:
    with wave.open(str(input_paths[0]), "rb") as first:
        params = first.getparams()
        frames = [first.readframes(first.getnframes())]
    gap = silence_frames(params, gap_ms)
    for path in input_paths[1:]:
        with wave.open(str(path), "rb") as audio:
            if audio.getparams()[:3] != params[:3]:
                raise RuntimeError("WAV params differ and ffmpeg is unavailable")
            frames.append(gap)
            frames.append(audio.readframes(audio.getnframes()))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output_path), "wb") as output:
        output.setparams(params)
        for frame_data in frames:
            output.writeframes(frame_data)


def main() -> int:
    ctx = load_context()
    ctx.log("concat_audio started")
    story = ctx.story()
    if story["approvals"]["verifiedAudio"]["status"] != "approved":
        raise ValueError("verified output must be confirmed before concat")

    gap_ms = int(ctx.config().get("audio", {}).get("segmentGapMs", DEFAULT_SEGMENT_GAP_MS))

    segments_file = ctx.read_json(story["text"]["segmentsPath"], {"segments": []})
    ordered_segments = sorted(segments_file["segments"], key=lambda item: item["order"])
    input_paths: list[Path] = []
    for segment in ordered_segments:
        if segment.get("status") == "skipped":
            continue
        if segment.get("verification", {}).get("status") != "passed":
            raise ValueError(f"segment {segment['id']} is not verified")
        audio_path = ctx.resolve(segment["audioPath"])
        if not audio_path.exists():
            raise FileNotFoundError(audio_path)
        input_paths.append(audio_path)

    if not input_paths:
        raise ValueError("no segment audio files to concatenate")

    silence_path = ctx.resolve("tmp/segment-gap.wav")
    if gap_ms > 0:
        with wave.open(str(input_paths[0]), "rb") as first:
            write_silence_wav(silence_path, first.getparams(), gap_ms)

    concat_lines: list[str] = []
    for index, audio_path in enumerate(input_paths):
        if index > 0 and gap_ms > 0:
            concat_lines.append(f"file '{silence_path.as_posix()}'")
        concat_lines.append(f"file '{audio_path.as_posix()}'")

    concat_list_path = ctx.resolve("tmp/concat-list.txt")
    atomic_write(concat_list_path, "\n".join(concat_lines) + "\n")
    output_path = ctx.resolve(story["audio"]["finalPath"])
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        command = [
            ffmpeg,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list_path),
            "-acodec",
            "pcm_s16le",
            str(output_path),
        ]
        ctx.log("running ffmpeg: " + " ".join(command))
        completed = subprocess.run(command, check=False, capture_output=True, text=True)
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or "ffmpeg concat failed")
    else:
        ctx.log("ffmpeg not found; using Python WAV concat fallback")
        python_concat(output_path, input_paths, gap_ms)

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError("final wav was not created")

    story["status"] = "audio_validation"
    story["audio"]["status"] = "complete"
    story["approvals"]["finalAudio"] = {"status": "pending", "approvedAt": None}
    ctx.write_story(story)
    ctx.result("complete", finalPath=story["audio"]["finalPath"], segments=len(input_paths))
    ctx.log(f"concat_audio complete: {output_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        context = load_context()
        context.log(f"concat_audio failed: {exc}")
        context.result("failed", error=str(exc))
        raise
