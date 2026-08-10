from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import signal
import subprocess
import tempfile
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# Exit code a worker returns when it stopped early because of a user-requested
# cancellation (rather than finishing or crashing). Must match CANCELLED_EXIT_CODE
# in src/lib/json-store.ts, which maps this back to job status "cancelled".
STOPPED_EXIT_CODE = 75

# Exit code for a run that finished without crashing but left some segments
# unresolved (partial success). Distinct from the implicit exit code 1 an
# uncaught exception produces, so the two don't collapse into the same
# ambiguous "failed" job status. Must match NEEDS_REVIEW_EXIT_CODE in
# src/lib/json-store.ts.
NEEDS_REVIEW_EXIT_CODE = 2

_stop_requested = False


def _mark_stop_requested(signum: int, frame: Any) -> None:
    global _stop_requested
    _stop_requested = True


def install_stop_handler() -> None:
    """Opt in to cooperative shutdown on SIGTERM.

    By default SIGTERM kills the process immediately, which would drop
    whatever progress this run hasn't flushed to disk yet. Workers that call
    this instead get a flag they can poll (stop_requested()) between units of
    work, so they can finish the current segment, persist results, and exit
    cleanly.
    """
    signal.signal(signal.SIGTERM, _mark_stop_requested)


def stop_requested() -> bool:
    return _stop_requested


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return cleaned or "item"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--story", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--config", default="config/app.json")
    parser.add_argument("--segments", default="", help="comma-separated segment ids to limit the run to")
    return parser.parse_args()


class WorkerContext:
    def __init__(self, story: str, job_id: str, config: str, segments: str = "") -> None:
        self.project_root = Path.cwd()
        self.story_dir = (self.project_root / story).resolve()
        self.story_id = self.story_dir.name
        self.job_id = job_id
        self.config_path = (self.project_root / config).resolve()
        # None = process every segment; a set limits the run to those segment ids.
        self.segment_filter = {part.strip() for part in segments.split(",") if part.strip()} or None
        self.log_path = self.story_dir / "logs" / f"{job_id}.log"
        self.result_path = self.story_dir / "tmp" / f"{job_id}.result.json"
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.result_path.parent.mkdir(parents=True, exist_ok=True)
        (self.story_dir / "tmp" / "whisper").mkdir(parents=True, exist_ok=True)

    def resolve(self, relative_path: str) -> Path:
        resolved = (self.story_dir / relative_path).resolve()
        if self.story_dir not in resolved.parents and resolved != self.story_dir:
            raise ValueError(f"path escapes story folder: {relative_path}")
        return resolved

    def log(self, message: str) -> None:
        line = f"[{utc_now()}] {message}\n"
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(line)

    def read_json(self, relative_path: str, fallback: Any | None = None) -> Any:
        path = self.resolve(relative_path)
        if not path.exists():
            if fallback is not None:
                return fallback
            raise FileNotFoundError(path)
        return json.loads(path.read_text(encoding="utf-8"))

    def write_json(self, relative_path: str, data: Any) -> None:
        path = self.resolve(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    def read_text(self, relative_path: str) -> str:
        return self.resolve(relative_path).read_text(encoding="utf-8")

    def write_text(self, relative_path: str, data: str) -> None:
        path = self.resolve(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, data)

    def config(self) -> dict[str, Any]:
        if self.config_path.exists():
            return json.loads(self.config_path.read_text(encoding="utf-8"))
        return {}

    def story(self) -> dict[str, Any]:
        return self.read_json("story.json")

    def write_story(self, story: dict[str, Any]) -> None:
        story["updatedAt"] = utc_now()
        self.write_json("story.json", story)
        self.update_index(story)

    def update_story(self, **patch: Any) -> dict[str, Any]:
        story = self.story()
        story.update(patch)
        self.write_story(story)
        return story

    def update_index(self, story: dict[str, Any]) -> None:
        index_path = self.project_root / "data" / "index.json"
        if not index_path.exists():
            return
        index = json.loads(index_path.read_text(encoding="utf-8"))
        stories = index.get("stories", [])
        for entry in stories:
            if entry.get("id") == story.get("id"):
                entry["title"] = story.get("title")
                entry["status"] = story.get("status")
                entry["updatedAt"] = story.get("updatedAt")
                break
        atomic_write(index_path, json.dumps(index, ensure_ascii=False, indent=2) + "\n")

    def result(self, status: str, **data: Any) -> None:
        payload = {"status": status, "jobId": self.job_id, "finishedAt": utc_now(), **data}
        atomic_write(self.result_path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def atomic_write(path: Path, content: str | bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = "wb" if isinstance(content, bytes) else "w"
    encoding = None if isinstance(content, bytes) else "utf-8"
    with tempfile.NamedTemporaryFile(mode=mode, encoding=encoding, delete=False, dir=path.parent) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)
    tmp_path.replace(path)


def load_context() -> WorkerContext:
    args = parse_args()
    return WorkerContext(args.story, args.job_id, args.config, args.segments)


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


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


def load_voice_registry(project_root: Path) -> dict[str, dict[str, Any]]:
    """Read data/voices.json (managed by the Next.js app) into {id: entry}."""
    registry_path = project_root / "data" / "voices.json"
    if not registry_path.exists():
        return {}
    data = json.loads(registry_path.read_text(encoding="utf-8"))
    return {entry["id"]: entry for entry in data.get("voices", [])}


def resolve_voice_wav(project_root: Path, voice_id: str) -> Path:
    registry = load_voice_registry(project_root)
    entry = registry.get(voice_id)
    if not entry:
        raise ValueError(f"unknown voice id: {voice_id}")
    wav_path = (project_root / entry["wavPath"]).resolve()
    if not wav_path.exists():
        raise ValueError(f"voice reference WAV missing for {voice_id}: {wav_path}")
    return wav_path


def load_media_library(project_root: Path) -> dict[str, dict[str, Any]]:
    """Read data/media/manifest.json (managed by the Next.js app) into {id: entry}."""
    manifest_path = project_root / "data" / "media" / "manifest.json"
    if not manifest_path.exists():
        return {}
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    return {entry["id"]: entry for entry in data.get("media", [])}


def resolve_media_asset(project_root: Path, asset_id: str, expected_category: str) -> dict[str, Any]:
    """Resolve a media catalog id to its manifest entry, verifying category and
    file presence. Raises with a message naming the id — this is the single
    place render_video.py finds out a plan references something broken.
    """
    registry = load_media_library(project_root)
    entry = registry.get(asset_id)
    if not entry:
        raise ValueError(f"unknown media id: {asset_id}")
    if entry.get("category") != expected_category:
        raise ValueError(f"media {asset_id} is a {entry.get('category')}, not a {expected_category}")
    asset_path = (project_root / entry["path"]).resolve()
    if not asset_path.exists():
        raise ValueError(f"media file missing for {asset_id}: {asset_path}")
    return entry


# Sentinel "model" id that routes call_omnivoice() to the native omnivoice.cpp
# CLI instead of the Python omnivoice package — see workers/omnivoice.cpp
# (built locally, not part of this repo) and data/models/omnivoice-gguf/.
GGUF_MODEL_ID = "Serveurperso/OmniVoice-GGUF-BF16"

_DEFAULT_GGUF_BINARY = "workers/omnivoice.cpp/build/omnivoice-tts"
_DEFAULT_GGUF_MODEL_PATH = "data/models/omnivoice-gguf/omnivoice-base-BF16.gguf"
_DEFAULT_GGUF_CODEC_PATH = "data/models/omnivoice-gguf/omnivoice-tokenizer-BF16.gguf"


def _resolve_under(project_root: Path, configured: str | None, default: str) -> Path:
    raw = configured or default
    path = Path(raw)
    return path if path.is_absolute() else (project_root / path).resolve()


def _ensure_ref_transcript(ref_wav: Path) -> Path:
    """omnivoice.cpp needs a transcript of the reference WAV for voice
    cloning (--ref-text); the Python omnivoice model clones from audio alone,
    so voices in data/voices.json were never asked for one. Transcribe once
    with the Whisper CLI and cache the result next to the reference WAV.
    """
    transcript_path = ref_wav.with_suffix(".ref.txt")
    if transcript_path.exists():
        return transcript_path

    whisper_command = os.getenv("WHISPER_COMMAND") or shutil.which("whisper")
    if not whisper_command:
        raise RuntimeError(
            f"no cached transcript for {ref_wav.name} and no `whisper` CLI found to "
            f"generate one; install openai-whisper or add {transcript_path.name} by hand"
        )
    completed = subprocess.run(
        [
            whisper_command,
            str(ref_wav),
            "--language",
            "vi",
            "--model",
            "base",
            "--output_format",
            "txt",
            "--output_dir",
            str(ref_wav.parent),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "whisper transcription of reference wav failed")

    generated = ref_wav.parent / f"{ref_wav.stem}.txt"
    if not generated.exists():
        raise RuntimeError(f"whisper did not produce a transcript for {ref_wav.name}")
    generated.replace(transcript_path)
    return transcript_path


def run_omnivoice_cpp(
    project_root: Path,
    gguf_config: dict[str, Any],
    text: str,
    ref_wav: Path,
    output_path: Path,
    language: str = "Vietnamese",
) -> None:
    """Synthesize via the native omnivoice.cpp CLI (omnivoice-tts), running
    on whatever GGML backend it was built with — Metal by default on macOS.
    """
    binary = _resolve_under(project_root, gguf_config.get("binary"), _DEFAULT_GGUF_BINARY)
    model_path = _resolve_under(project_root, gguf_config.get("modelPath"), _DEFAULT_GGUF_MODEL_PATH)
    codec_path = _resolve_under(project_root, gguf_config.get("codecPath"), _DEFAULT_GGUF_CODEC_PATH)
    for label, path in (("omnivoice-tts binary", binary), ("base model", model_path), ("codec model", codec_path)):
        if not path.exists():
            raise RuntimeError(f"{label} not found at {path} — build/download it first (see workers/omnivoice.cpp)")

    ref_text_path = _ensure_ref_transcript(ref_wav)

    # MaskGIT decode steps: the CLI default (32) costs ~140ms/step on Metal
    # and scales ~linearly, so this is the single biggest speed/quality knob
    # for this engine — halving it roughly halves generation time. Duration
    # is unaffected either way, only fidelity of the decode.
    steps = gguf_config.get("steps")

    command = [
        str(binary),
        "--model",
        str(model_path),
        "--codec",
        str(codec_path),
        "--ref-wav",
        str(ref_wav),
        "--ref-text",
        str(ref_text_path),
        "--lang",
        language,
        "-o",
        str(output_path),
    ]
    if steps:
        command += ["--steps", str(int(steps))]

    output_path.parent.mkdir(parents=True, exist_ok=True)
    completed = subprocess.run(
        command,
        input=text,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip()[-2000:] or "omnivoice-tts failed")


_MODEL_CACHE: dict[tuple[str, str], Any] = {}


def get_omnivoice_model(model_repo: str, device: str | None = None) -> Any:
    """Lazily load (and cache) an OmniVoice model for the given repo/device.

    Loading is expensive (model weights + first-run download from Hugging
    Face), so callers that generate many segments in one process should
    request the model once and reuse it.
    """
    import torch
    from omnivoice.models.omnivoice import OmniVoice
    from omnivoice.utils.common import get_best_device

    resolved_device = device if device and device != "auto" else get_best_device()
    cache_key = (model_repo, resolved_device)
    if cache_key not in _MODEL_CACHE:
        _MODEL_CACHE[cache_key] = OmniVoice.from_pretrained(
            model_repo, device_map=resolved_device, dtype=torch.float16
        )
    return _MODEL_CACHE[cache_key]
