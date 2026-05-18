#!/usr/bin/env python3

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
AGENTS = ROOT / "AGENTS.md"
CLAUDE = ROOT / "CLAUDE.md"
SKILL = ROOT / "SKILL.md"
README = ROOT / "README.md"
WORKFLOW_MANIFEST = ROOT / "references" / "workflow-manifest.json"
COMPLIANCE_SCRIPT = ROOT / "scripts" / "check_workflow_compliance.py"
DASHBOARD_SCHEMA = ROOT / "assets" / "decision-dashboard.schema.json"

REMOVED_MARKDOWN_SURFACES = (
    ROOT / ".github" / "copilot-instructions.md",
    ROOT / ".github" / "PULL_REQUEST_TEMPLATE.md",
    ROOT / ".github" / "instructions",
    ROOT / ".claude" / "skills",
    ROOT / "README_EN.md",
    ROOT / "README_CHT.md",
    ROOT / "CHANGELOG.md",
)

FORBIDDEN_PUBLIC_TERMS = (
    "daily_stock_analysis",
    "DSA",
    "upstream",
    "historical",
    "legacy",
    "Legacy",
    "原样迁移",
    "迁移自",
    "旧工程",
    "旧 repo",
    "原始 repo",
    "二次开发",
    "半成品",
)


def fail(message: str) -> None:
    print(f"[ai-assets] ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def ensure_file_exists(path: Path, description: str) -> None:
    if not path.exists():
        fail(f"{description} is missing: {path.relative_to(ROOT)}")


def git_ls_files(*paths: str) -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "--", *paths],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def ensure_symlink() -> None:
    ensure_file_exists(AGENTS, "canonical AGENTS.md")
    if not CLAUDE.exists():
        fail("CLAUDE.md is missing")
    if not CLAUDE.is_symlink():
        fail("CLAUDE.md must be a symlink to AGENTS.md")
    target = Path(CLAUDE.readlink())
    if target != Path("AGENTS.md"):
        fail(f"CLAUDE.md must point to AGENTS.md, found: {target}")


def ensure_public_skill_surface() -> None:
    ensure_file_exists(SKILL, "public Skill contract")
    ensure_file_exists(README, "human helper README")
    skill = SKILL.read_text(encoding="utf-8")
    readme = README.read_text(encoding="utf-8")
    if "name: invest-analysis-pro" not in skill:
        fail("SKILL.md frontmatter name must be invest-analysis-pro")
    if "do not ask the user to run commands manually" not in skill.lower():
        fail("SKILL.md must state in English that users should not be asked to run commands manually")
    if "SKILL.md" not in readme:
        fail("README.md must identify SKILL.md as the public contract")
    ensure_file_exists(WORKFLOW_MANIFEST, "machine-readable workflow manifest")
    ensure_file_exists(COMPLIANCE_SCRIPT, "workflow compliance script")
    ensure_file_exists(DASHBOARD_SCHEMA, "Decision Dashboard schema")


def ensure_removed_surfaces_not_tracked() -> None:
    tracked = set(git_ls_files(".github", ".claude", "README_EN.md", "README_CHT.md", "CHANGELOG.md", "docs"))
    forbidden_prefixes = (
        ".github/copilot-instructions.md",
        ".github/PULL_REQUEST_TEMPLATE.md",
        ".github/instructions/",
        ".github/ISSUE_TEMPLATE/",
        ".claude/skills/",
        "README_EN.md",
        "README_CHT.md",
        "CHANGELOG.md",
        "docs/",
    )
    bad = [p for p in sorted(tracked) if p.startswith(forbidden_prefixes) and (ROOT / p).exists()]
    if bad:
        fail("old public/documentation surfaces are still tracked: " + ", ".join(bad))


def ensure_local_removed_paths_absent() -> None:
    existing = [p.relative_to(ROOT).as_posix() for p in REMOVED_MARKDOWN_SURFACES if p.exists()]
    if existing:
        fail("removed public markdown surfaces still exist locally: " + ", ".join(existing))


def public_markdown_files() -> list[Path]:
    paths = [SKILL, README, AGENTS, ROOT / "strategies" / "README.md"]
    paths.extend(sorted((ROOT / "references").rglob("*.md")))
    paths.extend(sorted((ROOT / "assets").rglob("*.md")))
    paths.extend(sorted((ROOT / "evals").rglob("*.md")))
    return [p for p in paths if p.exists()]


def ensure_current_product_language() -> None:
    for path in public_markdown_files():
        text = path.read_text(encoding="utf-8")
        for term in FORBIDDEN_PUBLIC_TERMS:
            if term == "daily_stock_analysis" and path == README:
                continue
            if term in text:
                fail(f"forbidden stale wording {term!r} appears in {path.relative_to(ROOT)}")


def main() -> None:
    ensure_symlink()
    ensure_public_skill_surface()
    ensure_removed_surfaces_not_tracked()
    ensure_local_removed_paths_absent()
    ensure_current_product_language()
    print("[ai-assets] OK")


if __name__ == "__main__":
    main()
