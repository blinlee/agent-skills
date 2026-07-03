#!/usr/bin/env python3
"""Build a lightweight source manifest for a local knowledge corpus."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_EXTENSIONS = (".md", ".markdown", ".txt")
DEFAULT_EXCLUDED_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".omx",
    "node_modules",
    "__pycache__",
    "source-pack",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_text_lossy(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def title_from_text(path: Path, text: str) -> str:
    for line in text.splitlines():
        match = re.match(r"^\s*#\s+(.+?)\s*$", line)
        if match:
            return match.group(1).strip()
    return path.stem.replace("-", " ").replace("_", " ").strip() or path.name


def should_skip(path: Path, excluded_dirs: set[str]) -> bool:
    return any(part in excluded_dirs for part in path.parts)


def discover_sources(root: Path, extensions: tuple[str, ...], excluded_dirs: set[str]) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if should_skip(rel, excluded_dirs):
            continue
        if path.suffix.lower() in extensions:
            files.append(path)
    return sorted(files, key=lambda p: p.relative_to(root).as_posix())


def build_manifest(root: Path, files: list[Path]) -> dict:
    sources = []
    for index, path in enumerate(files, start=1):
        rel = path.relative_to(root).as_posix()
        text = read_text_lossy(path)
        sources.append(
            {
                "id": f"S{index:03d}",
                "path": rel,
                "title": title_from_text(path, text),
                "kind": path.suffix.lower().lstrip(".") or "text",
                "line_count": len(text.splitlines()),
                "fingerprint": sha256_file(path),
            }
        )
    return {
        "schema_version": "1.0",
        "created_at": utc_now(),
        "root": root.as_posix(),
        "source_count": len(sources),
        "sources": sources,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a knowledge-distiller source manifest.")
    parser.add_argument("root", help="Corpus root directory")
    parser.add_argument(
        "--output",
        default="source-pack/source_manifest.json",
        help="Output JSON path, relative to root unless absolute",
    )
    parser.add_argument(
        "--extensions",
        default=",".join(DEFAULT_EXTENSIONS),
        help="Comma-separated extensions to include",
    )
    parser.add_argument(
        "--exclude-dir",
        action="append",
        default=[],
        help="Directory name to exclude; can be repeated",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    if not root.is_dir():
        raise SystemExit(f"Corpus root is not a directory: {root}")

    extensions = tuple(
        ext.strip().lower() if ext.strip().startswith(".") else f".{ext.strip().lower()}"
        for ext in args.extensions.split(",")
        if ext.strip()
    )
    excluded_dirs = set(DEFAULT_EXCLUDED_DIRS)
    excluded_dirs.update(args.exclude_dir)

    manifest = build_manifest(root, discover_sources(root, extensions, excluded_dirs))
    output = Path(args.output).expanduser()
    if not output.is_absolute():
        output = root / output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {manifest['source_count']} sources to {output}")


if __name__ == "__main__":
    main()
