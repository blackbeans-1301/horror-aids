from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

import common


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--asset", required=True, help="scene_video media catalog id")
    parser.add_argument("--brightness", type=float, required=True)
    parser.add_argument("--saturation", type=float, required=True)
    parser.add_argument("--vignette", choices=["true", "false"], required=True)
    parser.add_argument("--duration", type=float, default=4.0)
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=360)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    project_root = Path(args.project_root)
    asset = common.resolve_media_asset(project_root, args.asset, "scene_video")
    source_path = project_root / asset["path"]

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required for grade preview")

    # brightness/saturation/vignette arrive pre-resolved from the caller
    # (src/lib/grade.ts's resolveGrade, run client-side against the
    # operator's in-progress, unsaved edit) rather than being re-derived from
    # manifest.json/plan.json here — re-reading persisted files would show
    # stale values while the operator is still tuning the override.
    grade = {
        "brightness": args.brightness,
        "saturation": args.saturation,
        "vignette": args.vignette == "true",
    }
    vf = (
        f"scale={args.width}:{args.height}:force_original_aspect_ratio=increase,"
        f"crop={args.width}:{args.height},setsar=1,format=yuv420p,"
        + common.build_scene_grade_filter(grade)
    )
    command = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-nostdin",
        "-t",
        f"{args.duration}",
        "-i",
        str(source_path),
        "-vf",
        vf,
        "-an",
        "-r",
        "24",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "30",
        "-t",
        f"{args.duration}",
        "-f",
        "mp4",
        args.output,
    ]
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr[-4000:].strip() or "grade preview render failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
