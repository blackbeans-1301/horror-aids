from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path
from typing import Any

from common import atomic_write, env_bool, load_context


def make_fake_wav(path: Path, text: str, sample_rate: int) -> None:
    duration = max(0.35, min(8.0, len(text) / 42.0))
    frames = int(sample_rate * duration)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        for index in range(frames):
            envelope = min(1.0, index / max(1, sample_rate // 10))
            tone = math.sin(2 * math.pi * 220 * (index / sample_rate))
            value = int(12000 * envelope * tone)
            audio.writeframesraw(value.to_bytes(2, byteorder="little", signed=True))


def call_vienue(ctx: Any, output_path: Path, text: str, voice: str, config: dict[str, Any]) -> None:
    vienue = config.get("vienue", {})
    base_url = os.getenv("VIENUE_TTS_BASE_URL") or str(vienue.get("baseUrl") or "")
    fake_mode = env_bool("HORROR_AIDS_FAKE_TTS", default=not bool(base_url))
    sample_rate = int(config.get("audio", {}).get("sampleRate", 22050))
    if fake_mode:
        ctx.log(f"fake TTS output for {output_path.name}")
        make_fake_wav(output_path, text, sample_rate)
        return

    endpoint = os.getenv("VIENUE_TTS_ENDPOINT") or str(vienue.get("endpoint") or "/v1/audio/speech")
    model = os.getenv("VIENUE_TTS_MODEL") or str(vienue.get("model") or "default")
    api_key = os.getenv("VIENUE_TTS_API_KEY") or ""
    url = f"{base_url.rstrip('/')}/{endpoint.lstrip('/')}"
    body = json.dumps(
        {
            "model": model,
            "voice": voice,
            "input": text,
            "response_format": "wav",
        }
    ).encode("utf-8")
    headers = {"content-type": "application/json"}
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()
    if not data:
        raise RuntimeError("VieNue returned empty audio")
    atomic_write(output_path, data)


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

    updated_segments: list[dict[str, Any]] = []
    unresolved = 0
    generated_count = 0

    for segment in segments_file["segments"]:
        if segment.get("status") == "skipped":
            updated_segments.append(segment)
            continue

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
            unresolved += 1
            continue

        audio_path = ctx.resolve(segment["audioPath"])
        transcript_path = ctx.resolve(segment["whisperTranscriptPath"])
        verification = segment.get("verification", {})
        passed = False
        last_error: str | None = None
        attempts = int(verification.get("attempts") or 0)

        for attempt in range(attempts + 1, max_attempts + 1):
            attempts = attempt
            try:
                segment["status"] = "generating"
                ctx.log(f"segment {segment['id']} attempt {attempt}: generating voice {character['voice']}")
                call_vienue(ctx, audio_path, segment["text"], character["voice"], config)
                generated_count += 1
                transcript = run_whisper(ctx, audio_path, transcript_path, segment["text"], config)
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
                    break
                ctx.log(f"segment {segment['id']} verification failed: {last_error}")
            except (urllib.error.URLError, RuntimeError, OSError) as exc:
                last_error = str(exc)
                segment["verification"] = {
                    "status": "failed",
                    "attempts": attempts,
                    "lastError": last_error,
                    "transcriptPreview": None,
                }
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
            unresolved += 1

        updated_segments.append(segment)

    segments_file["segments"] = updated_segments
    ctx.write_json(story["text"]["segmentsPath"], segments_file)
    if unresolved == 0:
        story["status"] = "tts_verified"
        story["audio"]["status"] = "verified"
    else:
        story["status"] = "audio_validation"
        story["audio"]["status"] = "failed"
    ctx.write_story(story)
    result_status = "complete" if unresolved == 0 else "needs_review"
    ctx.result(result_status, generated=generated_count, unresolved=unresolved)
    ctx.log(f"generate_verify_tts finished: generated={generated_count}, unresolved={unresolved}")
    return 0 if unresolved == 0 else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        context = load_context()
        context.log(f"generate_verify_tts failed: {exc}")
        context.result("failed", error=str(exc))
        raise
