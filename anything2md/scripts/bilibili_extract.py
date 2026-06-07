#!/usr/bin/env python3
"""Bilibili video extraction for Chinese Markdown transcripts."""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any


DEFAULT_SUB_LANGS = "zh-CN,zh-TW,zh-Hans,zh,en,ja,ko,es,ar,pt,de,fr"
DEFAULT_AI_LANGS = "ai-zh,ai-en,ai-ja"


@dataclass
class CookieSelection:
    args: list[str]
    source: str | None
    absolute_path: str | None = None


@dataclass(frozen=True)
class SubtitleAttempt:
    langs: str
    auto_subs: bool
    requires_translation: bool


def run_command(command: list[str], timeout: int | None = None, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=False,
        input=input_text,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )


def run_ytdlp_with_cookie_retry(
    yt_dlp: str,
    cookie_args: list[str],
    tail_args: list[str],
    timeout: int,
) -> tuple[subprocess.CompletedProcess[str], bool]:
    if cookie_args:
        completed = run_command([yt_dlp, *cookie_args, *tail_args], timeout=timeout)
        if completed.returncode == 0:
            return completed, True
    completed = run_command([yt_dlp, *tail_args], timeout=timeout)
    return completed, False


def require_executable(name: str) -> str:
    executable = shutil.which(name)
    if not executable:
        raise RuntimeError(f"{name} executable is not on PATH")
    return executable


def split_langs(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def normalize_lang(value: str | None) -> str:
    lang = (value or "").strip().lower().replace("_", "-")
    if lang.startswith("ai-"):
        lang = lang[3:]
    return lang


def is_chinese_lang(value: str | None) -> bool:
    lang = normalize_lang(value)
    return lang == "zh" or lang.startswith("zh-")


def partition_chinese_langs(value: str) -> tuple[str, str]:
    chinese: list[str] = []
    other: list[str] = []
    for lang in split_langs(value):
        if is_chinese_lang(lang):
            chinese.append(lang)
        else:
            other.append(lang)
    return ",".join(chinese), ",".join(other)


def format_duration(seconds: int | float | None) -> str:
    if seconds is None:
        return "未知"
    try:
        total = int(seconds)
    except (TypeError, ValueError):
        return "未知"
    return f"{total // 60}分{total % 60}秒"


def format_upload_date(value: str | None) -> str:
    if not value:
        return "未知"
    if re.fullmatch(r"\d{8}", value):
        return f"{value[:4]}-{value[4:6]}-{value[6:8]}"
    return value


def markdown_escape_text(value: str | None) -> str:
    value = value or "未知"
    return html.escape(value, quote=False)


def clean_subtitle_text(text: str) -> str:
    text = text.replace("\ufeff", "")
    lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.upper() == "WEBVTT" or line.startswith("NOTE "):
            continue
        if re.fullmatch(r"\d+", line):
            continue
        if re.search(r"\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,.]\d{3}", line):
            continue
        line = re.sub(r"<[^>]+>", "", line)
        line = html.unescape(line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines).strip()


def simplify_if_possible(text: str) -> str:
    opencc = shutil.which("opencc")
    if not opencc:
        return text
    try:
        process = subprocess.run(
            [opencc, "-c", "tw2s"],
            check=False,
            input=text,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=120,
        )
    except Exception:
        return text
    return process.stdout.strip() or text


def discover_cookie_args(explicit_cookie_file: str | None, browser: str, output_dir: Path | None) -> CookieSelection:
    if explicit_cookie_file:
        path = Path(explicit_cookie_file).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"Bilibili cookie file does not exist: {path}")
        return CookieSelection(["--cookies", str(path)], "file", str(path))

    script_root = Path(__file__).resolve().parent.parent
    candidate_files = [script_root / "cookies.txt"]
    if output_dir is not None:
        candidate_files.append(output_dir / "cookies.txt")
    for path in candidate_files:
        if path.exists() and path.is_file():
            return CookieSelection(["--cookies", str(path)], "file", str(path))

    if browser == "none":
        return CookieSelection([], "none")

    browser_arg = discover_browser_cookie_arg(browser)
    if browser_arg:
        return CookieSelection(["--cookies-from-browser", browser_arg], "browser")

    return CookieSelection([], "none")


def discover_browser_cookie_arg(browser: str) -> str | None:
    if browser != "auto":
        return browser

    home = Path.home()
    if sys.platform == "darwin":
        candidates = [
            ("chrome", home / "Library/Application Support/Google/Chrome"),
            ("chromium", home / "Library/Application Support/Chromium"),
            ("edge", home / "Library/Application Support/Microsoft Edge"),
            ("firefox", home / "Library/Application Support/Firefox"),
        ]
        for name, path in candidates:
            if path.exists():
                return name
        return None

    wsl_chromium = home / "snap/chromium/common/chromium"
    if wsl_chromium.exists():
        return f"chromium:{wsl_chromium}"

    windows_users = Path("/mnt/c/Users")
    if windows_users.exists():
        for user_path in windows_users.iterdir():
            if user_path.name in {"Public", "Default", "All Users"}:
                continue
            edge_path = user_path / "AppData/Local/Microsoft/Edge/User Data"
            if edge_path.exists():
                return f"edge:C:/Users/{user_path.name}/AppData/Local/Microsoft/Edge/User Data"

    return None


def load_video_info(url: str, cookie_args: list[str], timeout: int) -> dict[str, Any]:
    yt_dlp = require_executable("yt-dlp")
    completed, _used_cookies = run_ytdlp_with_cookie_retry(yt_dlp, cookie_args, ["--dump-json", url], timeout)
    if completed.returncode != 0 or not completed.stdout.strip():
        raise RuntimeError((completed.stderr or completed.stdout).strip() or "yt-dlp could not read Bilibili video metadata")
    first_line = completed.stdout.splitlines()[0]
    return json.loads(first_line)


def download_subtitle(
    url: str,
    cookie_args: list[str],
    output_dir: Path,
    langs: str,
    auto_subs: bool,
    timeout: int,
) -> tuple[str, str | None]:
    yt_dlp = require_executable("yt-dlp")
    prefix = "bilibili_ai_subtitle" if auto_subs else "bilibili_subtitle"
    command = [
        "--skip-download",
        "--write-subs",
    ]
    if auto_subs:
        command.append("--write-auto-subs")
    command.extend([
        "--sub-langs",
        langs,
        "--convert-subs",
        "srt",
        "-o",
        str(output_dir / f"{prefix}.%(ext)s"),
        url,
    ])
    completed, _used_cookies = run_ytdlp_with_cookie_retry(yt_dlp, cookie_args, command, timeout)
    if completed.returncode != 0:
        return "", None

    subtitle_files = [
        path
        for path in output_dir.iterdir()
        if path.is_file() and path.name.startswith(prefix) and path.suffix.lower() in {".srt", ".vtt", ".ass", ".txt"}
    ]
    for subtitle_file in order_subtitle_files_by_language(subtitle_files, langs):
        text = clean_subtitle_text(subtitle_file.read_text(encoding="utf-8", errors="replace"))
        if text:
            return text, infer_subtitle_language(subtitle_file.name, langs)
    return "", None


def order_subtitle_files_by_language(subtitle_files: list[Path], langs: str) -> list[Path]:
    ordered: list[Path] = []
    seen: set[Path] = set()
    for lang in split_langs(langs):
        matches = sorted(path for path in subtitle_files if lang in path.name)
        for match in matches:
            ordered.append(match)
            seen.add(match)
    ordered.extend(sorted(path for path in subtitle_files if path not in seen))
    return ordered


def infer_subtitle_language(file_name: str, fallback_langs: str) -> str | None:
    for lang in split_langs(fallback_langs):
        if lang in file_name:
            return lang
    langs = split_langs(fallback_langs)
    return langs[0] if langs else None


def subtitle_source_label(auto_subs: bool, language: str | None) -> str:
    source = "B站AI字幕" if auto_subs else "B站CC字幕"
    return f"{source} ({language or 'unknown'})"


def subtitle_attempts(sub_langs: str, ai_langs: str) -> list[SubtitleAttempt]:
    chinese_sub_langs, other_sub_langs = partition_chinese_langs(sub_langs)
    chinese_ai_langs, other_ai_langs = partition_chinese_langs(ai_langs)
    candidates = [
        SubtitleAttempt(chinese_sub_langs, False, False),
        SubtitleAttempt(chinese_ai_langs, True, False),
        SubtitleAttempt(other_sub_langs, False, True),
        SubtitleAttempt(other_ai_langs, True, True),
    ]
    return [candidate for candidate in candidates if candidate.langs]


def choose_subtitle_transcript(
    source: str,
    cookie_args: list[str],
    output_dir: Path,
    sub_langs: str,
    ai_langs: str,
    timeout: int,
) -> tuple[str, str, str | None, bool]:
    for attempt in subtitle_attempts(sub_langs, ai_langs):
        transcript, language = download_subtitle(
            source,
            cookie_args,
            output_dir,
            attempt.langs,
            auto_subs=attempt.auto_subs,
            timeout=timeout,
        )
        if transcript:
            return transcript, subtitle_source_label(attempt.auto_subs, language), language, attempt.requires_translation
    return "", "", None, False


def translate_to_chinese(text: str, source_lang: str | None, backend: str, timeout: int) -> tuple[str, str]:
    if backend == "none":
        raise RuntimeError("No Chinese Bilibili subtitles were available and Chinese translation is disabled")

    errors: list[str] = []
    if backend in {"auto", "argos"}:
        try:
            translated = translate_to_chinese_with_argos(text, source_lang)
            if translated:
                return translated, "argos"
        except Exception as exc:
            errors.append(f"argos: {exc}")

    if backend in {"auto", "trans"}:
        try:
            translated = translate_to_chinese_with_trans(text, timeout)
            if translated:
                return translated, "trans"
        except Exception as exc:
            errors.append(f"trans: {exc}")

    detail = "; ".join(errors) if errors else f"backend {backend} is unavailable"
    raise RuntimeError(f"No Chinese Bilibili subtitles were available and translation to Chinese failed: {detail}")


def translate_to_chinese_with_trans(text: str, timeout: int) -> str | None:
    trans = shutil.which("trans")
    if not trans:
        return None
    completed = run_command([trans, "-b", "-no-ansi", ":zh-CN"], timeout=timeout, input_text=text)
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout).strip() or "translate-shell failed")
    translated = completed.stdout.strip()
    return translated or None


def translate_to_chinese_with_argos(text: str, source_lang: str | None) -> str | None:
    try:
        from argostranslate import translate
    except Exception:
        return None

    source_code = normalize_lang(source_lang).split("-", 1)[0] or "en"
    target_code = "zh"
    installed_languages = translate.get_installed_languages()
    source = next((lang for lang in installed_languages if lang.code.lower() == source_code), None)
    target = next((lang for lang in installed_languages if lang.code.lower() == target_code), None)
    if source is None or target is None:
        return None
    translation = source.get_translation(target)
    translated = translation.translate(text).strip()
    return translated or None


def transcribe_with_whisper(
    url: str,
    cookie_args: list[str],
    output_dir: Path,
    model: str,
    language: str,
    timeout: int,
) -> str:
    yt_dlp = require_executable("yt-dlp")
    require_executable("ffmpeg")
    whisper = require_executable("whisper")

    audio_template = str(output_dir / "bilibili_audio.%(ext)s")
    download, _used_cookies = run_ytdlp_with_cookie_retry(
        yt_dlp,
        cookie_args,
        ["-x", "--audio-format", "mp3", "-o", audio_template, url],
        timeout,
    )
    if download.returncode != 0:
        raise RuntimeError((download.stderr or download.stdout).strip() or "yt-dlp could not download Bilibili audio")

    audio_files = sorted(
        path
        for path in output_dir.iterdir()
        if path.is_file() and path.name.startswith("bilibili_audio") and path.suffix.lower() in {".mp3", ".m4a", ".wav", ".webm"}
    )
    if not audio_files:
        raise RuntimeError("yt-dlp did not create an audio file for Whisper")

    completed = run_command(
        [
            whisper,
            str(audio_files[0]),
            "--model",
            model,
            "--language",
            language,
            "--output_format",
            "txt",
            "--output_dir",
            str(output_dir),
        ],
        timeout=timeout,
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout).strip() or "Whisper transcription failed")

    transcript_files = sorted(path for path in output_dir.iterdir() if path.is_file() and path.suffix.lower() == ".txt")
    for transcript_file in transcript_files:
        text = transcript_file.read_text(encoding="utf-8", errors="replace").strip()
        if text:
            return text
    raise RuntimeError("Whisper did not create a transcript text file")


def build_markdown(info: dict[str, Any], source_url: str, transcript: str, transcript_source: str, transcript_time: str) -> str:
    title = str(info.get("title") or "未知标题")
    uploader = str(info.get("uploader") or "未知作者")
    upload_date = format_upload_date(str(info.get("upload_date") or ""))
    duration = format_duration(info.get("duration"))
    video_id = str(info.get("id") or "")
    webpage_url = str(info.get("webpage_url") or source_url)

    return "\n".join(
        [
            f"# {markdown_escape_text(title)}",
            "",
            f"- 来源: Bilibili",
            f"- 链接: {markdown_escape_text(webpage_url)}",
            f"- UP主: {markdown_escape_text(uploader)}",
            f"- 发布时间: {markdown_escape_text(upload_date)}",
            f"- 视频时长: {markdown_escape_text(duration)}",
            f"- 视频ID: {markdown_escape_text(video_id)}",
            f"- 转录来源: {markdown_escape_text(transcript_source)}",
            f"- 转录时间: {markdown_escape_text(transcript_time)}",
            "",
            "## 完整转录",
            "",
            transcript.strip(),
            "",
        ]
    )


def decode_bilibili_url(
    source: str,
    output_path: Path,
    cookie_file: str | None,
    browser: str,
    sub_langs: str,
    ai_langs: str,
    whisper_model: str,
    whisper_language: str,
    no_whisper: bool,
    translation_backend: str,
    timeout: int,
) -> tuple[str, dict[str, Any]]:
    output_dir = output_path.parent
    cookies = discover_cookie_args(cookie_file, browser, output_dir)
    info = load_video_info(source, cookies.args, timeout)

    transcript = ""
    transcript_source = ""
    subtitle_language: str | None = None
    translated = False
    translation_backend_used: str | None = None
    original_transcript_source: str | None = None
    original_subtitle_language: str | None = None
    original_transcript_chars: int | None = None

    with TemporaryDirectory(prefix="anything2md-bilibili-") as tmp_dir:
        tmp_root = Path(tmp_dir)
        transcript, transcript_source, subtitle_language, requires_translation = choose_subtitle_transcript(
            source,
            cookies.args,
            tmp_root,
            sub_langs,
            ai_langs,
            timeout,
        )
        if transcript and requires_translation:
            original_transcript = transcript
            original_transcript_source = transcript_source
            original_subtitle_language = subtitle_language
            original_transcript_chars = len(original_transcript)
            transcript, translation_backend_used = translate_to_chinese(
                original_transcript,
                subtitle_language,
                translation_backend,
                timeout,
            )
            translated = True
            subtitle_language = "zh-CN"
            transcript_source = f"{original_transcript_source} -> 中文翻译 ({translation_backend_used})"
        if not transcript:
            if no_whisper:
                raise RuntimeError("No Bilibili subtitles were available and Whisper fallback is disabled")
            transcript = transcribe_with_whisper(
                source,
                cookies.args,
                tmp_root,
                model=whisper_model,
                language=whisper_language,
                timeout=timeout,
            )
            transcript_source = f"Whisper {whisper_model}"

    transcript = simplify_if_possible(transcript)
    transcript_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    markdown = build_markdown(info, source, transcript, transcript_source, transcript_time)
    webpage_url = str(info.get("webpage_url") or source)
    upload_date = format_upload_date(str(info.get("upload_date") or ""))

    extra = {
        "bilibiliTitle": info.get("title") or "未知标题",
        "bilibiliUploader": info.get("uploader") or "未知作者",
        "bilibiliUploadDate": upload_date,
        "bilibiliDurationSeconds": info.get("duration"),
        "bilibiliDuration": format_duration(info.get("duration")),
        "bilibiliVideoId": info.get("id") or None,
        "bilibiliWebpageUrl": webpage_url,
        "bilibiliTranscriptSource": transcript_source,
        "bilibiliSubtitleLanguage": subtitle_language,
        "bilibiliTranslatedToChinese": translated,
        "bilibiliTranslationBackend": translation_backend_used,
        "bilibiliOriginalTranscriptSource": original_transcript_source,
        "bilibiliOriginalSubtitleLanguage": original_subtitle_language,
        "bilibiliOriginalTranscriptChars": original_transcript_chars,
        "bilibiliCookieSource": cookies.source,
        "bilibiliCookieAbsolutePath": cookies.absolute_path,
        "bilibiliWhisperModel": whisper_model if transcript_source.startswith("Whisper") else None,
        "bilibiliTranscriptChars": len(transcript),
        "assetFiles": [],
    }
    return markdown, extra


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert a Bilibili video URL to a Markdown transcript.")
    parser.add_argument("url", help="Trusted Bilibili video URL")
    parser.add_argument("--output", required=True, help="Markdown output path")
    parser.add_argument("--bilibili-cookies", help="Bilibili cookies.txt path")
    parser.add_argument("--bilibili-browser", choices=["auto", "chrome", "chromium", "edge", "firefox", "none"], default="auto")
    parser.add_argument("--bilibili-sub-langs", default=DEFAULT_SUB_LANGS)
    parser.add_argument("--bilibili-ai-langs", default=DEFAULT_AI_LANGS)
    parser.add_argument("--bilibili-whisper-model", default="medium")
    parser.add_argument("--bilibili-whisper-language", default="Chinese")
    parser.add_argument("--bilibili-no-whisper", action="store_true")
    parser.add_argument("--bilibili-translation-backend", choices=["auto", "argos", "trans", "none"], default="auto")
    parser.add_argument("--bilibili-timeout", type=int, default=1800)
    parser.add_argument("--json", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_path = Path(args.output).expanduser().resolve()
    try:
        markdown, extra = decode_bilibili_url(
            source=args.url,
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
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(markdown, encoding="utf-8")
        safe_extra = {key: value for key, value in extra.items() if key != "bilibiliCookieAbsolutePath"}
        payload = {"status": "ok", "output": str(output_path), **safe_extra}
        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
        else:
            print(str(output_path))
        return 0
    except Exception as exc:
        payload = {"status": "error", "errorType": exc.__class__.__name__, "error": str(exc)}
        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
        else:
            print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
