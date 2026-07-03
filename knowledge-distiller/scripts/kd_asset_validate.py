#!/usr/bin/env python3
"""Validate durable knowledge-assets files."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ASSET_ID_RE = re.compile(r"\bKA-\d{4}\b")
ASSET_HEADING_RE = re.compile(r"^#{1,6}\s+(KA-\d{4})\b", re.MULTILINE)
SOURCE_REF_RE = re.compile(r"\bS\d{3}\b")
REQUIRED_STRICT_FILES = (
    "index.md",
    "asset-manifest.json",
    "answer-protocol.md",
    "conflicts.md",
    "currentness-ledger.md",
    "evidence-index.md",
    "open-questions.md",
)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def collect_source_ids(source_pack: Path | None, manifest_path: Path | None) -> set[str]:
    if manifest_path:
        manifest = load_json(manifest_path)
    elif source_pack:
        manifest = load_json(source_pack / "source_manifest.json")
    else:
        return set()
    return {str(source.get("id")) for source in manifest.get("sources", []) if source.get("id")}


def markdown_files(assets_dir: Path) -> list[Path]:
    return sorted(path for path in assets_dir.glob("*.md") if path.is_file())


def validate_manifest_file(assets_dir: Path) -> tuple[list[str], list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    declared_paths: list[str] = []
    manifest_path = assets_dir / "asset-manifest.json"
    if not manifest_path.exists():
        warnings.append("asset-manifest.json is missing")
        return errors, warnings, declared_paths

    try:
        manifest = load_json(manifest_path)
    except json.JSONDecodeError as exc:
        errors.append(f"asset-manifest.json is invalid JSON: {exc}")
        return errors, warnings, declared_paths

    if not manifest.get("schema_version"):
        errors.append("asset-manifest.json missing schema_version")
    assets = manifest.get("assets")
    if not isinstance(assets, list) or not assets:
        errors.append("asset-manifest.json assets must be a non-empty list")
        return errors, warnings, declared_paths

    for asset in assets:
        rel_path = asset.get("path") if isinstance(asset, dict) else None
        if not rel_path:
            errors.append("asset-manifest.json asset entry missing path")
            continue
        declared_paths.append(str(rel_path))
        if not (assets_dir / rel_path).exists():
            errors.append(f"asset-manifest.json references missing asset file: {rel_path}")
    return errors, warnings, declared_paths


def collect_asset_ids(files: list[Path]) -> tuple[dict[str, Path], list[str]]:
    ids: dict[str, Path] = {}
    duplicates: list[str] = []
    for path in files:
        text = path.read_text(encoding="utf-8", errors="replace")
        for match in ASSET_HEADING_RE.findall(text):
            if match in ids and ids[match] != path:
                duplicates.append(match)
            ids.setdefault(match, path)
    return ids, duplicates


def validate_markdown_refs(
    files: list[Path],
    asset_ids: set[str],
    source_ids: set[str],
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    for path in files:
        text = path.read_text(encoding="utf-8", errors="replace")
        refs = set(ASSET_ID_RE.findall(text))
        unknown_assets = refs - asset_ids
        if unknown_assets:
            names = ", ".join(sorted(unknown_assets))
            errors.append(f"{path.name} references unknown asset ids: {names}")

        if source_ids:
            cited_sources = set(SOURCE_REF_RE.findall(text))
            unknown_sources = cited_sources - source_ids
            if unknown_sources:
                names = ", ".join(sorted(unknown_sources))
                errors.append(f"{path.name} cites unknown source ids: {names}")
        elif SOURCE_REF_RE.search(text):
            warnings.append(f"{path.name} cites S### ids but no source manifest was provided")
    return errors, warnings


def validate_assets(
    assets_dir: Path,
    source_ids: set[str],
    strict: bool,
) -> dict:
    errors: list[str] = []
    warnings: list[str] = []

    if not assets_dir.exists() or not assets_dir.is_dir():
        return {"ok": False, "errors": [f"assets directory not found: {assets_dir}"], "warnings": []}

    if not (assets_dir / "index.md").exists():
        errors.append("knowledge-assets/index.md is required")

    if strict:
        for filename in REQUIRED_STRICT_FILES:
            if not (assets_dir / filename).exists():
                errors.append(f"strict mode requires {filename}")

    manifest_errors, manifest_warnings, declared_paths = validate_manifest_file(assets_dir)
    errors.extend(manifest_errors)
    warnings.extend(manifest_warnings)

    files = markdown_files(assets_dir)
    if not files:
        errors.append("knowledge-assets must contain at least one markdown file")

    asset_ids_by_path, duplicates = collect_asset_ids(files)
    for duplicate in sorted(set(duplicates)):
        errors.append(f"duplicate asset id: {duplicate}")
    if not asset_ids_by_path:
        warnings.append("no KA-#### asset ids found")

    ref_errors, ref_warnings = validate_markdown_refs(files, set(asset_ids_by_path), source_ids)
    errors.extend(ref_errors)
    warnings.extend(ref_warnings)

    if declared_paths:
        markdown_names = {path.name for path in files}
        declared_markdown = {Path(path).name for path in declared_paths if path.endswith(".md")}
        undeclared = sorted(markdown_names - declared_markdown)
        if undeclared:
            warnings.append(f"markdown files not listed in asset-manifest.json: {', '.join(undeclared)}")

    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "asset_count": len(asset_ids_by_path),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate knowledge-distiller durable assets.")
    parser.add_argument("--assets", required=True, help="Path to knowledge-assets directory")
    parser.add_argument("--source-pack", help="Path to source-pack directory")
    parser.add_argument("--manifest", help="Path to source_manifest.json")
    parser.add_argument("--strict", action="store_true", help="Require report-grade management files")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable result")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_ids = collect_source_ids(
        Path(args.source_pack) if args.source_pack else None,
        Path(args.manifest) if args.manifest else None,
    )
    result = validate_assets(Path(args.assets), source_ids, args.strict)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        status = "OK" if result["ok"] else "FAILED"
        print(f"Asset validation {status}")
        for error in result["errors"]:
            print(f"ERROR: {error}")
        for warning in result["warnings"]:
            print(f"WARNING: {warning}")
    raise SystemExit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
