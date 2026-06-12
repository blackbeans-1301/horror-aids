from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return cleaned or "item"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--story", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--config", default="config/app.json")
    return parser.parse_args()


class WorkerContext:
    def __init__(self, story: str, job_id: str, config: str) -> None:
        self.project_root = Path.cwd()
        self.story_dir = (self.project_root / story).resolve()
        self.story_id = self.story_dir.name
        self.job_id = job_id
        self.config_path = (self.project_root / config).resolve()
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
    return WorkerContext(args.story, args.job_id, args.config)


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}
