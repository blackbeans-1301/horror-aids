from __future__ import annotations

import re
import sys
from typing import Any

from common import load_context, slugify


# Curated Vietnamese letters rather than the raw À-Ỵ Unicode block (~7700
# codepoints spanning Latin Extended-A/B and Latin Extended Additional),
# which incidentally matches combining marks and other languages' letters.
_VN_LOWER = (
    "aàáảãạăằắẳẵặâầấẩẫậ"
    "eèéẻẽẹêềếểễệ"
    "iìíỉĩị"
    "oòóỏõọôồốổỗộơờớởỡợ"
    "uùúủũụưừứửữự"
    "yỳýỷỹỵ"
    "dđ"
)
_VN_LETTERS = _VN_LOWER + _VN_LOWER.upper()
speaker_pattern = re.compile(
    rf"^([A-Za-z{_VN_LETTERS}][A-Za-z0-9{_VN_LETTERS} _-]{{1,40}})\s*:\s*(.+)$"
)


_VILLAIN_TOKENS = ["villain", "ác", "quỷ", "ma"]


def role_for_index(name: str, index: int) -> str:
    lowered = name.lower()
    # Whole-word match — a plain substring check misclassifies names like
    # "Mai" (contains "ma") as villains.
    if any(re.search(rf"\b{re.escape(token)}\b", lowered) for token in _VILLAIN_TOKENS):
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
        # Narration reads best in OmniVoice's storytelling mode; dialogue stays natural.
        "emotion": "storytelling" if speaker_id == "narrator" else "natural",
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

    characters_enabled = ctx.config().get("segmentation", {}).get("charactersEnabled", True)

    existing = ctx.read_json(story["text"]["charactersPath"], {"characters": []})
    existing_voices = {
        character["id"]: character.get("voice", "")
        for character in existing.get("characters", [])
    }

    characters: dict[str, dict[str, str]] = {
        "narrator": {
            "id": "narrator",
            "name": "Narrator",
            "role": "narrator",
            "voice": existing_voices.get("narrator", ""),
        }
    }
    named_speaker_order: list[str] = []
    segments: list[dict[str, Any]] = []
    buffer: list[str] = []

    # Narrator paragraphs shorter than this merge with the next one so tiny
    # sound-effect lines ("Cộc... Cộc... Cộc...") don't become standalone
    # segments that are hard to verify with Whisper.
    min_narrator_chars = 60

    def flush_narrator() -> None:
        nonlocal buffer
        parts = [part.strip() for part in buffer if part.strip()]
        buffer = []
        pending = ""
        for part in parts:
            pending = f"{pending}\n\n{part}".strip() if pending else part
            if len(pending) >= min_narrator_chars:
                segments.append(build_segment(len(segments) + 1, "narrator", pending))
                pending = ""
        if pending:
            if segments and segments[-1]["speakerId"] == "narrator":
                merged = f"{segments[-1]['text']}\n\n{pending}"
                segments[-1] = build_segment(segments[-1]["order"], "narrator", merged)
            else:
                segments.append(build_segment(len(segments) + 1, "narrator", pending))

    blocks = [block.strip() for block in re.split(r"\n+", story_text) if block.strip()]
    for block in blocks:
        match = speaker_pattern.match(block) if characters_enabled else None
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
                "voice": existing_voices.get(speaker_id, ""),
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
