#!/usr/bin/env python3
import json
import shutil
import sys
from pathlib import Path

EXCLUDES = {
    ".git",
    ".DS_Store",
    "node_modules",
    "dist",
    "coverage",
    ".turbo",
    ".next",
    ".cache",
    "__pycache__",
    ".omx",
    ".worktrees",
    ".clawhub",
    ".vscode",
    ".idea",
}


def should_skip(path: Path) -> bool:
    return path.name in EXCLUDES


def sync_tree(src: Path, dst: Path) -> None:
    dst.mkdir(parents=True, exist_ok=True)
    src_names = set()

    for item in src.iterdir():
        if should_skip(item):
            continue
        src_names.add(item.name)
        target = dst / item.name
        if item.is_symlink():
            if target.exists() or target.is_symlink():
                if target.is_dir() and not target.is_symlink():
                    shutil.rmtree(target)
                else:
                    target.unlink()
            target.symlink_to(Path(item.readlink()))
            continue
        if item.is_dir():
            if target.exists() and not target.is_dir():
                target.unlink()
            sync_tree(item, target)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)

    for item in list(dst.iterdir()):
        if item.name not in src_names and item.name not in EXCLUDES:
            if item.is_symlink():
                item.unlink()
            elif item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: sync_skill.py <aggregate_repo_root> <skill_name>", file=sys.stderr)
        return 2
    aggregate_root = Path(sys.argv[1]).resolve()
    skill_name = sys.argv[2]
    mapping = json.loads((aggregate_root / "scripts/skill-sync/sources.json").read_text(encoding="utf-8"))
    if skill_name not in mapping:
        print(f"unknown skill: {skill_name}", file=sys.stderr)
        return 2
    src = Path(mapping[skill_name]).expanduser().resolve()
    dst = (aggregate_root / skill_name).resolve()
    if not src.exists():
        print(f"missing source repo: {src}", file=sys.stderr)
        return 2
    sync_tree(src, dst)
    print(f"synced {skill_name}: {src} -> {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
