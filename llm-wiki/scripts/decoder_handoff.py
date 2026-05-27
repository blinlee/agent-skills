#!/usr/bin/env python3
"""Plan an anything2md decode command that fits llm-wiki raw storage."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shlex
import sys
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def relative_posix(target: Path, root: Path) -> str:
    return os.path.relpath(target.resolve(), root.resolve()).replace(os.sep, "/")


def shell_join(command: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in command)


def build_plan(args: argparse.Namespace) -> dict[str, object]:
    root = Path(args.root).expanduser().resolve()
    source = Path(args.source).expanduser().resolve()
    anything2md_root = Path(args.anything2md_root).expanduser().resolve()

    if not source.is_file():
        raise FileNotFoundError(f"source is not a file: {source}")

    source_sha256 = sha256_file(source)
    object_dir = root / "raw" / "objects" / source_sha256[:2] / source_sha256
    decoded_dir = object_dir / "decoded"
    decoder_dir = object_dir / "decoder"
    output_path = Path(args.output).expanduser().resolve() if args.output else decoded_dir / f"{source.name}.decoded.md"
    metadata_path = (
        Path(args.metadata_output).expanduser().resolve()
        if args.metadata_output
        else decoder_dir / f"{output_path.name}.metadata.json"
    )
    asset_root = Path(args.asset_root).expanduser().resolve() if args.asset_root else decoder_dir / f"{output_path.name}.assets"
    archive_root = root / "raw" / "objects"
    archived_original_path = object_dir / source.name

    decode_script = anything2md_root / "scripts" / "decode.py"
    command = [
        "uv",
        "run",
        "--python",
        "3.13",
        "--with",
        "markitdown[all]",
        "python",
        str(decode_script),
        str(source),
        "--output",
        str(output_path),
        "--archive-root",
        str(archive_root),
        "--archive-original",
        "--metadata-output",
        str(metadata_path),
        "--asset-root",
        str(asset_root),
        "--source-label",
        relative_posix(archived_original_path, root),
        "--profile",
        "archive",
        "--json",
    ]

    return {
        "root": str(root),
        "source": str(source),
        "sourceSha256": source_sha256,
        "objectDirectory": str(object_dir),
        "decodedMarkdown": str(output_path),
        "metadataOutput": str(metadata_path),
        "assetRoot": str(asset_root),
        "archiveRoot": str(archive_root),
        "expectedOriginalArchive": str(archived_original_path),
        "decodeScript": str(decode_script),
        "command": command,
        "shellCommand": shell_join(command),
        "notes": [
            "Do not pass --knowledge-root to anything2md from llm-wiki.",
            "The original source is archived under raw/objects; decoder metadata and assets stay beside that raw object.",
            "Route or ingest decodedMarkdown after conversion succeeds.",
        ],
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", help="llm-wiki knowledge root or atlas registry root")
    parser.add_argument("source", help="non-Markdown local source file to decode")
    parser.add_argument("--anything2md-root", required=True, help="installed anything2md skill root")
    parser.add_argument("--output", help="decoded Markdown path; defaults under raw/objects/<sha>/decoded")
    parser.add_argument("--metadata-output", help="metadata sidecar path; defaults under raw/objects/<sha>/decoder")
    parser.add_argument("--asset-root", help="decoder asset directory; defaults under raw/objects/<sha>/decoder")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    try:
        plan = build_plan(parse_args(argv))
    except Exception as exc:
        print(json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps({"status": "ok", **plan}, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
