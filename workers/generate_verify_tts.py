from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from common import (
    atomic_write,
    env_bool,
    get_omnivoice_model,
    load_context,
    make_fake_wav,
    resolve_voice_wav,
)


def call_omnivoice(
    ctx: Any,
    output_path: Path,
    text: str,
    voice: str,
    config: dict[str, Any],
) -> None:
    fake_mode = env_bool("HORROR_AIDS_FAKE_TTS", default=True)
    sample_rate = int(config.get("audio", {}).get("sampleRate", 22050))
    if fake_mode:
        ctx.log(f"fake TTS output for {output_path.name}")
        make_fake_wav(output_path, text, sample_rate)
        return

    import soundfile as sf

    omnivoice_config = config.get("omnivoice", {})
    model_repo = os.getenv("OMNIVOICE_MODEL") or str(omnivoice_config.get("model") or "k2-fsa/OmniVoice")
    device = os.getenv("OMNIVOICE_DEVICE") or str(omnivoice_config.get("device") or "auto")
    ref_audio = resolve_voice_wav(ctx.project_root, voice)

    model = get_omnivoice_model(model_repo, device)
    audios = model.generate(text=text, language="vi", ref_audio=str(ref_audio))
    if not audios:
        raise RuntimeError("OmniVoice returned no audio")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_path), audios[0], model.sampling_rate)


def run_whisper(ctx: Any, audio_path: Path, transcript_path: Path, text: str, config: dict[str, Any]) -> str:
    whisper_config = config.get("whisper", {})
    command = os.getenv("WHISPER_COMMAND") or shutil.which("whisper")
    fake_mode = env_bool("HORROR_AIDS_FAKE_WHISPER", default=command is None)
    transcript_path.parent.mkdir(parents=True, exist_ok=True)
    if fake_mode:
        atomic_write(transcript_path, text)
        ctx.log(f"fake Whisper transcript for {audio_path.name}")
        return text

    output_dir = transcript_path.parent
    model = os.getenv("WHISPER_MODEL") or str(whisper_config.get("model") or "base")
    language = os.getenv("WHISPER_LANGUAGE") or str(whisper_config.get("language") or "vi")
    completed = subprocess.run(
        [
            command,
            str(audio_path),
            "--language",
            language,
            "--model",
            model,
            "--output_format",
            "txt",
            "--output_dir",
            str(output_dir),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "Whisper command failed")

    generated = output_dir / f"{audio_path.stem}.txt"
    if generated.exists():
        transcript = generated.read_text(encoding="utf-8").strip()
    else:
        transcript = completed.stdout.strip()
    atomic_write(transcript_path, transcript)
    return transcript


def run_whisper_batch(
    ctx: Any,
    items: list[tuple[Path, Path, str]],
    config: dict[str, Any],
) -> dict[str, str]:
    """Transcribe many WAVs in a single Whisper invocation.

    Loading the Whisper model dominates per-segment runtime (~20s vs ~1s of
    actual transcription), so one process for N files instead of N processes
    is the main pipeline speed-up. Returns {audio stem: transcript}.
    """
    whisper_config = config.get("whisper", {})
    command = os.getenv("WHISPER_COMMAND") or shutil.which("whisper")
    fake_mode = env_bool("HORROR_AIDS_FAKE_WHISPER", default=command is None)
    results: dict[str, str] = {}

    if fake_mode:
        for audio_path, transcript_path, text in items:
            atomic_write(transcript_path, text)
            results[audio_path.stem] = text
        ctx.log(f"fake Whisper transcripts for {len(items)} segments")
        return results

    output_dir = items[0][1].parent
    output_dir.mkdir(parents=True, exist_ok=True)
    model = os.getenv("WHISPER_MODEL") or str(whisper_config.get("model") or "base")
    language = os.getenv("WHISPER_LANGUAGE") or str(whisper_config.get("language") or "vi")
    completed = subprocess.run(
        [
            command,
            *[str(audio_path) for audio_path, _, _ in items],
            "--language",
            language,
            "--model",
            model,
            "--output_format",
            "txt",
            "--output_dir",
            str(output_dir),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "Whisper batch command failed")

    for audio_path, transcript_path, _ in items:
        generated = output_dir / f"{audio_path.stem}.txt"
        transcript = generated.read_text(encoding="utf-8").strip() if generated.exists() else ""
        atomic_write(transcript_path, transcript)
        results[audio_path.stem] = transcript
    return results


def passes_verification(transcript: str, source_text: str, min_ratio: float) -> tuple[bool, str | None]:
    normalized_transcript = "".join(transcript.split())
    normalized_source = "".join(source_text.split())
    if not normalized_transcript:
        return False, "Whisper transcript is empty"
    ratio = len(normalized_transcript) / max(1, len(normalized_source))
    if ratio < min_ratio:
        return False, f"Transcript ratio {ratio:.2f} below {min_ratio:.2f}"
    return True, None


def main() -> int:
    ctx = load_context()
    ctx.log("generate_verify_tts started")
    config = ctx.config()
    story = ctx.story()
    if story["approvals"]["segments"]["status"] != "approved":
        raise ValueError("segments must be approved before TTS")

    characters_file = ctx.read_json(story["text"]["charactersPath"], {"characters": []})
    segments_file = ctx.read_json(story["text"]["segmentsPath"], {"segments": []})
    characters = {character["id"]: character for character in characters_file["characters"]}
    whisper_config = config.get("whisper", {})
    max_attempts = int(os.getenv("AUDIO_VERIFY_MAX_ATTEMPTS") or whisper_config.get("maxAttempts") or 3)
    min_ratio = float(os.getenv("AUDIO_VERIFY_MIN_TEXT_RATIO") or whisper_config.get("minTextRatio") or 0.6)
    verify_enabled = env_bool("AUDIO_VERIFY_ENABLED", default=bool(whisper_config.get("enabled", True)))
    if not verify_enabled:
        ctx.log("audio verification disabled; segments will be accepted right after generation")

    target_ids = ctx.segment_filter
    if target_ids:
        known_ids = {segment["id"] for segment in segments_file["segments"]}
        missing = target_ids - known_ids
        if missing:
            raise ValueError(f"unknown segment ids: {', '.join(sorted(missing))}")
        ctx.log(f"targeted run for segments: {', '.join(sorted(target_ids))}")

    updated_segments: list[dict[str, Any]] = []
    pending: list[tuple[dict[str, Any], dict[str, Any]]] = []
    generated_count = 0

    for segment in segments_file["segments"]:
        if segment.get("status") == "skipped":
            updated_segments.append(segment)
            continue

        if target_ids and segment["id"] not in target_ids:
            updated_segments.append(segment)
            continue

        if target_ids:
            # A targeted regenerate starts fresh instead of resuming a counter
            # that may already sit at max_attempts.
            segment["verification"] = {
                "status": "pending",
                "attempts": 0,
                "lastError": None,
                "transcriptPreview": None,
            }

        speaker_id = segment["speakerId"]
        character = characters.get(speaker_id)
        if not character or not str(character.get("voice", "")).strip():
            segment["status"] = "failed"
            segment["verification"] = {
                **segment.get("verification", {}),
                "status": "failed",
                "lastError": f"Missing voice for speaker {speaker_id}",
            }
            updated_segments.append(segment)
            continue

        updated_segments.append(segment)
        pending.append((segment, character))

    def record_failure(segment: dict[str, Any], attempts: int, error: str) -> None:
        segment["verification"] = {
            "status": "failed",
            "attempts": attempts,
            "lastError": error,
            "transcriptPreview": None,
        }

    def accept_without_verification(segment: dict[str, Any], attempts: int) -> None:
        segment["verification"] = {
            "status": "passed",
            "attempts": attempts,
            "lastError": None,
            "transcriptPreview": None,
        }
        segment["status"] = "complete"
        ctx.log(f"segment {segment['id']} generated (verification disabled)")

    def record_result(segment: dict[str, Any], attempts: int, transcript: str) -> bool:
        passed, last_error = passes_verification(transcript, segment["text"], min_ratio)
        segment["verification"] = {
            "status": "passed" if passed else "failed",
            "attempts": attempts,
            "lastError": last_error,
            "transcriptPreview": transcript[:240],
        }
        if passed:
            segment["status"] = "complete"
            ctx.log(f"segment {segment['id']} verified")
        else:
            ctx.log(f"segment {segment['id']} verification failed: {last_error}")
        return passed

    # Pass 1: generate every pending segment, then verify them all with a
    # single Whisper invocation (one model load instead of one per segment).
    retry_queue: list[tuple[dict[str, Any], dict[str, Any]]] = []
    batch_items: list[tuple[Path, Path, str]] = []
    batch_segments: list[tuple[dict[str, Any], dict[str, Any]]] = []

    for segment, character in pending:
        attempts = int(segment.get("verification", {}).get("attempts") or 0)
        if attempts >= max_attempts:
            retry_queue.append((segment, character))
            continue
        try:
            segment["status"] = "generating"
            ctx.log(f"segment {segment['id']} attempt {attempts + 1}: generating voice {character['voice']}")
            call_omnivoice(
                ctx,
                ctx.resolve(segment["audioPath"]),
                segment["text"],
                character["voice"],
                config,
            )
            generated_count += 1
            if not verify_enabled:
                accept_without_verification(segment, attempts + 1)
                continue
            segment["verification"] = {**segment.get("verification", {}), "attempts": attempts + 1}
            batch_items.append(
                (
                    ctx.resolve(segment["audioPath"]),
                    ctx.resolve(segment["whisperTranscriptPath"]),
                    segment["text"],
                )
            )
            batch_segments.append((segment, character))
        except (RuntimeError, OSError, ValueError) as exc:
            record_failure(segment, attempts + 1, str(exc))
            ctx.log(f"segment {segment['id']} failed attempt {attempts + 1}: {exc}")
            retry_queue.append((segment, character))

    if batch_items:
        ctx.log(f"batch transcribing {len(batch_items)} segments with Whisper")
        try:
            transcripts = run_whisper_batch(ctx, batch_items, config)
        except (RuntimeError, OSError) as exc:
            ctx.log(f"batch Whisper failed, falling back to per-segment retries: {exc}")
            transcripts = {}
        for segment, character in batch_segments:
            attempts = int(segment["verification"]["attempts"])
            stem = ctx.resolve(segment["audioPath"]).stem
            transcript = transcripts.get(stem)
            if transcript is None:
                record_failure(segment, attempts, "Whisper batch produced no transcript")
                retry_queue.append((segment, character))
            elif not record_result(segment, attempts, transcript):
                retry_queue.append((segment, character))

    # Pass 2: per-segment retries for everything that failed the batch round.
    for segment, character in retry_queue:
        audio_path = ctx.resolve(segment["audioPath"])
        transcript_path = ctx.resolve(segment["whisperTranscriptPath"])
        passed = False
        last_error = segment.get("verification", {}).get("lastError")
        attempts = int(segment.get("verification", {}).get("attempts") or 0)

        for attempt in range(attempts + 1, max_attempts + 1):
            attempts = attempt
            try:
                segment["status"] = "generating"
                ctx.log(f"segment {segment['id']} attempt {attempt}: generating voice {character['voice']}")
                call_omnivoice(
                    ctx,
                    audio_path,
                    segment["text"],
                    character["voice"],
                    config,
                )
                generated_count += 1
                if not verify_enabled:
                    accept_without_verification(segment, attempts)
                    passed = True
                    break
                transcript = run_whisper(ctx, audio_path, transcript_path, segment["text"], config)
                if record_result(segment, attempts, transcript):
                    passed = True
                    break
                last_error = segment["verification"]["lastError"]
            except (RuntimeError, OSError, ValueError) as exc:
                last_error = str(exc)
                record_failure(segment, attempts, last_error)
                ctx.log(f"segment {segment['id']} failed attempt {attempt}: {last_error}")
            time.sleep(0.05)

        if not passed:
            segment["status"] = "verification_failed"
            segment["verification"] = {
                **segment.get("verification", {}),
                "status": "max_attempts_reached",
                "attempts": attempts,
                "lastError": last_error or "Max attempts reached",
            }

    # Story status reflects ALL segments, not only the ones processed in this
    # run — a targeted regenerate must not mark the story verified while other
    # segments are still pending or failed.
    unresolved = sum(
        1
        for segment in updated_segments
        if segment.get("status") != "skipped"
        and segment.get("verification", {}).get("status") != "passed"
    )
    # Job success is judged only on the segments this run actually processed.
    run_unresolved = sum(
        1
        for segment in updated_segments
        if segment.get("status") != "skipped"
        and (not target_ids or segment["id"] in target_ids)
        and segment.get("verification", {}).get("status") != "passed"
    )

    segments_file["segments"] = updated_segments
    ctx.write_json(story["text"]["segmentsPath"], segments_file)
    if unresolved == 0:
        story["status"] = "tts_verified"
        story["audio"]["status"] = "verified"
    elif run_unresolved > 0:
        story["status"] = "audio_validation"
        story["audio"]["status"] = "failed"
    ctx.write_story(story)
    result_status = "complete" if run_unresolved == 0 else "needs_review"
    ctx.result(result_status, generated=generated_count, unresolved=unresolved, runUnresolved=run_unresolved)
    ctx.log(
        f"generate_verify_tts finished: generated={generated_count}, "
        f"run_unresolved={run_unresolved}, story_unresolved={unresolved}"
    )
    return 0 if run_unresolved == 0 else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        context = load_context()
        context.log(f"generate_verify_tts failed: {exc}")
        context.result("failed", error=str(exc))
        raise
