#!/usr/bin/env python3
"""Plan the deterministic llm-wiki query command for an agent.

This helper prevents agents from substituting source inspection for the real
query/query-registry workflow. It resolves the host-local default root, detects
whether the target is a knowledge root or registry root, and emits the exact
package-root CLI command to run.
"""
from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
PACKAGE_ROOT = SCRIPT_DIR.parent
ROOT_CONFIG = SCRIPT_DIR / "root_config.py"

EMBED_ENV_KEYS = [
    "LLM_WIKI_EMBEDDING_ENDPOINT",
    "LLM_WIKI_EMBEDDING_MODEL",
    "LLM_WIKI_EMBEDDING_PROVIDER",
    "LLM_WIKI_EMBEDDING_FORMAT",
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Plan a deterministic llm-wiki query or query-registry command.")
    parser.add_argument("question", help="Question to pass to llm-wiki query")
    parser.add_argument("--root", help="Explicit knowledge or registry root. Defaults to llm_wiki_root/env/config.")
    parser.add_argument("--kind", choices=["knowledge", "registry", "unknown"], help="Root kind override.")
    parser.add_argument("--json", action="store_true", help="Emit JSON only.")
    args = parser.parse_args()

    try:
        plan = build_plan(args.question, explicit_root=args.root, explicit_kind=args.kind)
    except Exception as error:  # noqa: BLE001 - command-line diagnostic boundary
        if args.json:
            print(json.dumps({"status": "error", "error": str(error)}, ensure_ascii=False, indent=2))
        else:
            print(f"error: {error}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
    else:
        print(f"status: {plan['status']}")
        print(f"rootKind: {plan['rootKind']}")
        print(f"root: {plan['root']}")
        print("recommendedCommand:")
        print(" ".join(shlex.quote(part) for part in plan["recommendedCommand"]))
    return 0


def build_plan(question: str, explicit_root: str | None = None, explicit_kind: str | None = None) -> dict[str, Any]:
    resolved = resolve_root(explicit_root, explicit_kind)
    root = Path(resolved["root"]).expanduser().resolve()
    if not root.exists():
        raise RuntimeError(f"resolved root does not exist: {root}")

    root_kind = resolved["kind"] if resolved["kind"] in {"knowledge", "registry"} else detect_kind(root)
    if root_kind == "unknown":
        raise RuntimeError(f"cannot determine whether root is knowledge or registry: {root}")

    command_name = "query-registry" if root_kind == "registry" else "query"
    command = ["npm", "run", "--silent", "cli", "--", command_name, str(root), question]

    notes: list[str] = [
        "Run recommendedCommand before answering; do not substitute source inspection for retrieval.",
    ]
    if root_kind == "registry":
        notes.append("Registry root detected; use query-registry and report searched wikis/citations.")
    else:
        notes.append("Knowledge root detected; use query and answer from returned citations.")

    embedding = embedding_status(root, root_kind)
    readiness = query_readiness(root)
    if not embedding["configured"]:
        notes.append("Embedding provider is not configured; query may still be valid via lexical/governance retrieval.")
    elif not embedding["cacheCandidates"]:
        notes.append("Embedding provider is configured but no matching cache candidate was found; run index/embed-index if semantic retrieval is expected.")
    else:
        notes.append("Embedding provider and at least one cache candidate are present; use --full only if you need to debug embedding signal diagnostics.")

    return {
        "status": "ok",
        "packageRoot": str(PACKAGE_ROOT),
        "root": str(root),
        "rootKind": root_kind,
        "rootSource": resolved.get("source"),
        "question": question,
        "recommendedCommand": command,
        "shellCommand": " ".join(shlex.quote(part) for part in command),
        "embedding": embedding,
        "readiness": readiness,
        "postRunChecks": [
            "readiness.status",
            "answerability",
            "sourceReadingPack.answerability",
            "sourceReadingPack.passages.length",
            "sourceReadingPack.passages[].text",
            "sourceReadingPack.passages[].rawPath or filePath",
            "Use --full only when debugging retrieval/status/embedding diagnostics.",
        ],
        "notes": notes,
    }


def resolve_root(explicit_root: str | None, explicit_kind: str | None) -> dict[str, Any]:
    if explicit_root:
        return {"root": explicit_root, "kind": explicit_kind or "unknown", "source": "explicit"}

    env_root = os.environ.get("llm_wiki_root") or os.environ.get("LLM_WIKI_ROOT")
    if env_root:
        return {"root": env_root, "kind": explicit_kind or "unknown", "source": "env"}

    process = subprocess.run(
        [sys.executable, str(ROOT_CONFIG), "show", "--strict", "--require-existing"],
        cwd=str(PACKAGE_ROOT),
        text=True,
        capture_output=True,
        check=False,
    )
    if process.returncode != 0:
        raise RuntimeError((process.stderr or process.stdout or "root config lookup failed").strip())
    payload = json.loads(process.stdout)
    if explicit_kind:
        payload["kind"] = explicit_kind
    return payload


def detect_kind(root: Path) -> str:
    registry_markers = [
        root / "system" / "registry" / "registry.json",
        root / "wikis",
    ]
    knowledge_markers = [
        root / "wiki" / "index.md",
        root / "wiki" / "SCHEMA.md",
    ]
    if any(marker.exists() for marker in registry_markers):
        return "registry"
    if any(marker.exists() for marker in knowledge_markers):
        return "knowledge"
    return "unknown"


def embedding_status(root: Path, root_kind: str) -> dict[str, Any]:
    host_config = load_host_embedding_config()
    endpoint = host_config.get("endpoint")
    model = host_config.get("model")
    provider = host_config.get("provider")
    configured = bool(endpoint and model)
    cache_roots: list[Path]
    if root_kind == "registry":
        cache_roots = sorted(root.glob("wikis/*/system/index/embeddings"))
    else:
        cache_roots = [root / "system" / "index" / "embeddings"]
    candidates: list[str] = []
    model_meta_candidates: list[str] = []
    for cache_root in cache_roots:
        if cache_root.exists():
            candidates.extend(str(path) for path in sorted(cache_root.glob("*/vectors.db")) if path.exists())
            model_meta_candidates.extend(str(path) for path in sorted(cache_root.glob("*/model_meta.json")) if path.exists())
    return {
        "configured": configured,
        "provider": provider,
        "model": model,
        "endpoint": endpoint,
        "source": host_config.get("source"),
        "configPath": host_config.get("configPath"),
        "envPresent": [key for key in EMBED_ENV_KEYS if os.environ.get(key) or os.environ.get(key.lower())],
        "cacheCandidates": candidates[:20],
        "cacheCandidateCount": len(candidates),
        "modelMetaCandidates": model_meta_candidates[:20],
        "modelMetaCandidateCount": len(model_meta_candidates),
    }


def query_readiness(root: Path) -> dict[str, Any]:
    process = subprocess.run(
        ["npm", "run", "--silent", "cli", "--", "query-readiness", str(root)],
        cwd=str(PACKAGE_ROOT),
        text=True,
        capture_output=True,
        check=False,
    )
    if process.returncode != 0:
        return {
            "status": "unknown",
            "error": (process.stderr or process.stdout or "query-readiness failed").strip(),
        }
    try:
        return json.loads(process.stdout)
    except json.JSONDecodeError as error:
        return {
            "status": "unknown",
            "error": f"query-readiness returned invalid JSON: {error}",
        }


def load_host_embedding_config() -> dict[str, Any]:
    if os.environ.get("llm_wiki_config"):
        config_paths: list[Path] = [Path(os.environ["llm_wiki_config"]).expanduser()]
    else:
        config_paths = [Path.home() / ".config" / "llm-wiki" / "config.json"]
    if os.environ.get("XDG_CONFIG_HOME"):
        config_paths.append(Path(os.environ["XDG_CONFIG_HOME"]).expanduser() / "llm-wiki" / "config.json")
    if sys.platform == "darwin":
        config_paths.append(Path.home() / "Library" / "Application Support" / "llm-wiki" / "config.json")

    seen: set[str] = set()
    for config_path in config_paths:
        key = str(config_path)
        if key in seen:
            continue
        seen.add(key)
        if not config_path.exists():
            continue
        data = json.loads(config_path.read_text(encoding="utf-8"))
        embedding = data.get("embeddingProvider") or data.get("embedding") or {}
        if isinstance(embedding, dict):
            return {**embedding, "source": "config", "configPath": str(config_path)}
    return {}


if __name__ == "__main__":
    raise SystemExit(main())
