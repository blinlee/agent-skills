#!/usr/bin/env python3
"""Decode a local document, local article HTML file, trusted article URL, or Bilibili video URL to Markdown.

High-fidelity document formats route to MinerU when available. Broad fallback
formats route to MarkItDown. Trusted Bilibili video URLs route to the built-in
Bilibili transcript decoder. Trusted article URLs and local saved article HTML
files route to the built-in article extractor.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import as_completed
from datetime import datetime, timezone
from importlib import metadata as importlib_metadata
from pathlib import Path
from tempfile import NamedTemporaryFile
from tempfile import TemporaryDirectory
from typing import Any
from urllib.parse import urlparse

from utils import relative_posix_path


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
ARTICLE_EXTENSIONS = {".html", ".htm"}
BILIBILI_VIDEO_PATH_PATTERNS = (
    re.compile(r"^/video/"),
    re.compile(r"^/bangumi/play/"),
    re.compile(r"^/medialist/play/"),
)
MINERU_DEFAULT_MAX_PAGES_PER_TASK = 200
MINERU_DEFAULT_CHUNK_CONCURRENCY = 10
MINERU_DEFAULT_CHUNK_RETRIES = 3
MINERU_DEFAULT_RETRY_DELAY_SECONDS = 10


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
    yt_dlp_cli = shutil.which("yt-dlp")
    ffmpeg_cli = shutil.which("ffmpeg")
    whisper_cli = shutil.which("whisper")
    opencc_cli = shutil.which("opencc")
    trans_cli = shutil.which("trans")
    try:
        import argostranslate  # noqa: F401

        argos_available = True
    except Exception:
        argos_available = False
    python_version = markitdown_python_version()
    markitdown_available = python_version is not None or markitdown_cli is not None
    mineru_available = mineru_cli is not None
    bilibili_available = yt_dlp_cli is not None
    try:
        import requests  # noqa: F401

        article_available = True
    except Exception:
        article_available = False
    return {
        "status": "ok" if markitdown_available or mineru_available or article_available else "missing",
        "python": {
            "executable": sys.executable,
            "version": sys.version.split()[0],
        },
        "uv": {
            "available": shutil.which("uv") is not None,
            "recommendedCommand": "uv run --python 3.13 --with 'markitdown[all]' python scripts/decode.py <source> --output <decoded.md> --json",
        },
        "router": {
            "mineruExtensions": sorted(MINERU_EXTENSIONS),
            "articleExtensions": sorted(ARTICLE_EXTENSIONS),
            "bilibiliDecoder": "bilibili",
            "bilibiliRouteForced": True,
            "fallbackDecoder": "markitdown",
            "uriDecoder": "article",
            "htmlDecoder": "article",
            "articleRouteForced": True,
        },
        "bilibili": {
            "available": bilibili_available,
            "requiredBins": {
                "yt-dlp": yt_dlp_cli,
            },
            "whisperFallbackBins": {
                "ffmpeg": ffmpeg_cli,
                "whisper": whisper_cli,
            },
            "optionalBins": {
                "opencc": opencc_cli,
            },
            "translationBackends": {
                "argos": argos_available,
                "trans": trans_cli,
            },
        },
        "article": {
            "available": article_available,
            "dependency": "requests",
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


def is_bilibili_video_url(source: str) -> bool:
    if not is_uri(source):
        return False
    parsed = urlparse(source)
    if parsed.scheme.lower() not in {"http", "https"}:
        return False
    host = parsed.netloc.lower().split("@")[-1].split(":")[0]
    path = parsed.path or ""
    if host == "b23.tv":
        return bool(path.strip("/"))
    if host.endswith("bilibili.tv"):
        return bool(path.strip("/"))
    if host.endswith("bilibili.com"):
        if host.startswith("api."):
            return False
        return any(pattern.search(path) for pattern in BILIBILI_VIDEO_PATH_PATTERNS)
    return False


def is_article_routed_source(source: str) -> bool:
    if is_uri(source):
        parsed = source.split(":", 1)[0].lower()
        return parsed in {"http", "https"}
    return source_extension(source) in ARTICLE_EXTENSIONS


def pdf_page_count(path: Path) -> int | None:
    try:
        import fitz

        doc = fitz.open(str(path))
        try:
            return int(doc.page_count)
        finally:
            doc.close()
    except Exception:
        pass

    try:
        from pypdf import PdfReader

        return len(PdfReader(str(path)).pages)
    except Exception:
        pass

    pdfinfo = shutil.which("pdfinfo")
    if pdfinfo:
        try:
            completed = subprocess.run(
                [pdfinfo, str(path)],
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            for line in completed.stdout.splitlines():
                if line.startswith("Pages:"):
                    return int(line.split(":", 1)[1].strip())
        except Exception:
            pass

    return None


def page_chunks(total_pages: int, chunk_size: int) -> list[tuple[int, int]]:
    return [(start, min(start + chunk_size - 1, total_pages)) for start in range(1, total_pages + 1, chunk_size)]


def choose_decoder(args: argparse.Namespace, source: str) -> str:
    if is_bilibili_video_url(source):
        return "bilibili"
    if is_article_routed_source(source):
        return "article"
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


def default_metadata_path(output_path: Path, knowledge_root: Path | None) -> Path:
    if knowledge_root is not None:
        return knowledge_root / "anything2md" / "metadata" / f"{output_path.name}.metadata.json"
    return output_path.with_name(f"{output_path.name}.metadata.json")


def archive_original(args: argparse.Namespace, source: str, source_sha256: str | None) -> Path | None:
    if not args.archive_original:
        return None
    if is_uri(source):
        raise ValueError("--archive-original only supports local files")
    if source_sha256 is None:
        raise ValueError("--archive-original requires a source sha256")

    source_path = Path(source).expanduser().resolve()
    knowledge_root = Path(args.knowledge_root).expanduser().resolve() if args.knowledge_root else None
    if knowledge_root is None and not args.archive_root:
        raise ValueError("--archive-original requires --knowledge-root or --archive-root")

    archive_root = Path(args.archive_root).expanduser().resolve() if args.archive_root else knowledge_root / "anything2md" / "archive" / "originals"
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
        return knowledge_root / "anything2md" / "assets" / safe_name
    return output_path.with_name(f"{output_path.name}.assets")


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


def run_mineru_extract(args: argparse.Namespace, executable: str, source: str, tmp_output_path: Path, pages: str | None = None) -> None:
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
    if pages:
        command.extend(["--pages", pages])
    if args.ocr:
        command.append("--ocr")
    if not args.formula:
        command.append("--formula=false")
    if not args.table:
        command.append("--table=false")

    last_error = ""
    for attempt in range(args.mineru_chunk_retries + 1):
        completed = subprocess.run(
            command,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if completed.returncode == 0:
            if not tmp_output_path.exists():
                raise RuntimeError(f"mineru-open-api did not create expected Markdown output: {tmp_output_path}")
            return

        last_error = (completed.stderr or completed.stdout).strip() or "mineru-open-api extract failed"
        if attempt >= args.mineru_chunk_retries:
            break
        delay = args.mineru_retry_delay * (2**attempt)
        time.sleep(delay)

    raise RuntimeError(last_error)


def extract_mineru_chunk(
    args: argparse.Namespace,
    executable: str,
    source: str,
    output_name: str,
    chunk_dir: Path,
    start: int,
    end: int,
) -> tuple[int, int, Path]:
    chunk_dir.mkdir(parents=True, exist_ok=True)
    tmp_output_path = chunk_dir / output_name
    run_mineru_extract(args, executable, source, tmp_output_path, pages=f"{start}-{end}")
    return start, end, tmp_output_path


def decode_with_mineru(args: argparse.Namespace, source: str, output_path: Path, knowledge_root: Path | None) -> tuple[str, str, str, dict[str, Any]]:
    executable = shutil.which("mineru-open-api")
    if not executable:
        raise RuntimeError("mineru-open-api executable is not on PATH")
    if is_uri(source):
        raise ValueError("MinerU local decoder routing only supports local files; use MarkItDown --allow-uri or MinerU crawl explicitly for URLs")
    if args.mineru_max_pages_per_task < 1:
        raise ValueError("--mineru-max-pages-per-task must be greater than 0")
    if args.mineru_chunk_concurrency < 1:
        raise ValueError("--mineru-chunk-concurrency must be greater than 0")
    if args.mineru_chunk_retries < 0:
        raise ValueError("--mineru-chunk-retries must be greater than or equal to 0")
    if args.mineru_retry_delay < 0:
        raise ValueError("--mineru-retry-delay must be greater than or equal to 0")

    asset_root = Path(args.asset_root).expanduser().resolve() if args.asset_root else default_asset_root(output_path, knowledge_root)
    source_path = Path(source)
    total_pages = pdf_page_count(source_path) if source_path.suffix.lower() == ".pdf" and not args.pages else None
    chunk_ranges: list[tuple[int, int]] = []
    if total_pages is not None and total_pages > args.mineru_max_pages_per_task:
        chunk_ranges = page_chunks(total_pages, args.mineru_max_pages_per_task)

    with TemporaryDirectory(prefix="anything2md-mineru-") as tmp_dir:
        tmp_root = Path(tmp_dir)
        if chunk_ranges:
            asset_files: list[str] = []
            chunk_outputs: dict[tuple[int, int], Path] = {}
            max_workers = min(args.mineru_chunk_concurrency, len(chunk_ranges))
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = {
                    executor.submit(
                        extract_mineru_chunk,
                        args,
                        executable,
                        source,
                        output_path.name,
                        tmp_root / f"pages-{start}-{end}",
                        start,
                        end,
                    ): (start, end)
                    for start, end in chunk_ranges
                }
                for future in as_completed(futures):
                    start, end = futures[future]
                    try:
                        completed_start, completed_end, tmp_output_path = future.result()
                    except Exception as exc:
                        raise RuntimeError(f"MinerU chunk {start}-{end} failed: {exc}") from exc
                    chunk_outputs[(completed_start, completed_end)] = tmp_output_path

            markdown_parts: list[str] = []
            for start, end in chunk_ranges:
                tmp_output_path = chunk_outputs[(start, end)]
                asset_files.extend(move_mineru_assets(tmp_output_path, asset_root))
                chunk_markdown = tmp_output_path.read_text(encoding="utf-8")
                markdown_parts.append(rewrite_mineru_asset_refs(chunk_markdown, output_path, asset_root).strip())
            markdown = "\n\n".join(part for part in markdown_parts if part)
        else:
            tmp_output_path = tmp_root / output_path.name
            run_mineru_extract(args, executable, source, tmp_output_path, pages=args.pages)
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
            "pageCount": total_pages,
            "chunked": bool(chunk_ranges),
            "chunkRanges": [f"{start}-{end}" for start, end in chunk_ranges],
            "maxPagesPerTask": args.mineru_max_pages_per_task,
            "chunkConcurrency": min(args.mineru_chunk_concurrency, len(chunk_ranges)) if chunk_ranges else None,
            "chunkRetries": args.mineru_chunk_retries if chunk_ranges else None,
            "retryDelaySeconds": args.mineru_retry_delay if chunk_ranges else None,
        },
    )


def decode_with_article(args: argparse.Namespace, source: str, output_path: Path, knowledge_root: Path | None) -> tuple[str, str, dict[str, Any]]:
    if is_uri(source) and source.split(":", 1)[0].lower() not in {"http", "https"}:
        raise ValueError("article decoder only supports http(s) URLs or local HTML article files")

    from article_extract import decode_article_url

    asset_root = Path(args.asset_root).expanduser().resolve() if args.asset_root else default_asset_root(output_path, knowledge_root)
    markdown, extra = decode_article_url(
        source=source,
        output_path=output_path,
        asset_root=asset_root,
        image_mode=args.article_images,
        timeout=args.article_timeout,
        save_html=args.article_save_html,
    )
    return markdown, "built-in", extra


def decode_with_bilibili(args: argparse.Namespace, source: str, output_path: Path) -> tuple[str, str, dict[str, Any]]:
    from bilibili_extract import decode_bilibili_url

    markdown, extra = decode_bilibili_url(
        source=source,
        output_path=output_path,
        cookie_file=args.bilibili_cookies,
        browser=args.bilibili_browser,
        sub_langs=args.bilibili_sub_langs,
        ai_langs=args.bilibili_ai_langs,
        whisper_model=args.bilibili_whisper_model,
        whisper_language=args.bilibili_whisper_language,
        no_whisper=args.bilibili_no_whisper,
        translation_backend=args.bilibili_translation_backend,
        timeout=args.bilibili_timeout,
    )
    return markdown, "built-in", extra


def decode(args: argparse.Namespace, source: str, output_path: Path, knowledge_root: Path | None) -> tuple[str, str, str, str, dict[str, Any]]:
    decoder = choose_decoder(args, source)
    if decoder == "mineru":
        markdown, backend, version, extra = decode_with_mineru(args, source, output_path, knowledge_root)
        return markdown, "mineru", backend, version, extra
    if decoder == "bilibili":
        markdown, backend, extra = decode_with_bilibili(args, source, output_path)
        return markdown, "bilibili", backend, "built-in", extra
    if decoder == "article":
        markdown, backend, extra = decode_with_article(args, source, output_path, knowledge_root)
        return markdown, "article", backend, "built-in", extra

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
        description="Decode a document, local article HTML file, trusted article URL, or Bilibili video URL to Markdown with routed decoders.",
    )
    parser.add_argument("source", nargs="?", help="Local source file. URI input requires --allow-uri.")
    parser.add_argument("-o", "--output", help="Markdown output path. Defaults to <source>.decoded.md.")
    parser.add_argument("--metadata-output", help="Metadata JSON path. Defaults to <output>.metadata.json, or <knowledgeRoot>/anything2md/metadata when --knowledge-root is provided.")
    parser.add_argument("--decoder", choices=["auto", "mineru", "article", "bilibili", "markitdown"], default="auto", help="Decoder router choice for non-forced sources. Trusted Bilibili video URLs always use Bilibili extraction; trusted http(s) article URLs and local HTML article files always use article extraction; other auto routes use MinerU or MarkItDown.")
    parser.add_argument("--backend", choices=["auto", "python", "cli"], default="auto")
    parser.add_argument("--mineru-model", choices=["vlm", "pipeline"], default="vlm", help="MinerU model for routed high-fidelity formats. Default: vlm.")
    parser.add_argument("--mineru-timeout", type=int, default=1800, help="MinerU extraction timeout per task in seconds.")
    parser.add_argument("--mineru-max-pages-per-task", type=int, default=MINERU_DEFAULT_MAX_PAGES_PER_TASK, help="Auto-split PDFs above this many pages for MinerU extraction. Default: 200.")
    parser.add_argument("--mineru-chunk-concurrency", type=int, default=MINERU_DEFAULT_CHUNK_CONCURRENCY, help="Parallel MinerU chunk jobs for auto-split PDFs. Default: 10.")
    parser.add_argument("--mineru-chunk-retries", type=int, default=MINERU_DEFAULT_CHUNK_RETRIES, help="Retries per MinerU chunk after failures such as rate limiting. Default: 3.")
    parser.add_argument("--mineru-retry-delay", type=float, default=MINERU_DEFAULT_RETRY_DELAY_SECONDS, help="Initial retry delay in seconds; later retries use exponential backoff. Default: 10.")
    parser.add_argument("--asset-root", help="Directory for MinerU/article extracted assets. Defaults to <knowledgeRoot>/anything2md/assets/<output-name> or <output>.assets.")
    parser.add_argument("--article-images", choices=["auto", "download", "remote", "none"], default="auto", help="Article image behavior. Auto downloads WeChat images and omits ordinary article images.")
    parser.add_argument("--article-timeout", type=int, default=30, help="Article URL fetch and image-download timeout in seconds. Default: 30.")
    parser.add_argument("--article-save-html", action="store_true", help="Save the extracted article HTML under the asset root.")
    parser.add_argument("--bilibili-cookies", help="Bilibili cookies.txt path. Used before browser cookie discovery.")
    parser.add_argument("--bilibili-browser", choices=["auto", "chrome", "chromium", "edge", "firefox", "none"], default="auto", help="Browser cookie source for Bilibili subtitles. Default: auto.")
    parser.add_argument("--bilibili-sub-langs", default="zh-CN,zh-TW,zh-Hans,zh,en,ja,ko,es,ar,pt,de,fr", help="Comma-separated human subtitle languages for Bilibili. Default prefers Chinese, then common languages.")
    parser.add_argument("--bilibili-ai-langs", default="ai-zh,ai-en,ai-ja", help="Comma-separated Bilibili AI subtitle languages. Default: ai-zh,ai-en,ai-ja.")
    parser.add_argument("--bilibili-whisper-model", default="medium", help="Whisper model for Bilibili audio fallback. Default: medium.")
    parser.add_argument("--bilibili-whisper-language", default="Chinese", help="Whisper language for Bilibili audio fallback. Default: Chinese.")
    parser.add_argument("--bilibili-no-whisper", action="store_true", help="Disable Whisper fallback when Bilibili subtitles are unavailable.")
    parser.add_argument("--bilibili-translation-backend", choices=["auto", "argos", "trans", "none"], default="auto", help="Translate non-Chinese Bilibili subtitles to Chinese when no Chinese subtitle is available. Default: auto.")
    parser.add_argument("--bilibili-timeout", type=int, default=1800, help="Bilibili yt-dlp and Whisper timeout per step in seconds. Default: 1800.")
    parser.add_argument("--allow-uri", action="store_true", help="Allow trusted URI conversion. Bilibili video URLs route to the built-in Bilibili decoder; other HTTP(S) URLs route to the built-in article extractor; local HTML article files do not require this flag.")
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
    parser.add_argument("--profile", choices=["auto", "generic", "archive"], default="auto", help="Output profile. Auto uses archive when knowledge-root/archive flags are present, otherwise generic.")
    parser.add_argument("--title", help="Override title frontmatter for the decoded Markdown.")
    parser.add_argument("--source-label", help="Safe source label to write into frontmatter instead of an absolute path.")
    parser.add_argument("--include-absolute-paths", action="store_true", help="Include absolute source/archive paths in JSON metadata.")
    parser.add_argument("--knowledge-root", help="Knowledge root used for relative labels and original-document archiving.")
    parser.add_argument("--archive-original", action="store_true", help="After successful decode, move the original local file into the configured archive root.")
    parser.add_argument("--archive-root", help="Override original-document archive root. Defaults to <knowledgeRoot>/anything2md/archive/originals.")
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
    attempted_decoder = getattr(args, "decoder", "auto")

    try:
        source, source_sha256 = validate_source(args)
        attempted_decoder = choose_decoder(args, source)
        output_path = Path(args.output).expanduser().resolve() if args.output else default_output_path(source, args.allow_uri).resolve()
        knowledge_root = Path(args.knowledge_root).expanduser().resolve() if args.knowledge_root else None
        metadata_path = (
            Path(args.metadata_output).expanduser().resolve()
            if args.metadata_output
            else default_metadata_path(output_path, knowledge_root)
        )

        if output_path.exists() and not args.overwrite:
            raise FileExistsError(f"output already exists: {output_path}")
        if metadata_path.exists() and not args.overwrite:
            raise FileExistsError(f"metadata output already exists: {metadata_path}")

        markdown, decoder_name, backend, decoder_version, decode_extra = decode(args, source, output_path, knowledge_root)
        safe_source_label = args.source_label or path_label(source, knowledge_root)
        effective_profile = args.profile
        if effective_profile == "auto":
            effective_profile = "archive" if args.knowledge_root or args.archive_original or args.archive_root else "generic"
        frontmatter = {
            "title": args.title or decode_extra.get("articleTitle") or decode_extra.get("bilibiliTitle") or Path(source).name,
            "anything2md_decoded": "true",
            "anything2md_profile": effective_profile,
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
            "profile": effective_profile,
            "profileRequested": args.profile,
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
            for key in ("pageCount", "chunked", "chunkRanges", "maxPagesPerTask", "chunkConcurrency", "chunkRetries", "retryDelaySeconds"):
                if key in decode_extra and decode_extra[key] is not None:
                    metadata_payload[key] = decode_extra[key]
            for key in (
                "articleTitle",
                "articleAuthor",
                "articleSiteName",
                "articleFinalUrl",
                "articleIsWeChat",
                "articleExtractionMethod",
                "articleImageMode",
                "articleImagesDownloaded",
                "articleImageDownloadFailures",
                "articleFailedImageUrls",
                "articleFormatSummary",
                "cleanHtmlPreviewLength",
                "bilibiliTitle",
                "bilibiliUploader",
                "bilibiliUploadDate",
                "bilibiliDurationSeconds",
                "bilibiliDuration",
                "bilibiliVideoId",
                "bilibiliWebpageUrl",
                "bilibiliTranscriptSource",
                "bilibiliSubtitleLanguage",
                "bilibiliTranslatedToChinese",
                "bilibiliTranslationBackend",
                "bilibiliOriginalTranscriptSource",
                "bilibiliOriginalSubtitleLanguage",
                "bilibiliOriginalTranscriptChars",
                "bilibiliCookieSource",
                "bilibiliWhisperModel",
                "bilibiliTranscriptChars",
            ):
                if key in decode_extra and decode_extra[key] is not None:
                    metadata_payload[key] = decode_extra[key]
        if args.include_absolute_paths:
            metadata_payload["sourceAbsolutePath"] = source
            metadata_payload["outputAbsolutePath"] = str(output_path)
            metadata_payload["metadataOutputAbsolutePath"] = str(metadata_path)
            metadata_payload["originalArchiveAbsolutePath"] = str(archived_original_path) if archived_original_path else None
            if decode_extra.get("assetRoot"):
                metadata_payload["assetRootAbsolutePath"] = decode_extra["assetRoot"]
            if decode_extra.get("assetFiles"):
                metadata_payload["assetFileAbsolutePaths"] = decode_extra["assetFiles"]
            if decode_extra.get("bilibiliCookieAbsolutePath"):
                metadata_payload["bilibiliCookieAbsolutePath"] = decode_extra["bilibiliCookieAbsolutePath"]
        metadata_path.write_text(json.dumps(metadata_payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")

        if args.json:
            json_print(metadata_payload)
        else:
            print(str(output_path))
        return 0
    except Exception as exc:
        payload = {
            "status": "error",
            "decoder": attempted_decoder,
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
