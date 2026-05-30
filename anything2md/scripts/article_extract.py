#!/usr/bin/env python3
"""Reference-aligned article extraction for anything2md.

The WeChat branch is adapted from the tested
`wechat-article-to-markdown-skill/scripts/wechat_article_pipeline.py` workflow.
The generic branch follows the tested knowledge-collector article rule: fetch a
normal article page, keep core正文 only, and remove page chrome/noise.
"""

from __future__ import annotations

import argparse
import html
import os
import re
import sys
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict
from typing import List
from typing import Optional
from urllib.parse import urljoin
from urllib.parse import urlparse

import requests


USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

INVALID_LINK_PATTERNS = (
    "javascript:",
    "#",
)

WECHAT_NOISE_PATTERNS = [
    re.compile(r"^预览时标签不可点$"),
    re.compile(r"^继续滑动看下一个$"),
    re.compile(r"^微信扫一扫关注该公众号$"),
    re.compile(r"^轻触阅读原文$"),
    re.compile(r"^原创.*在小说阅读器中沉浸阅读$"),
    re.compile(r"^以下文章来源于.*$"),
    re.compile(r"^作者 \| .*$"),
    re.compile(r"^喜欢此内容的人还喜欢$"),
]

GENERIC_NOISE_PATTERNS = [
    re.compile(r"^(advertisement|subscribe|share this|related posts?)$", re.IGNORECASE),
    re.compile(r"^(广告|相关推荐|相关阅读|分享到|订阅|评论)$"),
]


@dataclass
class ArticleData:
    title: str
    author: str
    account_name: str
    content_html: str
    original_url: str
    is_wechat: bool


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*]', "", name)
    name = re.sub(r"\s+", "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    return (name[:100] or "untitled").strip("_") or "untitled"


def strip_tags(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    return html.unescape(value).strip()


def normalize_inline_text(value: str) -> str:
    value = value.replace("\xa0", " ")
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def is_wechat_url(url: str) -> bool:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    return parsed.scheme in {"http", "https"} and (
        "mp.weixin.qq.com" in host or "weixin.qq.com" in host
    )


def validate_article_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def build_headers(is_wechat: bool) -> Dict[str, str]:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Upgrade-Insecure-Requests": "1",
    }
    if is_wechat:
        headers["Referer"] = "https://mp.weixin.qq.com/"
    return headers


def fetch_html(url: str, timeout: int) -> tuple[str, str]:
    if not validate_article_url(url):
        raise ValueError("article decoder only supports http(s) article URLs")
    session = requests.Session()
    session.headers.update(build_headers(is_wechat_url(url)))
    response = session.get(url, timeout=timeout, allow_redirects=True)
    response.raise_for_status()
    if response.encoding in (None, "ISO-8859-1"):
        response.encoding = "utf-8"
    return response.text, response.url


class ArticleExtractor:
    def extract(self, source_html: str, original_url: str, final_url: str) -> ArticleData:
        if is_wechat_url(original_url) or is_wechat_url(final_url) or 'id="js_content"' in source_html or "rich_media_content" in source_html:
            return self.extract_wechat(source_html, original_url)
        return self.extract_generic(source_html, original_url)

    def extract_wechat(self, source_html: str, original_url: str) -> ArticleData:
        title = self._extract_first_match(
            source_html,
            [
                r'id="activity-name"[^>]*>\s*<span[^>]*>(.*?)</span>',
                r'id="activity-name"[^>]*>(.*?)</h1>',
                r'class="rich_media_title[^"]*"[^>]*>(.*?)</h1>',
                r"<h1[^>]*>(.*?)</h1>",
                r"<title>(.*?)</title>",
            ],
        ) or "未命名文章"

        author = self._extract_first_match(
            source_html,
            [
                r'id="js_author_name"[^>]*>(.*?)</span>',
                r'id="js_name"[^>]*>(.*?)</a>',
                r'class="profile_nickname[^"]*"[^>]*>(.*?)</span>',
            ],
        ) or ""

        account_name = self._extract_first_match(
            source_html,
            [
                r'class="profile_nickname[^"]*"[^>]*>(.*?)</span>',
                r'id="js_name"[^>]*>(.*?)</a>',
            ],
        ) or author

        content_html = self._extract_wechat_content_html(source_html)
        if self._looks_like_wechat_captcha(source_html, content_html):
            raise RuntimeError("WeChat returned a verification page instead of the article body")
        content_html = self._clean_html(content_html)

        return ArticleData(
            title=title,
            author=author,
            account_name=account_name,
            content_html=content_html,
            original_url=original_url,
            is_wechat=True,
        )

    def extract_generic(self, source_html: str, original_url: str) -> ArticleData:
        title = self._extract_first_match(
            source_html,
            [
                r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']',
                r'<meta[^>]+name=["\']twitter:title["\'][^>]+content=["\']([^"\']+)["\']',
                r"<h1[^>]*>(.*?)</h1>",
                r"<title>(.*?)</title>",
            ],
        ) or "Untitled Article"

        author = self._extract_first_match(
            source_html,
            [
                r'<meta[^>]+name=["\']author["\'][^>]+content=["\']([^"\']+)["\']',
                r'<meta[^>]+property=["\']article:author["\'][^>]+content=["\']([^"\']+)["\']',
                r'class=["\'][^"\']*(?:author|byline)[^"\']*["\'][^>]*>(.*?)</[^>]+>',
            ],
        ) or ""

        site_name = self._extract_first_match(
            source_html,
            [
                r'<meta[^>]+property=["\']og:site_name["\'][^>]+content=["\']([^"\']+)["\']',
            ],
        ) or ""

        content_html = self._extract_generic_content_html(source_html)
        content_html = self._clean_html(content_html)

        return ArticleData(
            title=title,
            author=author,
            account_name=site_name,
            content_html=content_html,
            original_url=original_url,
            is_wechat=False,
        )

    def _extract_first_match(self, content: str, patterns: List[str]) -> str:
        for pattern in patterns:
            match = re.search(pattern, content, re.DOTALL | re.IGNORECASE)
            if match:
                value = strip_tags(match.group(1))
                value = re.sub(r"\s*[-_|]\s*微信.*$", "", value)
                if value:
                    return value
        return ""

    def _extract_wechat_content_html(self, source_html: str) -> str:
        patterns = [
            r'id="img-content"[^>]*>(.*?)<div[^>]*id="js_pc_qr_code"',
            r'id="js_content"[^>]*>(.*?)</div>\s*</div>\s*<div[^>]*class="rich_media_tool',
            r'id="js_content"[^>]*>(.*?)</div>\s*</div>\s*</div>',
            r'id="js_content"[^>]*>(.*?)</div>',
            r'id="img-content"[^>]*>(.*?)$',
            r"<body[^>]*>(.*?)</body>",
        ]
        for pattern in patterns:
            match = re.search(pattern, source_html, re.DOTALL | re.IGNORECASE)
            if match:
                return match.group(1)
        return ""

    def _extract_generic_content_html(self, source_html: str) -> str:
        parser = GenericArticleHTMLExtractor()
        parser.feed(source_html)
        balanced_candidate = parser.best_candidate()
        if balanced_candidate and len(strip_tags(balanced_candidate)) >= 80:
            return balanced_candidate

        patterns = [
            r"<article[^>]*>(.*?)</article>",
            r"<main[^>]*>(.*?)</main>",
            r"<body[^>]*>(.*?)</body>",
        ]
        for pattern in patterns:
            matches = re.findall(pattern, source_html, re.DOTALL | re.IGNORECASE)
            if not matches:
                continue
            candidate = max((match if isinstance(match, str) else match[-1] for match in matches), key=lambda item: len(strip_tags(item)))
            if len(strip_tags(candidate)) >= 80:
                return candidate
        raise RuntimeError("could not locate a normal article body in the fetched HTML")

    def _clean_html(self, content_html: str) -> str:
        content_html = re.sub(r"<script[^>]*>.*?</script>", "", content_html, flags=re.DOTALL | re.IGNORECASE)
        content_html = re.sub(r"<style[^>]*>.*?</style>", "", content_html, flags=re.DOTALL | re.IGNORECASE)
        content_html = re.sub(r"<!--.*?-->", "", content_html, flags=re.DOTALL)
        content_html = re.sub(r"<(?:nav|footer|header|aside)[^>]*>.*?</(?:nav|footer|header|aside)>", "", content_html, flags=re.DOTALL | re.IGNORECASE)

        def replace_lazy_image(match: re.Match[str]) -> str:
            image_tag = match.group(0)
            source_match = re.search(
                r'(?:data-src|data-original|data-backsrc|src)=["\']([^"\']+)["\']',
                image_tag,
                flags=re.IGNORECASE,
            )
            if not source_match:
                return image_tag
            src = html.unescape(source_match.group(1))
            if " src=" in image_tag:
                image_tag = re.sub(r'src=["\'][^"\']+["\']', f'src="{src}"', image_tag, count=1)
            else:
                image_tag = re.sub(r"<img", f'<img src="{src}"', image_tag, count=1)
            return image_tag

        content_html = re.sub(r"<img[^>]*>", replace_lazy_image, content_html, flags=re.IGNORECASE)
        content_html = re.sub(
            r'<img[^>]*(?:height=["\']?1["\']?[^>]*width=["\']?1["\']?|width=["\']?1["\']?[^>]*height=["\']?1["\']?)[^>]*>',
            "",
            content_html,
            flags=re.IGNORECASE,
        )
        content_html = re.sub(r"<div[^>]*>\s*</div>", "", content_html, flags=re.IGNORECASE)
        content_html = re.sub(r"\n\s*\n\s*\n+", "\n\n", content_html)
        return content_html.strip()

    def _looks_like_wechat_captcha(self, source_html: str, content_html: str) -> bool:
        combined = strip_tags(content_html or source_html)
        return "环境异常" in combined and "验证" in combined


class MarkdownImageDownloader:
    def __init__(self, output_dir: Path | None, base_url: Optional[str], timeout: int, mode: str) -> None:
        self.output_dir = output_dir
        self.base_url = base_url
        self.timeout = timeout
        self.mode = mode
        self.image_index = 0
        self.downloaded_files: List[str] = []
        self.failed_sources: List[str] = []

    def download(self, source: str) -> Optional[str]:
        source = html.unescape(source).split("#", 1)[0]
        if not source or source.startswith("data:"):
            return None

        if self.base_url and not source.startswith(("http://", "https://")):
            source = urljoin(self.base_url, source)

        if self.mode == "none":
            return None
        if self.mode == "remote":
            return source
        if self.output_dir is None:
            return source

        self.image_index += 1
        extension = self._detect_extension(source)
        file_name = f"image_{self.image_index:02d}{extension}"
        file_path = self.output_dir / file_name

        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }
        if "mmbiz.qpic.cn" in source or "weixin" in source:
            headers["Referer"] = "https://mp.weixin.qq.com/"
            headers["Origin"] = "https://mp.weixin.qq.com"

        try:
            response = requests.get(source, headers=headers, timeout=self.timeout, stream=True)
            response.raise_for_status()
            with file_path.open("wb") as file_handle:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        file_handle.write(chunk)
            if file_path.stat().st_size < 100:
                file_path.unlink(missing_ok=True)
                self.failed_sources.append(source)
                return None
            self.downloaded_files.append(str(file_path))
            return file_name
        except requests.RequestException:
            file_path.unlink(missing_ok=True)
            self.failed_sources.append(source)
            return None

    def _detect_extension(self, source: str) -> str:
        parsed = urlparse(source)
        query = parsed.query.lower()
        for fmt, extension in [
            ("png", ".png"),
            ("gif", ".gif"),
            ("webp", ".webp"),
            ("jpeg", ".jpg"),
            ("jpg", ".jpg"),
        ]:
            if f"wx_fmt={fmt}" in query:
                return extension

        lower_path = parsed.path.lower()
        for extension in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"):
            if lower_path.endswith(extension):
                return extension if extension != ".jpeg" else ".jpg"
        return ".jpg"


class HTMLToMarkdownParser(HTMLParser):
    def __init__(self, image_downloader: MarkdownImageDownloader) -> None:
        super().__init__()
        self.image_downloader = image_downloader
        self.result: List[str] = []
        self.tag_stack: List[str] = []
        self.list_stack: List[str] = []
        self.list_counters: List[int] = []
        self.ignore_tags = {"script", "style", "nav", "footer", "header", "aside"}
        self.skip_depth = 0
        self.current_href: Optional[str] = None
        self.link_buffer: Optional[List[str]] = None
        self.pending_newlines = 0
        self.in_pre = False

    def add_newlines(self, count: int) -> None:
        self.pending_newlines = max(self.pending_newlines, count)

    def flush_newlines(self) -> None:
        if self.pending_newlines > 0:
            self.result.append("\n" * self.pending_newlines)
            self.pending_newlines = 0

    def append_text(self, text: str) -> None:
        if self.link_buffer is not None:
            self.link_buffer.append(text)
            return
        self.flush_newlines()
        self.result.append(text)

    def handle_starttag(self, tag: str, attrs: List[tuple[str, Optional[str]]]) -> None:
        tag = tag.lower()
        attrs_dict = {key: value or "" for key, value in attrs}

        if tag in self.ignore_tags:
            self.skip_depth += 1
            return
        if self.skip_depth > 0:
            return

        self.tag_stack.append(tag)
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self.add_newlines(2)
            self.flush_newlines()
            level = int(tag[1])
            self.result.append("#" * level + " ")
        elif tag == "p":
            self.add_newlines(2)
            self.flush_newlines()
        elif tag == "br":
            self.result.append("  \n")
        elif tag == "hr":
            self.flush_newlines()
            self.result.append("\n---\n")
        elif tag in {"strong", "b"}:
            self.append_text("**")
        elif tag in {"em", "i"}:
            self.append_text("*")
        elif tag == "code" and not self.in_pre:
            self.append_text("`")
        elif tag == "pre":
            self.add_newlines(2)
            self.flush_newlines()
            self.result.append("```text\n")
            self.in_pre = True
        elif tag == "blockquote":
            self.add_newlines(2)
            self.flush_newlines()
            self.result.append("> ")
        elif tag == "a":
            self.current_href = attrs_dict.get("href", "").strip()
            self.link_buffer = []
        elif tag == "img":
            self.flush_newlines()
            source = attrs_dict.get("data-src") or attrs_dict.get("data-original") or attrs_dict.get("src") or ""
            alt_text = attrs_dict.get("alt") or attrs_dict.get("data-alt") or "image"
            local_path = self.image_downloader.download(source)
            if local_path:
                self.result.append(f"![{alt_text}]({local_path})")
                self.add_newlines(2)
        elif tag == "ul":
            self.add_newlines(2)
            self.flush_newlines()
            self.list_stack.append("ul")
        elif tag == "ol":
            self.add_newlines(2)
            self.flush_newlines()
            self.list_stack.append("ol")
            self.list_counters.append(1)
        elif tag == "li":
            self.flush_newlines()
            indent = "  " * max(0, len(self.list_stack) - 1)
            if self.list_stack and self.list_stack[-1] == "ol":
                index = self.list_counters[-1]
                self.result.append(f"{indent}{index}. ")
                self.list_counters[-1] += 1
            else:
                self.result.append(f"{indent}- ")
        elif tag == "table":
            self.add_newlines(2)
            self.flush_newlines()
        elif tag == "tr":
            self.result.append("|")
        elif tag in {"th", "td"}:
            self.result.append(" ")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()

        if tag in self.ignore_tags:
            if self.skip_depth > 0:
                self.skip_depth -= 1
            return
        if self.skip_depth > 0:
            return

        if self.tag_stack and self.tag_stack[-1] == tag:
            self.tag_stack.pop()

        if tag in {"h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote"}:
            self.add_newlines(2)
        elif tag in {"strong", "b"}:
            self.append_text("**")
        elif tag in {"em", "i"}:
            self.append_text("*")
        elif tag == "code" and not self.in_pre:
            self.append_text("`")
        elif tag == "pre":
            self.result.append("\n```")
            self.add_newlines(2)
            self.in_pre = False
        elif tag == "a":
            label = normalize_inline_text("".join(self.link_buffer or []))
            href = (self.current_href or "").strip()
            self.current_href = None
            self.link_buffer = None
            if not label:
                return
            if href and not href.lower().startswith(INVALID_LINK_PATTERNS):
                self.append_text(f"[{label}]({href})")
            else:
                self.append_text(label)
        elif tag == "ul":
            if self.list_stack:
                self.list_stack.pop()
            self.add_newlines(2)
        elif tag == "ol":
            if self.list_stack:
                self.list_stack.pop()
            if self.list_counters:
                self.list_counters.pop()
            self.add_newlines(2)
        elif tag == "li":
            self.add_newlines(1)
        elif tag in {"th", "td"}:
            self.result.append(" |")
        elif tag == "tr":
            self.result.append("\n")

    def handle_data(self, data: str) -> None:
        if self.skip_depth > 0:
            return
        if self.in_pre:
            self.append_text(data)
            return
        cleaned = re.sub(r"[ \t]+", " ", data)
        cleaned = re.sub(r"\n\s*\n", "\n\n", cleaned)
        if cleaned.strip():
            self.append_text(cleaned)

    def get_markdown(self) -> str:
        content = "".join(self.result)
        content = re.sub(r"\n{3,}", "\n\n", content)
        return content.strip() + "\n"


class GenericArticleHTMLExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.capture_depth = 0
        self.current_parts: List[str] = []
        self.candidates: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[tuple[str, Optional[str]]]) -> None:
        attrs_text = " ".join(value or "" for _key, value in attrs)
        starts_candidate = tag.lower() in {"article", "main"} or (
            tag.lower() == "div" and re.search(r"(article|post|entry|content|story|body)", attrs_text, re.IGNORECASE)
        )
        tag_text = self.get_starttag_text() or f"<{tag}>"
        if self.capture_depth > 0:
            self.current_parts.append(tag_text)
            self.capture_depth += 1
        elif starts_candidate:
            self.current_parts = [tag_text]
            self.capture_depth = 1

    def handle_startendtag(self, tag: str, attrs: List[tuple[str, Optional[str]]]) -> None:
        if self.capture_depth > 0:
            self.current_parts.append(self.get_starttag_text() or f"<{tag}/>")

    def handle_endtag(self, tag: str) -> None:
        if self.capture_depth <= 0:
            return
        self.current_parts.append(f"</{tag}>")
        self.capture_depth -= 1
        if self.capture_depth == 0:
            self.candidates.append("".join(self.current_parts))
            self.current_parts = []

    def handle_data(self, data: str) -> None:
        if self.capture_depth > 0:
            self.current_parts.append(data)

    def handle_entityref(self, name: str) -> None:
        if self.capture_depth > 0:
            self.current_parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if self.capture_depth > 0:
            self.current_parts.append(f"&#{name};")

    def best_candidate(self) -> str:
        if not self.candidates:
            return ""
        return max(self.candidates, key=lambda candidate: len(strip_tags(candidate)))


def format_markdown(markdown: str, markdown_dir: Path, is_wechat: bool) -> tuple[str, Dict[str, object]]:
    summary: Dict[str, object] = {
        "removed_duplicate_headings": 0,
        "normalized_heading_levels": 0,
        "fixed_invalid_links": 0,
        "removed_missing_images": [],
        "removed_noise_lines": 0,
        "trimmed_blank_lines": 0,
    }

    text = markdown.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\*{4,}", "", text)
    text = re.sub(r"([^\n])(!\[[^\]]*\]\([^)]+\))", r"\1\n\n\2", text)
    text = re.sub(r"(!\[[^\]]*\]\([^)]+\))([^\n])", r"\1\n\n\2", text)

    def replace_invalid_link(match: re.Match[str]) -> str:
        label = normalize_inline_text(match.group(1))
        target = match.group(2).strip()
        lowered = target.lower()
        if lowered.startswith(INVALID_LINK_PATTERNS):
            summary["fixed_invalid_links"] = int(summary["fixed_invalid_links"]) + 1
            return label
        return match.group(0)

    text = re.sub(r"\[([^\]]+?)\]\(([^)]+)\)", replace_invalid_link, text, flags=re.DOTALL)

    lines = text.split("\n")
    result_lines: List[str] = []
    previous_heading_text: Optional[str] = None
    previous_heading_level = 0
    in_code_block = False
    pending_heading_level: Optional[int] = None
    noise_patterns = WECHAT_NOISE_PATTERNS if is_wechat else GENERIC_NOISE_PATTERNS

    for raw_line in lines:
        line = raw_line.rstrip()
        stripped = line.strip()

        if stripped.startswith("```"):
            if stripped == "```":
                line = "```text"
            in_code_block = not in_code_block
            result_lines.append(line)
            continue

        if in_code_block:
            result_lines.append(line)
            continue

        if pending_heading_level is not None:
            if stripped == "":
                continue
            line = "#" * pending_heading_level + " " + normalize_inline_text(stripped)
            stripped = line
            pending_heading_level = None

        if any(pattern.match(stripped) for pattern in noise_patterns):
            summary["removed_noise_lines"] = int(summary["removed_noise_lines"]) + 1
            continue

        stripped = normalize_inline_text(stripped)
        line = normalize_inline_text(line)

        if not stripped:
            result_lines.append("")
            continue

        if is_wechat and _is_wechat_metadata_noise(stripped):
            summary["removed_noise_lines"] = int(summary["removed_noise_lines"]) + 1
            continue

        heading_match = re.match(r"^(#{1,6})(?:\s+(.*))?$", stripped)
        if heading_match:
            level = len(heading_match.group(1))
            heading_text = normalize_inline_text(heading_match.group(2) or "")
            if not heading_text:
                pending_heading_level = level
                continue
            if heading_text and previous_heading_text == heading_text:
                summary["removed_duplicate_headings"] = int(summary["removed_duplicate_headings"]) + 1
                continue
            if previous_heading_level and level > previous_heading_level + 1:
                level = previous_heading_level + 1
                summary["normalized_heading_levels"] = int(summary["normalized_heading_levels"]) + 1
            previous_heading_level = level
            previous_heading_text = heading_text
            result_lines.append("#" * level + " " + heading_text)
            continue

        image_match = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)$", stripped)
        if image_match:
            image_path = image_match.group(2).strip()
            if not image_path.startswith(("http://", "https://")):
                candidate = (markdown_dir / image_path).resolve()
                if not candidate.exists():
                    cast_list = summary["removed_missing_images"]
                    assert isinstance(cast_list, list)
                    cast_list.append(image_path)
                    continue
            alt = normalize_inline_text(image_match.group(1).strip())
            line = f"![{alt}]({image_path})"

        if re.match(r"^\s*[-*+]\s+", line):
            line = re.sub(r"^\s*[-*+]\s+", "- ", line)

        if stripped.startswith(">"):
            line = re.sub(r"^>\s*", "> ", stripped)

        if stripped == "***" or stripped == "___":
            line = "---"

        if "<" in line and ">" in line and not re.search(r"<https?://[^>]+>", line):
            line = re.sub(r"</?span[^>]*>", "", line)
            line = re.sub(r"</?font[^>]*>", "", line)
            line = re.sub(r"<br\s*/?>", "  ", line, flags=re.IGNORECASE)
            line = re.sub(r"<[^>]+>", "", line)

        line = normalize_inline_text(line)
        if not line:
            result_lines.append("")
            continue

        result_lines.append(line)

    text = "\n".join(result_lines)
    text = _normalize_blank_lines(text)
    summary["trimmed_blank_lines"] = max(0, markdown.count("\n\n\n") - text.count("\n\n\n"))
    return text.strip() + "\n", summary


def _normalize_blank_lines(markdown: str) -> str:
    lines = markdown.split("\n")
    normalized: List[str] = []
    blank_count = 0
    in_code_block = False

    for raw_line in lines:
        stripped = raw_line.strip()
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            blank_count = 0
            if normalized and normalized[-1] != "":
                normalized.append("")
            normalized.append(raw_line.rstrip())
            continue

        if in_code_block:
            normalized.append(raw_line.rstrip())
            continue

        if stripped == "":
            blank_count += 1
            if blank_count <= 1:
                normalized.append("")
            continue

        blank_count = 0
        previous = normalized[-1] if normalized else None
        if stripped.startswith("#") or stripped.startswith("![") or stripped == "---":
            if previous not in (None, ""):
                normalized.append("")
        normalized.append(raw_line.rstrip())

    while normalized and normalized[-1] == "":
        normalized.pop()
    return "\n".join(normalized)


def _is_wechat_metadata_noise(line: str) -> bool:
    if not line:
        return False
    if line == "原创":
        return True
    if line.startswith("原创") and "在小说阅读器中沉浸阅读" in line:
        return True
    if "在小说阅读器中沉浸阅读" in line:
        return True
    if line.startswith("原创") and len(line) < 40:
        return True
    if line.startswith("微信扫一扫"):
        return True
    if line.startswith("喜欢此内容的人还喜欢"):
        return True
    if line.startswith("继续滑动看下一个"):
        return True
    if line.startswith("作者：") and len(line) < 40:
        return True
    if line.startswith("公众号：") and len(line) < 40:
        return True
    return False


def relative_posix_path(target: Path, start: Path) -> str:
    return os.path.relpath(target.resolve(), start.resolve()).replace(os.sep, "/")


def convert_article_to_markdown(
    article: ArticleData,
    output_path: Path,
    asset_root: Path,
    image_mode: str,
    timeout: int,
) -> tuple[str, Dict[str, object]]:
    if image_mode == "auto":
        resolved_image_mode = "download" if article.is_wechat else "none"
    elif image_mode == "download":
        resolved_image_mode = "download"
    elif image_mode in {"none", "remote"}:
        resolved_image_mode = image_mode
    else:
        raise ValueError("--article-images must be auto, download, remote, or none")

    image_dir = asset_root / "images" if resolved_image_mode == "download" else None
    if image_dir is not None:
        image_dir.mkdir(parents=True, exist_ok=True)
    downloader = MarkdownImageDownloader(
        output_dir=image_dir,
        base_url=article.original_url,
        timeout=timeout,
        mode=resolved_image_mode,
    )

    parser = HTMLToMarkdownParser(downloader)
    article_html = f"""
    <article>
        <h1>{html.escape(article.title)}</h1>
        <p>作者: {html.escape(article.author or '未知')}</p>
        <p>{'公众号' if article.is_wechat else '来源'}: {html.escape(article.account_name or '未知')}</p>
        <div>{article.content_html}</div>
        <p>原文链接: <a href="{html.escape(article.original_url)}">{html.escape(article.original_url)}</a></p>
    </article>
    """

    parser.feed(article_html)
    raw_markdown = parser.get_markdown()
    formatted_markdown, format_summary = format_markdown(raw_markdown, image_dir or output_path.parent, article.is_wechat)

    if resolved_image_mode == "download" and image_dir is not None:
        formatted_markdown = rewrite_downloaded_image_refs(formatted_markdown, image_dir, output_path)

    return formatted_markdown, {
        "assetFiles": downloader.downloaded_files,
        "articleImagesDownloaded": len(downloader.downloaded_files),
        "articleImageDownloadFailures": len(downloader.failed_sources),
        "articleFailedImageUrls": downloader.failed_sources[:20],
        "articleImageMode": resolved_image_mode,
        "articleFormatSummary": format_summary,
        "cleanHtmlPreviewLength": len(article_html),
    }


def rewrite_downloaded_image_refs(markdown: str, image_dir: Path, output_path: Path) -> str:
    def replace(match: re.Match[str]) -> str:
        alt = match.group(1)
        name = match.group(2)
        if name.startswith(("http://", "https://")):
            return match.group(0)
        rel = relative_posix_path(image_dir / name, output_path.parent)
        return f"![{alt}]({rel})"

    return re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", replace, markdown)


def build_metadata_markdown(article: ArticleData, body_markdown: str) -> str:
    return body_markdown.strip() + "\n"


def decode_article_url(
    source: str,
    output_path: Path,
    asset_root: Path | None,
    image_mode: str,
    timeout: int,
    save_html: bool,
) -> tuple[str, dict[str, object]]:
    source_html, final_url = fetch_html(source, timeout)
    article = ArticleExtractor().extract(source_html, source, final_url)
    asset_root = asset_root or output_path.with_name(f"{output_path.name}.assets")
    body_markdown, conversion_summary = convert_article_to_markdown(
        article=article,
        output_path=output_path,
        asset_root=asset_root,
        image_mode=image_mode,
        timeout=timeout,
    )

    saved_html_path = None
    if save_html:
        asset_root.mkdir(parents=True, exist_ok=True)
        saved_html_path = asset_root / f"{sanitize_filename(article.title)}.article.html"
        saved_html_path.write_text(article.content_html, encoding="utf-8")

    markdown = build_metadata_markdown(article, body_markdown)
    asset_files = list(conversion_summary.get("assetFiles", []))
    if saved_html_path:
        asset_files.append(str(saved_html_path))
    effective_asset_root = str(asset_root) if asset_files else None

    return markdown, {
        "articleTitle": article.title,
        "articleAuthor": article.author or None,
        "articleSiteName": article.account_name or None,
        "articleFinalUrl": final_url,
        "articleIsWeChat": article.is_wechat,
        "articleExtractionMethod": "wechat-article" if article.is_wechat else "generic-article",
        "articleImageMode": conversion_summary.get("articleImageMode"),
        "assetRoot": effective_asset_root,
        "assetFiles": asset_files,
        "articleImagesDownloaded": conversion_summary.get("articleImagesDownloaded", 0),
        "articleImageDownloadFailures": conversion_summary.get("articleImageDownloadFailures", 0),
        "articleFailedImageUrls": conversion_summary.get("articleFailedImageUrls", []),
        "articleFormatSummary": conversion_summary.get("articleFormatSummary", {}),
        "cleanHtmlPreviewLength": conversion_summary.get("cleanHtmlPreviewLength", 0),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch article URLs and convert them to formatted Markdown.")
    parser.add_argument("url", help="Article URL")
    parser.add_argument("--output", required=True, help="Markdown output path")
    parser.add_argument("--asset-root", help="Asset output directory")
    parser.add_argument("--article-images", choices=["auto", "download", "remote", "none"], default="auto")
    parser.add_argument("--article-timeout", type=int, default=30)
    parser.add_argument("--article-save-html", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_path = Path(args.output).expanduser().resolve()
    asset_root = Path(args.asset_root).expanduser().resolve() if args.asset_root else output_path.with_name(f"{output_path.name}.assets")
    try:
        markdown, _metadata = decode_article_url(
            source=args.url,
            output_path=output_path,
            asset_root=asset_root,
            image_mode=args.article_images,
            timeout=args.article_timeout,
            save_html=args.article_save_html,
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(markdown, encoding="utf-8")
    except requests.RequestException as error:
        print(f"fetch failed: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"article conversion failed: {error}", file=sys.stderr)
        return 1
    print(str(output_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
