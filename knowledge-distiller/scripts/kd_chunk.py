#!/usr/bin/env python3
"""Create a lightweight markdown chunk index from a source manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def clean_heading(text: str) -> str:
    return text.strip().strip("#").strip()


def split_markdown(source: dict, root: Path, max_lines: int, include_text: bool) -> list[dict]:
    path = root / source["path"]
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    chunks: list[dict] = []
    heading_stack: list[str] = []
    current: list[str] = []
    current_start = 1
    current_heading = ""

    def flush(end_line: int) -> None:
        nonlocal current, current_start, current_heading
        text = "\n".join(current).strip()
        if not text:
            current = []
            return
        chunk = {
            "source_id": source["id"],
            "path": source["path"],
            "heading_path": current_heading,
            "start_line": current_start,
            "end_line": end_line,
            "fingerprint": sha256_text(text),
        }
        if include_text:
            chunk["text"] = text
        chunks.append(chunk)
        current = []

    for line_no, line in enumerate(lines, start=1):
        heading_match = HEADING_RE.match(line)
        if heading_match:
            if current:
                flush(line_no - 1)
            level = len(heading_match.group(1))
            heading_stack = heading_stack[: level - 1]
            heading_stack.append(clean_heading(heading_match.group(2)))
            current_heading = " > ".join(heading_stack)
            current_start = line_no
            current = [line]
            continue

        if not current:
            current_start = line_no
            current_heading = " > ".join(heading_stack)
        current.append(line)
        if len(current) >= max_lines:
            flush(line_no)

    if current:
        flush(len(lines))
    return chunks


def build_chunk_index(manifest: dict, max_lines: int, include_text: bool) -> dict:
    root = Path(manifest["root"])
    all_chunks: list[dict] = []
    for source in manifest.get("sources", []):
        all_chunks.extend(split_markdown(source, root, max_lines, include_text))
    for index, chunk in enumerate(all_chunks, start=1):
        chunk["id"] = f"C{index:05d}"
    return {
        "schema_version": "1.0",
        "manifest_root": manifest["root"],
        "source_count": len(manifest.get("sources", [])),
        "chunk_count": len(all_chunks),
        "chunks": all_chunks,
    }


def write_semantic_scaffolds(output_dir: Path) -> None:
    scaffolds = {
        "evidence_snippets.json": {
            "schema_version": "1.0",
            "artifact": "evidence_snippets",
            "description": "Agent-filled source excerpts that support distilled claims.",
            "items": [],
        },
        "concept_table.json": {
            "schema_version": "1.0",
            "artifact": "concept_table",
            "description": "Agent-filled concepts with layer, evidence, variants, and confidence.",
            "concepts": [],
        },
        "relation_notes.json": {
            "schema_version": "1.0",
            "artifact": "relation_notes",
            "description": "Agent-filled links between concepts, including support, contradiction, refinement, and evolution.",
            "relations": [],
        },
    }
    for filename, payload in scaffolds.items():
        path = output_dir / filename
        if not path.exists():
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a knowledge-distiller chunk index.")
    parser.add_argument("manifest", help="Path to source_manifest.json")
    parser.add_argument(
        "--output",
        default=None,
        help="Output JSON path; defaults to chunk_index.json beside the manifest",
    )
    parser.add_argument("--max-lines", type=int, default=80, help="Maximum lines per chunk")
    parser.add_argument("--no-text", action="store_true", help="Omit chunk text from output")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest_path = Path(args.manifest).expanduser().resolve()
    if args.max_lines < 10:
        raise SystemExit("--max-lines must be at least 10")
    manifest = load_manifest(manifest_path)
    index = build_chunk_index(manifest, args.max_lines, include_text=not args.no_text)
    output = Path(args.output).expanduser() if args.output else manifest_path.with_name("chunk_index.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_semantic_scaffolds(output.parent)
    print(f"Wrote {index['chunk_count']} chunks to {output}")


if __name__ == "__main__":
    main()
