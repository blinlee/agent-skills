#!/usr/bin/env python3
"""Decode a local document to Markdown for llm-wiki.

High-fidelity document formats route to MinerU when available. Broad fallback
formats route to MarkItDown.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from importlib import metadata as importlib_metadata
from pathlib import Path
from tempfile import NamedTemporaryFile
from tempfile import TemporaryDirectory
from typing import Any


URI_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
MINERU_EXTENSIONS = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".jp2",
    ".webp",
    ".gif",
    ".bmp",
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
}


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def path_label(path: str, base: Path | None = None) -> str:
    if is_uri(path):
        return path

    resolved = Path(path).expanduser().resolve()
    if base is not None:
        try:
            return resolved.relative_to(base.resolve()).as_posix()
        except ValueError:
            pass
    try:
        return resolved.relative_to(Path.cwd()).as_posix()
    except ValueError:
        return resolved.name


def non_clobbering_path(path: Path) -> Path:
    if not path.exists():
        return path

    stem = path.stem
    suffix = path.suffix
    parent = path.parent
    counter = 2
    while True:
        candidate = parent / f"{stem}-{counter}{suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


def json_print(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def markitdown_python_version() -> str | None:
    try:
        return importlib_metadata.version("markitdown")
    except importlib_metadata.PackageNotFoundError:
        return None


def markitdown_cli_version(executable: str) -> str | None:
    try:
        completed = subprocess.run(
            [executable, "--version"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except OSError:
        return None

    text = (completed.stdout or completed.stderr).strip()
    return text or None


def mineru_cli_version(executable: str) -> str | None:
    try:
        completed = subprocess.run(
            [executable, "version"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except OSError:
        return None

    text = (completed.stdout or completed.stderr).strip()
    return text or None


def availability() -> dict[str, Any]:
    markitdown_cli = shutil.which("markitdown")
    mineru_cli = shutil.which("mineru-open-api")
    python_version = markitdown_python_version()
    markitdown_available = python_version is not None or markitdown_cli is not None
    mineru_available = mineru_cli is not None
    return {
        "status": "ok" if markitdown_available or mineru_available else "missing",
        "python": {
            "executable": sys.executable,
            "version": sys.version.split()[0],
        },
        "uv": {
            "available": shutil.which("uv") is not None,
            "recommendedCommand": "uv run --python 3.13 --with 'markitdown[all]' python skills/markitdown-decoder/scripts/decode.py <source> --output <decoded.md> --json",
        },
        "router": {
            "mineruExtensions": sorted(MINERU_EXTENSIONS),
            "fallbackDecoder": "markitdown",
        },
        "mineru": {
            "available": mineru_available,
            "path": mineru_cli,
            "version": mineru_cli_version(mineru_cli) if mineru_cli else None,
        },
        "pythonPackage": {
            "available": python_version is not None,
            "version": python_version,
        },
        "cli": {
            "available": markitdown_cli is not None,
            "path": markitdown_cli,
            "version": markitdown_cli_version(markitdown_cli) if markitdown_cli else None,
        },
    }


def list_plugins() -> list[dict[str, str]]:
    try:
        entries = importlib_metadata.entry_points(group="markitdown.plugin")
    except TypeError:
        entries = importlib_metadata.entry_points().get("markitdown.plugin", [])
    return [{"name": entry.name, "value": entry.value} for entry in entries]


def is_uri(source: str) -> bool:
    return URI_RE.match(source) is not None


def default_output_path(source: str, allow_uri: bool) -> Path:
    if is_uri(source):
        if not allow_uri:
            raise ValueError("URI input requires --allow-uri")
        safe = re.sub(r"[^A-Za-z0-9._-]+", "-", source).strip("-") or "decoded"
        return Path(f"{safe}.decoded.md")

    path = Path(source)
    return path.with_name(f"{path.name}.decoded.md")


def source_extension(source: str) -> str:
    if is_uri(source):
        return Path(source.split("?", 1)[0]).suffix.lower()
    return Path(source).suffix.lower()


def choose_decoder(args: argparse.Namespace, source: str) -> str:
    if args.decoder != "auto":
        return args.decoder
    if source_extension(source) in MINERU_EXTENSIONS:
        return "mineru"
    return "markitdown"


def yaml_quote(value: Any) -> str:
    text = "" if value is None else str(value)
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def add_frontmatter(markdown: str, fields: dict[str, Any]) -> str:
    lines = ["---"]
    for key, value in fields.items():
        if value is None:
            continue
        lines.append(f"{key}: {yaml_quote(value)}")
    lines.append("---")
    lines.append("")
    return "\n".join(lines) + markdown.lstrip()


def infer_knowledge_root_from_inbox(source_path: Path) -> Path | None:
    parts = source_path.resolve().parts
    for index in range(len(parts) - 1):
        if parts[index] == "raw" and parts[index + 1] == "inbox":
            return Path(*parts[:index])
    return None


def is_under(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def default_metadata_path(output_path: Path, knowledge_root: Path | None) -> Path:
    if knowledge_root is not None and is_under(output_path, knowledge_root / "raw" / "inbox"):
        return knowledge_root / "system" / "decoders" / "metadata" / f"{output_path.name}.metadata.json"
    return output_path.with_name(f"{output_path.name}.metadata.json")


def archive_original(args: argparse.Namespace, source: str, source_sha256: str | None) -> Path | None:
    if not args.archive_original:
        return None
    if is_uri(source):
        raise ValueError("--archive-original only supports local files")
    if source_sha256 is None:
        raise ValueError("--archive-original requires a source sha256")

    source_path = Path(source).expanduser().resolve()
    knowledge_root = Path(args.knowledge_root).expanduser().resolve() if args.knowledge_root else infer_knowledge_root_from_inbox(source_path)
    if knowledge_root is None:
        raise ValueError("--archive-original requires --knowledge-root unless the source is under <knowledgeRoot>/raw/inbox")

    archive_root = Path(args.archive_root).expanduser().resolve() if args.archive_root else knowledge_root / "raw" / "archive" / "document-decoder-originals"
    archive_dir = archive_root / source_sha256[:2] / source_sha256
    archive_dir.mkdir(parents=True, exist_ok=True)
    target_path = non_clobbering_path(archive_dir / source_path.name)
    shutil.move(str(source_path), str(target_path))
    return target_path


def build_stream_info(args: argparse.Namespace) -> Any | None:
    if not any([args.extension, args.mime_type, args.charset]):
        return None

    from markitdown import StreamInfo

    extension = args.extension
    if extension and not extension.startswith("."):
        extension = f".{extension}"

    return StreamInfo(
        extension=extension,
        mimetype=args.mime_type,
        charset=args.charset,
    )


def markitdown_init_kwargs(args: argparse.Namespace) -> dict[str, Any]:
    kwargs: dict[str, Any] = {}
    if args.use_docintel:
        if not args.endpoint:
            raise ValueError("--use-docintel requires --endpoint")
        kwargs["docintel_endpoint"] = args.endpoint
    if args.use_cu:
        if not args.cu_endpoint:
            raise ValueError("--use-cu requires --cu-endpoint")
        kwargs["cu_endpoint"] = args.cu_endpoint
        if args.cu_analyzer:
            kwargs["cu_analyzer_id"] = args.cu_analyzer
        if args.cu_file_types:
            from markitdown.converters import ContentUnderstandingFileType

            kwargs["cu_file_types"] = [
                ContentUnderstandingFileType(name.strip().lower())
                for name in args.cu_file_types.split(",")
                if name.strip()
            ]
    return kwargs


def decode_with_python(args: argparse.Namespace, source: str) -> tuple[str, str]:
    from markitdown import MarkItDown

    markitdown = MarkItDown(enable_plugins=args.use_plugins, **markitdown_init_kwargs(args))
    stream_info = build_stream_info(args)
    convert_kwargs = {"keep_data_uris": args.keep_data_uris}

    if is_uri(source):
        result = markitdown.convert_uri(source, stream_info=stream_info, **convert_kwargs)
    else:
        result = markitdown.convert_local(source, stream_info=stream_info, **convert_kwargs)

    return result.markdown, markitdown_python_version() or "python-package"


def decode_with_cli(args: argparse.Namespace, source: str) -> tuple[str, str]:
    executable = shutil.which("markitdown")
    if not executable:
        raise RuntimeError("markitdown executable is not on PATH")

    command = [executable]
    if args.extension:
        command.extend(["--extension", args.extension])
    if args.mime_type:
        command.extend(["--mime-type", args.mime_type])
    if args.charset:
        command.extend(["--charset", args.charset])
    if args.keep_data_uris:
        command.append("--keep-data-uris")
    if args.use_plugins:
        command.append("--use-plugins")
    if args.use_docintel:
        command.append("--use-docintel")
        if args.endpoint:
            command.extend(["--endpoint", args.endpoint])
    if args.use_cu:
        command.append("--use-cu")
        if args.cu_endpoint:
            command.extend(["--cu-endpoint", args.cu_endpoint])
        if args.cu_analyzer:
            command.extend(["--cu-analyzer", args.cu_analyzer])
        if args.cu_file_types:
            command.extend(["--cu-file-types", args.cu_file_types])
    command.append(source)

    with NamedTemporaryFile("w+", suffix=".md", delete=False) as tmp:
        tmp_path = Path(tmp.name)

    try:
        completed = subprocess.run(
            [*command, "--output", str(tmp_path)],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if completed.returncode != 0:
            raise RuntimeError((completed.stderr or completed.stdout).strip() or "markitdown CLI failed")
        return tmp_path.read_text(encoding="utf-8"), markitdown_cli_version(executable) or "cli"
    finally:
        tmp_path.unlink(missing_ok=True)


def default_asset_root(output_path: Path, knowledge_root: Path | None) -> Path:
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", output_path.name).strip("-") or "decoded.md"
    if knowledge_root is not None:
        return knowledge_root / "system" / "decoders" / "assets" / safe_name
    return output_path.with_name(f"{output_path.name}.assets")


def relative_posix_path(target: Path, start: Path) -> str:
    return os.path.relpath(target.resolve(), start.resolve()).replace(os.sep, "/")


def rewrite_mineru_asset_refs(markdown: str, output_path: Path, asset_root: Path) -> str:
    images_root = asset_root / "images"
    if not images_root.exists():
        return markdown

    rel_images = relative_posix_path(images_root, output_path.parent)
    markdown = re.sub(r"\((images/[^)]+)\)", lambda match: f"({rel_images}/{match.group(1)[len('images/'):]})", markdown)
    markdown = re.sub(r'src="images/([^"]+)"', lambda match: f'src="{rel_images}/{match.group(1)}"', markdown)
    return markdown


def move_mineru_assets(tmp_output_path: Path, asset_root: Path) -> list[str]:
    tmp_images = tmp_output_path.parent / "images"
    if not tmp_images.exists():
        return []

    target_images = asset_root / "images"
    target_images.mkdir(parents=True, exist_ok=True)
    asset_files: list[str] = []
    for source_file in sorted(tmp_images.iterdir()):
        if not source_file.is_file():
            continue
        target_file = non_clobbering_path(target_images / source_file.name)
        shutil.move(str(source_file), str(target_file))
        asset_files.append(str(target_file))
    return asset_files


def decode_with_mineru(args: argparse.Namespace, source: str, output_path: Path, knowledge_root: Path | None) -> tuple[str, str, str, dict[str, Any]]:
    executable = shutil.which("mineru-open-api")
    if not executable:
        raise RuntimeError("mineru-open-api executable is not on PATH")
    if is_uri(source):
        raise ValueError("MinerU local decoder routing only supports local files; use MarkItDown --allow-uri or MinerU crawl explicitly for URLs")

    asset_root = Path(args.asset_root).expanduser().resolve() if args.asset_root else default_asset_root(output_path, knowledge_root)
    with TemporaryDirectory(prefix="llm-wiki-mineru-") as tmp_dir:
        tmp_output_path = Path(tmp_dir) / output_path.name
        command = [
            executable,
            "extract",
            source,
            "--format",
            "md",
            "--model",
            args.mineru_model,
            "--output",
            str(tmp_output_path),
            "--timeout",
            str(args.mineru_timeout),
        ]
        if args.language:
            command.extend(["--language", args.language])
        if args.pages:
            command.extend(["--pages", args.pages])
        if args.ocr:
            command.append("--ocr")
        if not args.formula:
            command.append("--formula=false")
        if not args.table:
            command.append("--table=false")

        completed = subprocess.run(
            command,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout).strip()
            raise RuntimeError(detail or "mineru-open-api extract failed")
        if not tmp_output_path.exists():
            raise RuntimeError(f"mineru-open-api did not create expected Markdown output: {tmp_output_path}")

        asset_files = move_mineru_assets(tmp_output_path, asset_root)
        markdown = tmp_output_path.read_text(encoding="utf-8")
        markdown = rewrite_mineru_asset_refs(markdown, output_path, asset_root)

    return (
        markdown,
        args.mineru_model,
        mineru_cli_version(executable) or "mineru-open-api",
        {
            "assetRoot": str(asset_root),
            "assetFiles": asset_files,
        },
    )


def decode(args: argparse.Namespace, source: str, output_path: Path, knowledge_root: Path | None) -> tuple[str, str, str, str, dict[str, Any]]:
    decoder = choose_decoder(args, source)
    if decoder == "mineru":
        markdown, backend, version, extra = decode_with_mineru(args, source, output_path, knowledge_root)
        return markdown, "mineru", backend, version, extra

    if args.backend in ("auto", "python"):
        try:
            markdown, version = decode_with_python(args, source)
            return markdown, "markitdown", "python", version, {}
        except ImportError:
            if args.backend == "python":
                raise RuntimeError("Python package 'markitdown' is not installed")
        except ModuleNotFoundError:
            if args.backend == "python":
                raise RuntimeError("Python package 'markitdown' is not installed")
        except Exception:
            if args.backend == "python":
                raise
            # Fall through to CLI only when the Python package is unavailable-like enough.
            if not shutil.which("markitdown"):
                raise

    markdown, version = decode_with_cli(args, source)
    return markdown, "markitdown", "cli", version, {}


def validate_source(args: argparse.Namespace) -> tuple[str, str | None]:
    source = args.source
    if source is None:
        raise ValueError("source is required unless --check is used")

    if is_uri(source):
        if not args.allow_uri:
            raise ValueError("URI input is disabled by default; pass --allow-uri only for trusted URI conversion")
        return source, None

    path = Path(source).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(f"source file does not exist: {path}")
    if not path.is_file():
        raise ValueError(f"source is not a file: {path}")
    return str(path), sha256_file(path)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Decode a document to Markdown with MarkItDown for llm-wiki ingest.",
    )
    parser.add_argument("source", nargs="?", help="Local source file. URI input requires --allow-uri.")
    parser.add_argument("-o", "--output", help="Markdown output path. Defaults to <source>.decoded.md.")
    parser.add_argument("--metadata-output", help="Metadata JSON path. Defaults to <output>.metadata.json, or <knowledgeRoot>/system/decoders/metadata when decoding into raw/inbox.")
    parser.add_argument("--decoder", choices=["auto", "mineru", "markitdown"], default="auto", help="Decoder router choice. Auto uses MinerU for high-fidelity document formats and MarkItDown for the rest.")
    parser.add_argument("--backend", choices=["auto", "python", "cli"], default="auto")
    parser.add_argument("--mineru-model", choices=["vlm", "pipeline"], default="vlm", help="MinerU model for routed high-fidelity formats. Default: vlm.")
    parser.add_argument("--mineru-timeout", type=int, default=900, help="MinerU extraction timeout in seconds.")
    parser.add_argument("--asset-root", help="Directory for MinerU extracted assets. Defaults to <knowledgeRoot>/system/decoders/assets/<output-name> or <output>.assets.")
    parser.add_argument("--allow-uri", action="store_true", help="Allow MarkItDown URI conversion for trusted inputs.")
    parser.add_argument("--use-plugins", action="store_true", help="Enable installed MarkItDown plugins.")
    parser.add_argument("--list-plugins", action="store_true", help="List installed MarkItDown plugins and exit.")
    parser.add_argument("--keep-data-uris", action="store_true", help="Keep data URIs in Markdown output.")
    parser.add_argument("--use-docintel", action="store_true", help="Use Azure Document Intelligence. Requires --endpoint.")
    parser.add_argument("--endpoint", help="Azure Document Intelligence endpoint.")
    parser.add_argument("--use-cu", "--use-content-understanding", action="store_true", dest="use_cu", help="Use Azure Content Understanding. Requires --cu-endpoint.")
    parser.add_argument("--cu-endpoint", help="Azure Content Understanding endpoint.")
    parser.add_argument("--cu-analyzer", help="Azure Content Understanding analyzer ID.")
    parser.add_argument("--cu-file-types", help="Comma-separated Content Understanding file types, for example pdf,jpeg,mp4.")
    parser.add_argument("-x", "--extension", help="Extension hint, for example pdf or .pdf.")
    parser.add_argument("-m", "--mime-type", help="MIME type hint.")
    parser.add_argument("-c", "--charset", help="Charset hint.")
    parser.add_argument("-l", "--language", default="ch", help="Document language hint for MinerU. Default: ch.")
    parser.add_argument("--pages", help="Page range for MinerU, e.g. '1-10,15'.")
    parser.add_argument("--ocr", action="store_true", help="Enable MinerU OCR flag for scanned documents when desired.")
    parser.add_argument("--formula", action=argparse.BooleanOptionalAction, default=True, help="Enable/disable MinerU formula recognition.")
    parser.add_argument("--table", action=argparse.BooleanOptionalAction, default=True, help="Enable/disable MinerU table recognition.")
    parser.add_argument("--title", help="Override title frontmatter for the decoded Markdown.")
    parser.add_argument("--source-label", help="Safe source label to write into frontmatter instead of an absolute path.")
    parser.add_argument("--include-absolute-paths", action="store_true", help="Include absolute source/archive paths in JSON metadata.")
    parser.add_argument("--knowledge-root", help="Knowledge root used for relative labels and original-document archiving.")
    parser.add_argument("--archive-original", action="store_true", help="After successful decode, move the original local file into raw/archive/document-decoder-originals.")
    parser.add_argument("--archive-root", help="Override original-document archive root. Defaults to <knowledgeRoot>/raw/archive/document-decoder-originals.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing output files.")
    parser.add_argument("--no-frontmatter", action="store_true", help="Do not add provenance frontmatter.")
    parser.add_argument("--check", action="store_true", help="Check MarkItDown availability and exit.")
    parser.add_argument("--json", action="store_true", help="Print structured JSON status.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    if args.check:
        payload = availability()
        if args.json:
            json_print(payload)
        else:
            print(payload["status"])
        return 0 if payload["status"] == "ok" else 1

    if args.list_plugins:
        payload = {"status": "ok", "plugins": list_plugins()}
        if args.json:
            json_print(payload)
        else:
            if payload["plugins"]:
                for plugin in payload["plugins"]:
                    print(f"{plugin['name']}\t{plugin['value']}")
            else:
                print("No MarkItDown plugins installed.")
        return 0

    decoded_at = iso_now()

    try:
        source, source_sha256 = validate_source(args)
        output_path = Path(args.output).expanduser().resolve() if args.output else default_output_path(source, args.allow_uri).resolve()
        knowledge_root = (
            Path(args.knowledge_root).expanduser().resolve()
            if args.knowledge_root
            else infer_knowledge_root_from_inbox(Path(source))
            if not is_uri(source)
            else None
        )
        metadata_path = (
            Path(args.metadata_output).expanduser().resolve()
            if args.metadata_output
            else default_metadata_path(output_path, knowledge_root)
        )

        if output_path.exists() and not args.overwrite:
            raise FileExistsError(f"output already exists: {output_path}")
        if metadata_path.exists() and not args.overwrite:
            raise FileExistsError(f"metadata output already exists: {metadata_path}")

        decoder_name = choose_decoder(args, source)
        markdown, decoder_name, backend, decoder_version, decode_extra = decode(args, source, output_path, knowledge_root)
        safe_source_label = args.source_label or path_label(source, knowledge_root)
        frontmatter = {
            "title": args.title or Path(source).name,
            "llm_wiki_decoded": "true",
            "source_label": safe_source_label,
            "source_sha256": source_sha256,
            "decoder": decoder_name,
            "decoder_backend": backend,
            "decoder_version": decoder_version,
            "decoded_at": decoded_at,
        }

        final_markdown = markdown if args.no_frontmatter else add_frontmatter(markdown, frontmatter)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        metadata_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(final_markdown, encoding="utf-8")
        archived_original_path = archive_original(args, source, source_sha256)
        archived_original_label = path_label(str(archived_original_path), knowledge_root) if archived_original_path else None

        metadata_payload = {
            "status": "ok",
            "source": safe_source_label,
            "sourceType": "uri" if is_uri(source) else "local-file",
            "sourceSha256": source_sha256,
            "output": path_label(str(output_path), knowledge_root),
            "metadataOutput": path_label(str(metadata_path), knowledge_root),
            "originalArchived": archived_original_path is not None,
            "originalArchivePath": archived_original_label,
            "decoder": decoder_name,
            "decoderBackend": backend,
            "decoderVersion": decoder_version,
            "decodedAt": decoded_at,
            "frontmatter": not args.no_frontmatter,
            "usedPlugins": bool(args.use_plugins),
            "bytesWritten": output_path.stat().st_size,
        }
        if decode_extra:
            asset_root = decode_extra.get("assetRoot")
            asset_files = decode_extra.get("assetFiles") or []
            if asset_root:
                metadata_payload["assetRoot"] = path_label(asset_root, knowledge_root)
            metadata_payload["assetFiles"] = [path_label(path, knowledge_root) for path in asset_files]
        if args.include_absolute_paths:
            metadata_payload["sourceAbsolutePath"] = source
            metadata_payload["outputAbsolutePath"] = str(output_path)
            metadata_payload["metadataOutputAbsolutePath"] = str(metadata_path)
            metadata_payload["originalArchiveAbsolutePath"] = str(archived_original_path) if archived_original_path else None
            if decode_extra.get("assetRoot"):
                metadata_payload["assetRootAbsolutePath"] = decode_extra["assetRoot"]
            if decode_extra.get("assetFiles"):
                metadata_payload["assetFileAbsolutePaths"] = decode_extra["assetFiles"]
        metadata_path.write_text(json.dumps(metadata_payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")

        if args.json:
            json_print(metadata_payload)
        else:
            print(str(output_path))
        return 0
    except Exception as exc:
        payload = {
            "status": "error",
            "decoder": getattr(args, "decoder", "auto"),
            "errorType": exc.__class__.__name__,
            "error": str(exc),
            "decodedAt": decoded_at,
        }
        if args.json:
            json_print(payload)
        else:
            print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
