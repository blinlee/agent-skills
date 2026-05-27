#!/usr/bin/env python3
"""Discover installed OpenClaw/Codex skills without shell-specific snippets."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any


def candidate_skill_roots() -> list[Path]:
    roots: list[Path] = []
    for env_name in ("AGENTS_SKILLS_DIR", "OPENCLAW_SKILLS_DIR"):
        value = os.environ.get(env_name)
        if value:
            roots.append(Path(value).expanduser())

    codex_home = os.environ.get("CODEX_HOME")
    if codex_home:
        roots.append(Path(codex_home).expanduser() / "skills")

    home = Path.home()
    roots.extend(
        [
            home / ".agents" / "skills",
            home / ".openclaw" / "skills",
            home / ".codex" / "skills",
        ]
    )

    deduped: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        key = str(root)
        if key not in seen:
            deduped.append(root)
            seen.add(key)
    return deduped


def discover(skill_name: str) -> dict[str, Any]:
    roots = candidate_skill_roots()
    matches = []
    for root in roots:
        skill_root = root / skill_name
        skill_file = skill_root / "SKILL.md"
        if skill_file.is_file():
            matches.append({"skillRoot": str(skill_root), "skillFile": str(skill_file)})

    payload: dict[str, Any] = {
        "skill": skill_name,
        "status": "found" if matches else "missing",
        "matches": matches,
        "searchedRoots": [str(root) for root in roots],
    }
    if matches:
        payload.update(matches[0])
    return payload


def write_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True))


def main() -> int:
    parser = argparse.ArgumentParser(description="Discover installed skills by name.")
    parser.add_argument("skill", help="Skill directory name, for example anything2md.")
    parser.add_argument("--json", action="store_true", help="Emit structured JSON.")
    parser.add_argument("--field", choices=["skillRoot", "skillFile"], help="Print one field from the first match.")
    args = parser.parse_args()

    payload = discover(args.skill)
    if payload["status"] != "found":
        if args.json or not args.field:
            write_json(payload)
        return 1

    if args.field:
        print(payload[args.field])
    else:
        write_json(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
