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


# Fields that represent generation/review progress rather than script
# structure — these are what a segment "keeps" when reconciled against the
# previous run instead of being reset to build_segment()'s fresh defaults.
# audioPath/whisperTranscriptPath are included deliberately: a carried-over
# segment's real files stay wherever they were already generated, even if
# its id/order (recomputed fresh below) shifted — nothing recomputes those
# paths from id to double-check they still match, so this is safe. See
# workers/generate_verify_tts.py and concat_audio.py, which only ever read
# segment["audioPath"]/segment["whisperTranscriptPath"] directly.
_PROGRESS_FIELDS = (
    "status",
    "verification",
    "audioPath",
    "whisperTranscriptPath",
    "audioTake",
    "audioCreatedAt",
    "previousTake",
    "flagged",
)

# dp table cells (len(previous) * len(fresh)) above which the LCS alignment
# below is skipped in favor of the coarser same-length-only match — this
# pipeline was never sized for multi-thousand-segment stories, and an
# unbounded O(n*m) table would burn unreasonable time/memory if one ever
# showed up.
_MAX_ALIGNMENT_CELLS = 4_000_000


def _segment_key(segment: dict[str, Any]) -> tuple[Any, Any, Any]:
    return (segment.get("text"), segment.get("speakerId"), segment.get("emotion"))


def _lcs_align(previous_keys: list[Any], fresh_keys: list[Any]) -> list[tuple[int, int]]:
    """Longest-common-subsequence alignment between two key sequences — the
    same algorithm behind `diff`/`git diff`. Returns (previous_index,
    fresh_index) pairs, in order, for positions that carry an identical key.

    This is what lets a segment "move" (something was inserted or removed
    elsewhere in the story) and still be recognized as unchanged, while
    guaranteeing two segments never get cross-matched out of order — the
    alignment is monotonic in both indices by construction, so segment 12's
    old audio can never land on an unrelated segment 40 just because they
    happen to share text.
    """
    n, m = len(previous_keys), len(fresh_keys)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        row = dp[i]
        next_row = dp[i + 1]
        key_i = previous_keys[i]
        for j in range(m - 1, -1, -1):
            if key_i == fresh_keys[j]:
                row[j] = next_row[j + 1] + 1
            else:
                row[j] = next_row[j] if next_row[j] >= row[j + 1] else row[j + 1]

    pairs = []
    i = j = 0
    while i < n and j < m:
        if previous_keys[i] == fresh_keys[j]:
            pairs.append((i, j))
            i += 1
            j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return pairs


def _merge_progress(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    merged = dict(new)
    for field in _PROGRESS_FIELDS:
        if field in old:
            merged[field] = old[field]
    return merged


def _reconcile_by_position(
    previous: list[dict[str, Any]], fresh: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    if len(previous) != len(fresh):
        return fresh
    return [
        _merge_progress(old, new) if _segment_key(old) == _segment_key(new) else new
        for old, new in zip(previous, fresh)
    ]


def reconcile_segments(
    previous: list[dict[str, Any]], fresh: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Carry audio/review progress forward from the previous segments.json
    onto the freshly-segmented text, matching by content instead of by
    position — so inserting or deleting a paragraph elsewhere in the story
    no longer resets every segment after the change point.

    A segment only keeps its old audio if its (text, speakerId, emotion)
    is byte-for-byte identical to some segment from the previous run, and
    the pairing comes from an LCS alignment (see _lcs_align) so matches
    can't cross out of order. Anything left unmatched — new lines, or
    lines whose text/speaker/emotion changed — gets build_segment()'s
    fresh pending state, same as before.
    """
    if not previous:
        return fresh

    if len(previous) * len(fresh) > _MAX_ALIGNMENT_CELLS:
        return _reconcile_by_position(previous, fresh)

    previous_keys = [_segment_key(segment) for segment in previous]
    fresh_keys = [_segment_key(segment) for segment in fresh]
    carry_from = {
        fresh_index: prev_index
        for prev_index, fresh_index in _lcs_align(previous_keys, fresh_keys)
    }

    return [
        _merge_progress(previous[carry_from[index]], new) if index in carry_from else new
        for index, new in enumerate(fresh)
    ]


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

    previous_segments = ctx.read_json(story["text"]["segmentsPath"], {"segments": []}).get(
        "segments", []
    )
    segments = reconcile_segments(previous_segments, segments)

    ctx.write_json(story["text"]["charactersPath"], {"characters": list(characters.values())})
    ctx.write_json(story["text"]["segmentsPath"], {"segments": segments})
    story["status"] = "segments_review"
    story["approvals"]["segments"] = {"status": "pending", "approvedAt": None}
    story["approvals"]["verifiedAudio"] = {"status": "pending", "approvedAt": None}
    story["approvals"]["finalAudio"] = {"status": "pending", "approvedAt": None}
    story["audio"]["status"] = "pending"
    ctx.write_story(story)
    kept_audio = sum(1 for segment in segments if segment.get("status") != "pending")
    ctx.result(
        "complete",
        segments=len(segments),
        characters=len(characters),
        audioKept=kept_audio,
    )
    ctx.log(
        f"process_story complete: {len(segments)} segments, {len(characters)} characters, "
        f"{kept_audio} kept existing audio"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        context = load_context()
        context.log(f"process_story failed: {exc}")
        context.result("failed", error=str(exc))
        raise
