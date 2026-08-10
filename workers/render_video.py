from __future__ import annotations

import select
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

import common
from common import load_context

DEFAULT_VIDEO: dict[str, Any] = {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "encoder": "libx264",
    "crf": 20,
    "preset": "medium",
    "videoBitrate": "6000k",
    "audioBitrate": "192k",
    "sampleRate": 48000,
    "channels": 2,
    "referenceLufs": -16,
    "loudnorm": {"targetLufs": -16, "truePeakDb": -1.5, "loudnessRange": 11},
    "introDurationMs": 10000,
    "introZoomEnabled": True,
    "introZoomEndScale": 1.12,
    "leadInMs": 800,
    "tailOutMs": 4000,
    "transitionMs": 1000,
    "grade": {"brightness": -0.05, "saturation": 0.85, "vignette": True},
    "ducking": {"enabled": True, "threshold": 0.05, "ratio": 6, "attackMs": 50, "releaseMs": 1000},
    "defaultGainDb": {"introMusic": -3, "bgMusic": -22, "rainAmbience": -26},
}

NESTED_VIDEO_KEYS = ("loudnorm", "grade", "ducking", "defaultGainDb")


def load_video_config(ctx) -> dict[str, Any]:
    configured = ctx.config().get("video", {})
    merged = {**DEFAULT_VIDEO, **configured}
    for key in NESTED_VIDEO_KEYS:
        merged[key] = {**DEFAULT_VIDEO[key], **configured.get(key, {})}
    return merged


def probe_duration_seconds(ffprobe: str, path: Path) -> float:
    completed = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or f"ffprobe failed for {path}")
    try:
        return float(completed.stdout.strip())
    except ValueError as exc:
        raise RuntimeError(f"ffprobe returned no duration for {path}") from exc


def compute_gain_db(entry: dict[str, Any] | None, plan_gain_db: float, reference_lufs: float) -> float:
    """Static catalog normalization: makes plan_gain_db mean the same loudness
    offset for every asset regardless of its own recorded level. Falls back to
    the bare gain when the asset has no measured loudness (ingest probe
    failed) — see VIDEO_ASSEMBLY_PLAN.md §5.
    """
    if entry is not None and entry.get("integratedLufs") is not None:
        return (reference_lufs - entry["integratedLufs"]) + plan_gain_db
    return plan_gain_db


class RenderStopped(Exception):
    pass


def run_ffmpeg_with_progress(command: list[str], total_sec: float, stderr_path: Path, ctx) -> None:
    """Run ffmpeg, logging progress at most every 5s and honoring a
    cooperative stop request. Raises RenderStopped if the operator stopped
    the job, or RuntimeError with the tail of stderr on a non-zero exit.
    """
    stderr_path.parent.mkdir(parents=True, exist_ok=True)
    with open(stderr_path, "w", encoding="utf-8") as stderr_file:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=stderr_file, text=True, bufsize=1)
        last_log = 0.0
        try:
            while True:
                if common.stop_requested():
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                    raise RenderStopped()

                assert process.stdout is not None
                ready, _, _ = select.select([process.stdout], [], [], 1.0)
                if not ready:
                    if process.poll() is not None:
                        break
                    continue

                line = process.stdout.readline()
                if not line:
                    if process.poll() is not None:
                        break
                    continue

                line = line.strip()
                if line.startswith("out_time="):
                    now = time.monotonic()
                    if now - last_log >= 5:
                        out_time = line.split("=", 1)[1]
                        ctx.log(f"render progress: {out_time} / {total_sec:.1f}s")
                        last_log = now
        finally:
            if process.stdout:
                process.stdout.close()
        returncode = process.wait()

    if returncode != 0:
        stderr_tail = stderr_path.read_text(encoding="utf-8", errors="ignore")[-4000:]
        raise RuntimeError(stderr_tail.strip() or "ffmpeg render failed")


def render(ctx) -> int:
    story = ctx.story()
    if story["approvals"]["finalAudio"]["status"] != "approved":
        raise ValueError("final audio must be approved before rendering video")

    narration_path = ctx.resolve(story["audio"]["finalPath"])
    if not narration_path.exists():
        raise FileNotFoundError(narration_path)

    plan = ctx.read_json(story["video"]["planPath"])
    if not plan.get("introImagePath"):
        raise ValueError("video plan has no intro image")
    intro_image_path = ctx.resolve(plan["introImagePath"])
    if not intro_image_path.exists():
        raise FileNotFoundError(intro_image_path)
    if not plan.get("sceneVideoId"):
        raise ValueError("video plan has no scene video")

    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise RuntimeError("ffmpeg and ffprobe are required to render video")

    video_config = load_video_config(ctx)
    project_root = ctx.project_root
    reference_lufs = float(video_config["referenceLufs"])
    sample_rate = int(video_config["sampleRate"])
    fps = int(video_config["fps"])
    width = int(video_config["width"])
    height = int(video_config["height"])

    scene_video = common.resolve_media_asset(project_root, plan["sceneVideoId"], "scene_video")
    bg_music = (
        common.resolve_media_asset(project_root, plan["bgMusicId"], "bg_music")
        if plan.get("bgMusicId")
        else None
    )
    rain_ambience = (
        common.resolve_media_asset(project_root, plan["rainAmbienceId"], "rain_ambience")
        if plan.get("rainAmbienceId")
        else None
    )
    intro_music = (
        common.resolve_media_asset(project_root, plan["introMusicId"], "intro_music")
        if plan.get("introMusicId")
        else None
    )
    if scene_video.get("hasAudioStream"):
        ctx.log(f"scene video {scene_video['id']} has an audio stream; ignored")
    if scene_video.get("loopable") is False:
        ctx.log(f"scene video {scene_video['id']} is not marked loopable; loop seams may be visible")

    narration_sec = probe_duration_seconds(ffprobe, narration_path)
    # Frame-align the intro so the concat seam lands on a frame boundary —
    # otherwise it duplicates or drops a frame at the single most-watched
    # moment of the video.
    raw_intro_sec = plan["introDurationMs"] / 1000.0
    intro_sec = round(raw_intro_sec * fps) / fps
    lead_in_sec = plan["leadInMs"] / 1000.0
    tail_out_sec = plan["tailOutMs"] / 1000.0
    main_sec = lead_in_sec + narration_sec + tail_out_sec
    total_sec = intro_sec + main_sec
    trans_sec = min(plan["transitionMs"] / 1000.0, intro_sec)

    # --- Inputs, assembled programmatically because optional assets shift
    # every index.
    inputs: list[list[str]] = []

    def add_input(args: list[str]) -> int:
        index = len(inputs)
        inputs.append(args)
        return index

    intro_idx = add_input(
        ["-framerate", str(fps), "-loop", "1", "-t", f"{intro_sec:.6f}", "-i", str(intro_image_path)]
    )
    narr_idx = add_input(["-i", str(narration_path)])
    scene_idx = add_input(
        ["-stream_loop", "-1", "-t", f"{main_sec:.6f}", "-i", str(project_root / scene_video["path"])]
    )
    music_idx = (
        add_input(["-stream_loop", "-1", "-t", f"{main_sec:.6f}", "-i", str(project_root / bg_music["path"])])
        if bg_music
        else None
    )
    rain_idx = (
        add_input(
            ["-stream_loop", "-1", "-t", f"{main_sec:.6f}", "-i", str(project_root / rain_ambience["path"])]
        )
        if rain_ambience
        else None
    )
    if intro_music:
        intro_music_idx = add_input(["-t", f"{intro_sec:.6f}", "-i", str(project_root / intro_music["path"])])
    else:
        intro_music_idx = add_input(
            ["-f", "lavfi", "-t", f"{intro_sec:.6f}", "-i", f"anullsrc=r={sample_rate}:cl=stereo"]
        )

    # --- Intro branch (image + Ken Burns): blurred-fill backdrop (proxy-sized,
    # then upscaled — far cheaper than blurring at full resolution) behind a
    # centered fitted foreground, so an arbitrary-aspect intro image never
    # shows black pillarboxes. The composite is built at 2x target resolution
    # so zoompan's integer-pixel crop-window jitter is imperceptible.
    zoom_enabled = bool(video_config["introZoomEnabled"])
    zoom_end = float(video_config["introZoomEndScale"]) if zoom_enabled else 1.0
    zoom_step = (zoom_end - 1) / max(1, intro_sec * fps) if zoom_enabled else 0.0
    w2, h2 = width * 2, height * 2
    intro_fade_out_start = max(0.0, intro_sec - trans_sec)
    intro_video_filter = (
        f"[{intro_idx}:v]split=2[ibg][ifg];"
        f"[ibg]scale=480:270:force_original_aspect_ratio=increase,crop=480:270,"
        f"gblur=sigma=8,eq=brightness=-0.20,scale={w2}:{h2}[ibgb];"
        f"[ifg]scale={w2}:{h2}:force_original_aspect_ratio=decrease[ifgs];"
        f"[ibgb][ifgs]overlay=(W-w)/2:(H-h)/2,setsar=1[introflat];"
        f"[introflat]zoompan=z='min(1+{zoom_step:.10f}*on,{zoom_end})':d=1:"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={width}x{height}:fps={fps},"
        f"format=yuv420p,setsar=1,fps={fps},"
        f"fade=t=in:st=0:d=1,fade=t=out:st={intro_fade_out_start:.6f}:d={trans_sec:.6f},"
        f"setpts=PTS-STARTPTS[vintro]"
    )

    # --- Main branch (video): fill-crop (never letterbox — ambience footage
    # losing its edges costs nothing), rebuild monotonic timestamps after the
    # loop (defends against PTS discontinuities at each -stream_loop boundary
    # surviving into concat), light config-driven grade.
    grade = video_config["grade"]
    main_video_chain = [
        f"scale={width}:{height}:force_original_aspect_ratio=increase",
        f"crop={width}:{height}",
        "setsar=1",
        "format=yuv420p",
        f"fps={fps}",
        "setpts=N/FRAME_RATE/TB",
        f"eq=brightness={grade['brightness']}:saturation={grade['saturation']}",
    ]
    if grade.get("vignette"):
        main_video_chain.append("vignette=PI/5")
    main_video_chain.append(f"fade=t=in:st=0:d={trans_sec:.6f}")
    main_video_chain.append(f"fade=t=out:st={max(0.0, main_sec - 2):.6f}:d=2")
    main_video_filter = f"[{scene_idx}:v]" + ",".join(main_video_chain) + "[vmain]"

    # --- Intro audio: statically leveled (not loudnorm'd — too short to
    # settle, and it should sit under the main bus's target, not match it).
    intro_gain_db = compute_gain_db(intro_music, plan["introMusicGainDb"], reference_lufs)
    intro_fade_start = max(0.0, intro_sec - 1.5)
    intro_audio_filter = (
        f"[{intro_music_idx}:a]aformat=sample_fmts=fltp:sample_rates={sample_rate}:channel_layouts=stereo,"
        f"asetpts=N/SR/TB,volume={intro_gain_db:.3f}dB,"
        f"afade=t=in:st=0:d=1.5,afade=t=out:st={intro_fade_start:.6f}:d=1.5,"
        f"apad=whole_dur={intro_sec:.6f},atrim=duration={intro_sec:.6f},asetpts=N/SR/TB[aintro]"
    )

    # --- Main audio: narration + (optionally ducked) music bed + rain bed,
    # loudnorm'd on the summed bus. See VIDEO_ASSEMBLY_PLAN.md §3 for why
    # music is ducked against narration and rain is not.
    ducking_cfg = video_config["ducking"]
    need_duck = bool(bg_music) and bool(plan.get("duckingEnabled", True)) and bool(ducking_cfg.get("enabled", True))

    narr_filter = (
        f"[{narr_idx}:a]aformat=sample_fmts=fltp:sample_rates={sample_rate}:channel_layouts=stereo,"
        f"asetpts=N/SR/TB,adelay={plan['leadInMs']}|{plan['leadInMs']},"
        f"apad=whole_dur={main_sec:.6f},atrim=duration={main_sec:.6f},asetpts=N/SR/TB"
    )
    narr_filter += ",asplit=2[narr][key]" if need_duck else "[narr]"

    filter_parts = [intro_video_filter, main_video_filter, intro_audio_filter, narr_filter]
    mix_labels = ["narr"]

    if bg_music:
        music_gain_db = compute_gain_db(bg_music, plan["bgMusicGainDb"], reference_lufs)
        music_filter = (
            f"[{music_idx}:a]aformat=sample_fmts=fltp:sample_rates={sample_rate}:channel_layouts=stereo,"
            f"asetpts=N/SR/TB,volume={music_gain_db:.3f}dB,"
            f"afade=t=in:st=0:d=2,afade=t=out:st={max(0.0, main_sec - 3):.6f}:d=3[music]"
        )
        filter_parts.append(music_filter)
        if need_duck:
            filter_parts.append(
                f"[music][key]sidechaincompress=threshold={ducking_cfg['threshold']}:"
                f"ratio={ducking_cfg['ratio']}:attack={ducking_cfg['attackMs']}:"
                f"release={ducking_cfg['releaseMs']}:makeup=1:link=maximum:detection=rms[musicduck]"
            )
            mix_labels.append("musicduck")
        else:
            mix_labels.append("music")
    else:
        music_gain_db = None

    if rain_ambience:
        rain_gain_db = compute_gain_db(rain_ambience, plan["rainAmbienceGainDb"], reference_lufs)
        filter_parts.append(
            f"[{rain_idx}:a]aformat=sample_fmts=fltp:sample_rates={sample_rate}:channel_layouts=stereo,"
            f"asetpts=N/SR/TB,volume={rain_gain_db:.3f}dB,"
            f"afade=t=in:st=0:d=3,afade=t=out:st={max(0.0, main_sec - 3):.6f}:d=3[rain]"
        )
        mix_labels.append("rain")
    else:
        rain_gain_db = None

    if len(mix_labels) > 1:
        amix_inputs = "".join(f"[{label}]" for label in mix_labels)
        filter_parts.append(f"{amix_inputs}amix=inputs={len(mix_labels)}:duration=first:normalize=0[mainmix]")
        mainmix_label = "mainmix"
    else:
        mainmix_label = "narr"

    loudnorm_cfg = video_config["loudnorm"]
    filter_parts.append(
        f"[{mainmix_label}]loudnorm=I={loudnorm_cfg['targetLufs']}:TP={loudnorm_cfg['truePeakDb']}:"
        f"LRA={loudnorm_cfg['loudnessRange']},"
        f"aformat=sample_fmts=fltp:sample_rates={sample_rate}:channel_layouts=stereo,"
        f"atrim=duration={main_sec:.6f},asetpts=N/SR/TB[amain]"
    )

    filter_parts.append("[vintro][aintro][vmain][amain]concat=n=2:v=1:a=1[vout][aout]")
    filter_complex = ";\n".join(filter_parts)
    ctx.write_text(f"tmp/{ctx.job_id}.filter.txt", filter_complex)

    encoder = video_config["encoder"]
    # Every render job gets its own file under video/renders/ rather than a
    # fixed video/final.mp4 — job ids are already unique and timestamped, so
    # re-rendering with a different plan (testing gain/timing tweaks) never
    # clobbers the previous attempt, and the operator can tell which config
    # produced which file. story.video.finalPath is what "current" means;
    # selecting an older render (see selectVideoRender in json-store.ts)
    # repoints it without re-rendering anything.
    partial_relative = f"video/renders/.{ctx.job_id}.mp4.partial"
    final_relative = f"video/renders/{ctx.job_id}.mp4"
    partial_output_path = ctx.resolve(partial_relative)
    partial_output_path.parent.mkdir(parents=True, exist_ok=True)

    command = [ffmpeg, "-y", "-hide_banner", "-nostdin"]
    for input_args in inputs:
        command.extend(input_args)
    command += ["-filter_complex", filter_complex, "-map", "[vout]", "-map", "[aout]"]
    command += ["-c:v", encoder]
    if encoder == "libx264":
        command += ["-preset", str(video_config["preset"]), "-crf", str(video_config["crf"])]
    else:
        command += ["-b:v", str(video_config["videoBitrate"])]
    command += [
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(fps),
        "-g",
        str(fps * 2),
        "-bf",
        "2",
        "-c:a",
        "aac",
        "-b:a",
        str(video_config["audioBitrate"]),
        "-ar",
        str(sample_rate),
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        "-map_metadata",
        "-1",
        "-t",
        f"{total_sec:.6f}",
        "-progress",
        "pipe:1",
        "-nostats",
        # The output filename ends in .partial (see the atomic-write comment
        # below), which ffmpeg can't infer a container from — name it
        # explicitly rather than renaming the file to end in .mp4.
        "-f",
        "mp4",
        str(partial_output_path),
    ]

    ctx.log("render_video started: " + " ".join(command))
    stderr_path = ctx.resolve(f"tmp/{ctx.job_id}.ffmpeg-stderr.log")
    run_ffmpeg_with_progress(command, total_sec, stderr_path, ctx)

    if not partial_output_path.exists() or partial_output_path.stat().st_size == 0:
        raise RuntimeError("rendered mp4 was not created")

    output_path = ctx.resolve(final_relative)
    partial_output_path.replace(output_path)

    receipt_assets = [
        {
            "role": "scene_video",
            "id": scene_video["id"],
            "path": scene_video["path"],
            "source": scene_video.get("source", ""),
            "appliedGainDb": None,
        },
        {
            "role": "intro_image",
            "id": None,
            "path": plan["introImagePath"],
            "source": "",
            "appliedGainDb": None,
        },
    ]
    if bg_music:
        receipt_assets.append(
            {
                "role": "bg_music",
                "id": bg_music["id"],
                "path": bg_music["path"],
                "source": bg_music.get("source", ""),
                "appliedGainDb": round(music_gain_db, 2) if music_gain_db is not None else None,
            }
        )
    if rain_ambience:
        receipt_assets.append(
            {
                "role": "rain_ambience",
                "id": rain_ambience["id"],
                "path": rain_ambience["path"],
                "source": rain_ambience.get("source", ""),
                "appliedGainDb": round(rain_gain_db, 2) if rain_gain_db is not None else None,
            }
        )
    if intro_music:
        receipt_assets.append(
            {
                "role": "intro_music",
                "id": intro_music["id"],
                "path": intro_music["path"],
                "source": intro_music.get("source", ""),
                "appliedGainDb": round(intro_gain_db, 2),
            }
        )

    duration_ms = round(total_sec * 1000)
    receipt = {
        "jobId": ctx.job_id,
        "renderedAt": common.utc_now(),
        "outputPath": final_relative,
        "durationMs": duration_ms,
        "introDurationMs": round(intro_sec * 1000),
        "narrationDurationMs": round(narration_sec * 1000),
        "width": width,
        "height": height,
        "fps": fps,
        "encoder": encoder,
        "loudnessTargetLufs": loudnorm_cfg["targetLufs"],
        "assets": receipt_assets,
        "plan": plan,
        "ffmpegCommand": command,
    }
    ctx.write_json(f"video/renders/{ctx.job_id}.render.json", receipt)

    story = ctx.story()
    story["video"]["finalPath"] = final_relative
    story["video"]["status"] = "complete"
    story["video"]["durationMs"] = duration_ms
    story["video"]["renderedAt"] = common.utc_now()
    story["approvals"]["finalVideo"] = {"status": "pending", "approvedAt": None}
    ctx.write_story(story)
    ctx.result("complete", finalPath=final_relative, durationMs=duration_ms)
    ctx.log(f"render_video complete: {output_path}")
    return 0


def main() -> int:
    common.install_stop_handler()
    ctx = load_context()
    try:
        return render(ctx)
    except RenderStopped:
        ctx.log("render_video stopped by request")
        story = ctx.story()
        story["video"]["status"] = "pending"
        ctx.write_story(story)
        ctx.result("cancelled")
        return common.STOPPED_EXIT_CODE
    except Exception as exc:
        # A worker that set video.status to "running" before spawning must
        # clear it on failure too, or the story is stuck showing a render in
        # progress forever — story.json is otherwise only ever updated here
        # on success.
        try:
            story = ctx.story()
            story["video"]["status"] = "failed"
            ctx.write_story(story)
        except Exception:
            pass
        ctx.log(f"render_video failed: {exc}")
        ctx.result("failed", error=str(exc))
        raise


if __name__ == "__main__":
    raise SystemExit(main())
