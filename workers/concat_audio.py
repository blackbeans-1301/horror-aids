from __future__ import annotations

import shutil
import subprocess
import wave
from pathlib import Path

from common import atomic_write, load_context


DEFAULT_SEGMENT_GAP_MS = 500

DEFAULT_MASTERING = {
    "audioBitrate": "96k",
    "ditherMethod": "triangular",
    "pitchShiftPercent": 1.0,
    "highPassHz": 80,
    "lowPassHz": 15000,
    "dynamicEq": {
        "centerHz": 3000,
        "bandwidthHz": 2000,
        "thresholdDb": -18,
        "ratio": 2.0,
        "attackMs": 10,
        "releaseMs": 100,
        "makeupDb": 0,
    },
}


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


def master_audio(
    ctx,
    ffmpeg: str,
    input_wav: Path,
    output_path: Path,
    mastering: dict,
) -> None:
    """Post-process the concatenated narration into a mastered M4A (AAC).

    Pitch is raised without changing tempo via the classic asetrate(rate *
    factor) -> aresample(target) -> atempo(1/factor) chain. The 2-4kHz
    presence band is tamed with a real (level-dependent) dynamic EQ: the
    signal is split into that band and everything else, the band alone is
    compressed, then both halves are summed back together — a static
    `equalizer` cut would apply regardless of level, which isn't what "soft
    dynamic EQ" asked for.

    The aresample step targets the source's own rate (no upsampling to
    44.1kHz — the TTS output rate is already fine for narration) and applies
    triangular dither so the rate/bit-depth conversion doesn't leave flat,
    noise-free quantization patches in the spectrum.
    """
    with wave.open(str(input_wav), "rb") as source:
        source_rate = source.getframerate()
        source_channels = source.getnchannels()

    target_rate = source_rate
    dither_method = mastering["ditherMethod"]
    pitch_factor = 1.0 + float(mastering["pitchShiftPercent"]) / 100.0
    asetrate_hz = int(round(source_rate * pitch_factor))
    tempo_factor = 1.0 / pitch_factor

    eq = mastering["dynamicEq"]
    center_hz = float(eq["centerHz"])
    bandwidth_hz = float(eq["bandwidthHz"])

    filter_complex = (
        f"[0:a]asplit=2[dyneq_full][dyneq_band];"
        f"[dyneq_band]bandpass=f={center_hz}:width_type=h:width={bandwidth_hz}[dyneq_bandonly];"
        f"[dyneq_full]bandreject=f={center_hz}:width_type=h:width={bandwidth_hz}[dyneq_rest];"
        f"[dyneq_bandonly]acompressor="
        f"threshold={eq['thresholdDb']}dB:ratio={eq['ratio']}:"
        f"attack={eq['attackMs']}:release={eq['releaseMs']}:makeup={eq['makeupDb']}dB[dyneq_bandcomp];"
        f"[dyneq_rest][dyneq_bandcomp]amix=inputs=2:normalize=0[dyneq_out];"
        f"[dyneq_out]highpass=f={mastering['highPassHz']},lowpass=f={mastering['lowPassHz']}[filtered];"
        f"[filtered]asetrate={asetrate_hz},aresample={target_rate}:dither_method={dither_method}[pitched];"
        f"[pitched]atempo={tempo_factor}[outa]"
    )

    command = [
        ffmpeg,
        "-y",
        "-i",
        str(input_wav),
        "-filter_complex",
        filter_complex,
        "-map",
        "[outa]",
        "-c:a",
        "aac",
        "-b:a",
        str(mastering["audioBitrate"]),
    ]
    if source_channels > 1:
        command += ["-ac", "1"]
    command += [
        "-map_metadata",
        "-1",
        "-movflags",
        "+faststart",
        str(output_path),
    ]
    ctx.log("running ffmpeg mastering: " + " ".join(command))
    completed = subprocess.run(command, check=False, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "ffmpeg mastering failed")


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
    raw_concat_path = ctx.resolve("tmp/concat-raw.wav")
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
            str(raw_concat_path),
        ]
        ctx.log("running ffmpeg: " + " ".join(command))
        completed = subprocess.run(command, check=False, capture_output=True, text=True)
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or "ffmpeg concat failed")
    else:
        ctx.log("ffmpeg not found; using Python WAV concat fallback")
        python_concat(raw_concat_path, input_paths, gap_ms)

    if not raw_concat_path.exists() or raw_concat_path.stat().st_size == 0:
        raise RuntimeError("concatenated wav was not created")

    if not ffmpeg:
        raise RuntimeError("ffmpeg is required to master the final M4A (pitch shift, EQ, AAC encode)")

    mastering = {**DEFAULT_MASTERING, **ctx.config().get("mastering", {})}
    mastering["dynamicEq"] = {**DEFAULT_MASTERING["dynamicEq"], **mastering.get("dynamicEq", {})}

    final_relative = "audio/final.m4a"
    output_path = ctx.resolve(final_relative)
    master_audio(ctx, ffmpeg, raw_concat_path, output_path, mastering)

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError("final m4a was not created")

    # Leave story["status"] as "ready_to_concat" — there's no status value for
    # "concat done, awaiting final approval", and setting it back to
    # "audio_validation" (which elsewhere means "segments still unresolved")
    # would move the visible badge backward past a stage already completed.
    story["audio"]["finalPath"] = final_relative
    story["audio"]["status"] = "complete"
    story["approvals"]["finalAudio"] = {"status": "pending", "approvedAt": None}
    ctx.write_story(story)
    ctx.result("complete", finalPath=final_relative, segments=len(input_paths))
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
