#!/usr/bin/env python3
"""Manage the host-local default llm-wiki root."""

from __future__ import annotations

import argparse
import json
import os
import platform
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def canonical_config_path() -> Path:
    if platform.system().lower() == "windows":
        appdata = os.environ.get("APPDATA")
        if appdata:
            return Path(appdata) / "llm-wiki" / "config.json"

    return Path.home() / ".config" / "llm-wiki" / "config.json"


def override_config_path() -> Path | None:
    override = os.environ.get("llm_wiki_config")
    if override:
        return Path(override).expanduser()
    return None


def read_config_paths() -> list[Path]:
    paths: list[Path] = []

    override = override_config_path()
    if override:
        paths.append(override)

    paths.append(canonical_config_path())

    xdg_config = os.environ.get("XDG_CONFIG_HOME")
    if xdg_config:
        paths.append(Path(xdg_config).expanduser() / "llm-wiki" / "config.json")

    if platform.system().lower() == "darwin":
        paths.append(Path.home() / "Library" / "Application Support" / "llm-wiki" / "config.json")

    deduped: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        key = str(path)
        if key not in seen:
            seen.add(key)
            deduped.append(path)
    return deduped


def write_config_path() -> Path:
    return override_config_path() or canonical_config_path()


def read_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return {"_error": f"invalid_json: {exc}"}
    if not isinstance(data, dict):
        return {"_error": "config_root_must_be_object"}
    return data


def write_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True))


def found_payload(source: str, root: str, path: Path, kind: str, updated_at: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": "found",
        "source": source,
        "root": root,
        "exists": Path(root).expanduser().exists(),
        "kind": kind,
        "configPath": str(path),
    }
    if updated_at:
        payload["updatedAt"] = updated_at
    return payload


def show_default(args: argparse.Namespace) -> int:
    env_root = os.environ.get("llm_wiki_root")
    if env_root:
        root = str(Path(env_root).expanduser().resolve(strict=False))
        payload = found_payload("env", root, write_config_path(), os.environ.get("llm_wiki_root_kind", "unknown"))
        if args.require_existing and not payload["exists"]:
            payload["status"] = "missing_path"
            payload["error"] = "resolved_root_does_not_exist"
            write_json(payload)
            return 1
        write_json(payload)
        return 0

    searched_paths = read_config_paths()
    for path in searched_paths:
        data = read_config(path)
        if "_error" in data:
            write_json({"status": "error", "error": data["_error"], "configPath": str(path)})
            return 2

        root = data.get("defaultRoot")
        if not root:
            continue

        payload = found_payload("config", str(root), path, data.get("defaultRootKind", "unknown"), data.get("updatedAt"))
        if args.require_existing and not payload["exists"]:
            payload["status"] = "missing_path"
            payload["error"] = "resolved_root_does_not_exist"
            write_json(payload)
            return 1
        write_json(payload)
        return 0

    write_json({
        "status": "missing",
        "configPath": str(write_config_path()),
        "searchedConfigPaths": [str(path) for path in searched_paths],
    })
    return 1 if args.strict else 0


def set_default(args: argparse.Namespace) -> int:
    path = write_config_path()
    root = Path(args.root).expanduser().resolve(strict=False)
    data = read_config(path)
    if "_error" in data:
        write_json({"status": "error", "error": data["_error"], "configPath": str(path)})
        return 2

    data["defaultRoot"] = str(root)
    data["defaultRootKind"] = args.kind
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    write_json({"status": "saved", "root": str(root), "kind": args.kind, "configPath": str(path)})
    return 0


def set_embedding(args: argparse.Namespace) -> int:
    path = write_config_path()
    data = read_config(path)
    if "_error" in data:
        write_json({"status": "error", "error": data["_error"], "configPath": str(path)})
        return 2

    embedding = {
        "provider": args.provider,
        "endpoint": args.endpoint,
        "model": args.model,
    }
    if args.dimensions is not None:
        embedding["dimensions"] = args.dimensions
    if args.timeout_ms is not None:
        embedding["timeoutMs"] = args.timeout_ms
    if args.format is not None:
        embedding["format"] = args.format
    data["embeddingProvider"] = embedding
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    write_json({"status": "saved", "embeddingProvider": embedding, "configPath": str(path)})
    return 0


def clear_embedding(_: argparse.Namespace) -> int:
    path = write_config_path()
    data = read_config(path)
    if "_error" in data:
        write_json({"status": "error", "error": data["_error"], "configPath": str(path)})
        return 2
    data.pop("embeddingProvider", None)
    data.pop("embedding", None)
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    write_json({"status": "cleared", "configPath": str(path)})
    return 0


def clear_default(_: argparse.Namespace) -> int:
    path = write_config_path()
    data = read_config(path)
    if "_error" in data:
        write_json({"status": "error", "error": data["_error"], "configPath": str(path)})
        return 2
    data.pop("defaultRoot", None)
    data.pop("defaultRootKind", None)
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    write_json({"status": "cleared", "configPath": str(path)})
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage the host-local default llm-wiki root.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    show_parser = subparsers.add_parser("show", help="Show the resolved default root, if configured.")
    show_parser.add_argument("--strict", action="store_true", help="Exit non-zero when no default root is configured.")
    show_parser.add_argument("--require-existing", action="store_true", help="Exit non-zero when the resolved root path does not exist.")
    show_parser.set_defaults(func=show_default)

    set_parser = subparsers.add_parser("set", help="Save a host-local default root.")
    set_parser.add_argument("root", help="Knowledge root or registry root to save as the local default.")
    set_parser.add_argument("--kind", choices=["knowledge", "registry", "unknown"], default="unknown")
    set_parser.set_defaults(func=set_default)

    embedding_parser = subparsers.add_parser("embedding-set", help="Save a host-local embedding provider config.")
    embedding_parser.add_argument("--provider", choices=["local-http", "ollama", "lm-studio", "custom-endpoint"], default="ollama")
    embedding_parser.add_argument("--endpoint", required=True)
    embedding_parser.add_argument("--model", required=True)
    embedding_parser.add_argument("--dimensions", type=int)
    embedding_parser.add_argument("--timeout-ms", type=int)
    embedding_parser.add_argument("--format", choices=["ollama-embed", "ollama-embeddings", "openai-compatible"])
    embedding_parser.set_defaults(func=set_embedding)

    embedding_clear_parser = subparsers.add_parser("embedding-clear", help="Remove the saved host-local embedding provider config.")
    embedding_clear_parser.set_defaults(func=clear_embedding)

    clear_parser = subparsers.add_parser("clear", help="Remove the saved host-local default root.")
    clear_parser.set_defaults(func=clear_default)

    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
