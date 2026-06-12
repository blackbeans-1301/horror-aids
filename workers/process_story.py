from __future__ import annotations

import re
import sys
from typing import Any

from common import load_context, slugify


speaker_pattern = re.compile(r"^([A-ZÀ-Ỵa-zà-ỵ][A-ZÀ-Ỵa-zà-ỵ0-9 _-]{1,40})\s*:\s*(.+)$")


def role_for_index(name: str, index: int) -> str:
    lowered = name.lower()
    if any(token in lowered for token in ["villain", "ác", "quỷ", "ma"]):
        return "villain"
    if index == 0:
        return "main_character"
    return "side_character"


def build_segment(segment_id: int, speaker_id: str, text: str) -> dict[str, Any]:
    padded = f"{segment_id:04d}"
    return {
        "id": padded,
        "order": segment_id,
        "speakerId": speaker_id,
        "text": text.strip(),
        "audioPath": f"audio/segments/{padded}-{speaker_id}.wav",
        "whisperTranscriptPath": f"tmp/whisper/{padded}-{speaker_id}.txt",
        "status": "pending",
        "verification": {
            "status": "pending",
            "attempts": 0,
            "lastError": None,
            "transcriptPreview": None,
        },
    }


def main() -> int:
    ctx = load_context()
    ctx.log("process_story started")
    story = ctx.story()
    story_text = ctx.read_text(story["text"]["storyPath"]).strip()
    if not story_text:
        raise ValueError("story text is empty")

    characters: dict[str, dict[str, str]] = {
        "narrator": {
            "id": "narrator",
            "name": "Narrator",
            "role": "narrator",
            "voice": "",
        }
    }
    named_speaker_order: list[str] = []
    segments: list[dict[str, Any]] = []
    buffer: list[str] = []

    def flush_narrator() -> None:
        nonlocal buffer
        text = "\n\n".join(part.strip() for part in buffer if part.strip()).strip()
        if text:
            segments.append(build_segment(len(segments) + 1, "narrator", text))
        buffer = []

    blocks = [block.strip() for block in re.split(r"\n\s*\n", story_text) if block.strip()]
    for block in blocks:
        match = speaker_pattern.match(block)
        if not match:
            buffer.append(block)
            continue

        flush_narrator()
        speaker_name = match.group(1).strip()
        speaker_text = match.group(2).strip()
        speaker_id = slugify(speaker_name)
        if speaker_id not in characters:
            named_speaker_order.append(speaker_id)
            characters[speaker_id] = {
                "id": speaker_id,
                "name": speaker_name,
                "role": role_for_index(speaker_name, len(named_speaker_order) - 1),
                "voice": "",
            }
        segments.append(build_segment(len(segments) + 1, speaker_id, speaker_text))

    flush_narrator()

    if not segments:
        segments.append(build_segment(1, "narrator", story_text))

    ctx.write_json(story["text"]["charactersPath"], {"characters": list(characters.values())})
    ctx.write_json(story["text"]["segmentsPath"], {"segments": segments})
    story["status"] = "segments_review"
    story["approvals"]["segments"] = {"status": "pending", "approvedAt": None}
    story["approvals"]["verifiedAudio"] = {"status": "pending", "approvedAt": None}
    story["approvals"]["finalAudio"] = {"status": "pending", "approvedAt": None}
    story["audio"]["status"] = "pending"
    ctx.write_story(story)
    ctx.result("complete", segments=len(segments), characters=len(characters))
    ctx.log(f"process_story complete: {len(segments)} segments, {len(characters)} characters")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        context = load_context()
        context.log(f"process_story failed: {exc}")
        context.result("failed", error=str(exc))
        raise
