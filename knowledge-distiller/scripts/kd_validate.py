#!/usr/bin/env python3
"""Validate source-pack files and a rendered knowledge-distiller report."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

SOURCE_REF_RE = re.compile(r"\bS\d{3}\b")
OBVIOUS_NOISE_PATTERNS = (
    re.compile(r"powered by", re.IGNORECASE),
    re.compile(r"download(?:ed)? from", re.IGNORECASE),
    re.compile(r"关注公众号"),
    re.compile(r"仅供学习交流"),
    re.compile(r"下载自"),
    re.compile(r"第\s*\d+\s*页"),
)
PROFILE_REQUIRED_SECTIONS = {
    "general": (
        ("core distilled knowledge", "核心蒸馏知识"),
        ("evidence", "证据"),
        ("compression / fidelity", "compression/fidelity", "保真"),
    ),
    "philosophy": (
        ("core anchors", "核心锚点", "核心心法"),
        ("mechanism models", "机制模型"),
        ("strategy / tactic", "strategy/tactic", "策略"),
        ("evidence", "证据"),
        ("compression / fidelity", "compression/fidelity", "保真"),
    ),
    "factor-seed": (
        ("factor seeds", "factor seed", "因子"),
        ("observable proxy", "proxy", "可观测"),
        ("refutation", "证伪"),
        ("evidence", "证据"),
        ("compression / fidelity", "compression/fidelity", "保真"),
    ),
    "playbook": (
        ("operating principles", "操作原则"),
        ("patterns", "triggers", "模式"),
        ("evidence", "证据"),
        ("compression / fidelity", "compression/fidelity", "保真"),
    ),
    "process": (
        ("workflow", "stages", "流程"),
        ("roles", "角色"),
        ("gates", "关口"),
        ("evidence", "证据"),
    ),
    "memory-session": (
        ("durable lessons", "经验"),
        ("decisions", "rationale", "决策"),
        ("open threads", "open questions", "待跟进"),
        ("evidence", "证据"),
    ),
    "voice": (
        ("voice traits", "风格"),
        ("boundaries", "边界"),
        ("evidence", "证据"),
    ),
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_manifest(manifest: dict) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    sources = manifest.get("sources")
    if not isinstance(sources, list) or not sources:
        errors.append("manifest.sources must be a non-empty list")
        return errors, warnings

    seen_ids: set[str] = set()
    for source in sources:
        source_id = source.get("id")
        if not re.fullmatch(r"S\d{3}", str(source_id)):
            errors.append(f"invalid source id: {source_id}")
        if source_id in seen_ids:
            errors.append(f"duplicate source id: {source_id}")
        seen_ids.add(source_id)
        if not source.get("path"):
            errors.append(f"{source_id}: missing path")
        fingerprint = source.get("fingerprint", "")
        if not re.fullmatch(r"[0-9a-f]{64}", fingerprint):
            warnings.append(f"{source_id}: fingerprint is missing or not sha256")
    return errors, warnings


def validate_chunks(chunks: dict, source_ids: set[str]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    chunk_list = chunks.get("chunks")
    if not isinstance(chunk_list, list) or not chunk_list:
        errors.append("chunk_index.chunks must be a non-empty list")
        return errors, warnings

    seen_ids: set[str] = set()
    for chunk in chunk_list:
        chunk_id = chunk.get("id")
        if chunk_id in seen_ids:
            errors.append(f"duplicate chunk id: {chunk_id}")
        seen_ids.add(chunk_id)
        source_id = chunk.get("source_id")
        if source_id not in source_ids:
            errors.append(f"{chunk_id}: unknown source_id {source_id}")
        if int(chunk.get("start_line", 0)) > int(chunk.get("end_line", 0)):
            errors.append(f"{chunk_id}: start_line after end_line")
        if not chunk.get("heading_path"):
            warnings.append(f"{chunk_id}: empty heading_path")
    return errors, warnings


def has_any(text: str, candidates: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(candidate.lower() in lowered for candidate in candidates)


def validate_required_sections(text: str, profile: str, require_noise_review: bool) -> list[str]:
    errors: list[str] = []
    for group in PROFILE_REQUIRED_SECTIONS[profile]:
        if not has_any(text, group):
            errors.append(f"report missing required {profile} section marker: {' / '.join(group)}")
    if require_noise_review and not has_any(text, ("noise review", "噪声审查", "噪音审查")):
        errors.append("report missing required Noise Review section")
    return errors


def validate_report(
    report_path: Path,
    source_ids: set[str],
    profile: str,
    require_noise_review: bool,
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    text = report_path.read_text(encoding="utf-8", errors="replace")
    errors.extend(validate_required_sections(text, profile, require_noise_review))
    cited = set(SOURCE_REF_RE.findall(text))
    unknown = cited - source_ids
    if unknown:
        errors.append(f"report cites unknown source ids: {', '.join(sorted(unknown))}")
    if not cited:
        warnings.append("report contains no S### source citations")
    if "Evidence" not in text and "证据" not in text:
        warnings.append("report does not contain an Evidence/证据 section label")
    if "Inference" not in text and "推断" not in text:
        warnings.append("report does not label inferences explicitly")
    for pattern in OBVIOUS_NOISE_PATTERNS:
        if pattern.search(text):
            warnings.append(f"report may contain source-production noise: {pattern.pattern}")
    return errors, warnings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate knowledge-distiller artifacts.")
    parser.add_argument("--manifest", required=True, help="Path to source_manifest.json")
    parser.add_argument("--chunks", required=True, help="Path to chunk_index.json")
    parser.add_argument("--report", help="Optional rendered report markdown")
    parser.add_argument(
        "--profile",
        default="general",
        choices=sorted(PROFILE_REQUIRED_SECTIONS),
        help="Report profile to validate when --report is provided",
    )
    parser.add_argument(
        "--require-noise-review",
        action="store_true",
        help="Require a Noise Review section for noisy or converted sources",
    )
    parser.add_argument("--json", action="store_true", help="Emit machine-readable validation result")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest = load_json(Path(args.manifest))
    chunks = load_json(Path(args.chunks))

    errors, warnings = validate_manifest(manifest)
    source_ids = {source["id"] for source in manifest.get("sources", []) if "id" in source}
    chunk_errors, chunk_warnings = validate_chunks(chunks, source_ids)
    errors.extend(chunk_errors)
    warnings.extend(chunk_warnings)

    if args.report:
        report_errors, report_warnings = validate_report(
            Path(args.report),
            source_ids,
            args.profile,
            args.require_noise_review,
        )
        errors.extend(report_errors)
        warnings.extend(report_warnings)

    result = {"ok": not errors, "errors": errors, "warnings": warnings}
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        status = "OK" if result["ok"] else "FAILED"
        print(f"Validation {status}")
        for error in errors:
            print(f"ERROR: {error}")
        for warning in warnings:
            print(f"WARNING: {warning}")
    raise SystemExit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
