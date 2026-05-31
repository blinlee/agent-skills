---
name: anything2md
description: Convert document-like sources, local article HTML files, trusted article URLs, and trusted Bilibili video URLs to Markdown with a deterministic decoder router. Use this whenever a user wants PDFs, images, DOC/DOCX, PPT/PPTX, XLS/XLSX, ordinary web articles, WeChat public articles, Bilibili video transcripts, EPUB, HTML, ZIPs, audio, notebooks, CSV/JSON/XML, or other non-.md/.txt sources turned into Markdown for review, knowledge ingest, RAG, wiki workflows, or other agent processing. The router sends Bilibili video URLs to the built-in Bilibili transcript decoder, PDF/images/Word/PowerPoint/Excel formats to MinerU, trusted HTTP(S) article URLs plus saved `.html/.htm` article files to the built-in article extractor, and remaining formats to MarkItDown. Prefer this skill before downstream skills try to read or ingest non-Markdown documents.
license: MIT
metadata:
  version: 0.1.0
  platforms: [linux, macos, windows]
  tags: [mineru, markitdown, bilibili, transcript, markdown, decoder, document-conversion]
  category: knowledge-ingest
---

# anything2md

Use this skill to convert local non-Markdown documents, local article HTML files, trusted article URLs, and trusted Bilibili video URLs into Markdown derivatives with structured metadata. The original document, HTML file, video URL, or article URL remains the source evidence; the decoded Markdown is a derivative for downstream agent workflows.

The bundled script is a decoder router:

- **MinerU precision extraction** for `.pdf`, `.png`, `.jpg`, `.jpeg`, `.jp2`, `.webp`, `.gif`, `.bmp`, `.doc`, `.docx`, `.ppt`, `.pptx`, `.xls`, and `.xlsx`.
- **Built-in Bilibili transcript extraction** for trusted Bilibili video URLs when `--allow-uri` is passed, selecting Chinese subtitles by default and translating non-Chinese subtitles to Chinese when no Chinese subtitle is available.
- **Built-in article extraction** for trusted HTTP(S) article URLs when `--allow-uri` is passed and for local saved `.html/.htm` article files, including a WeChat public article branch adapted from the tested local WeChat article pipeline.
- **MarkItDown fallback** for other non-Markdown formats such as EPUB, CSV/JSON/XML, ZIPs, audio, notebooks, RSS/Wikipedia/YouTube-style captures, and plugin-provided formats.

If the source is already Markdown or plain text, skip conversion unless the user explicitly wants normalized metadata/frontmatter.

## Standard Flow

1. Confirm the source is a trusted local file, or require explicit `--allow-uri` for article URL conversion.
2. Decode the document to a `.md` output path.
3. Preserve the metadata JSON sidecar and extracted assets.
4. Review conversion quality when formulas, OCR, tables, or figures matter.
5. Hand the decoded Markdown to the downstream workflow; do not invent downstream-specific ingest behavior inside this skill.

```bash
uv run --python 3.13 --with "markitdown[all]" python scripts/decode.py <source-file> \
  --output <decoded-file.md> \
  --json
```

## Mandatory Deterministic Step

Run the bundled decoder script from the project root. Use `uv` with Python 3.13 so the MarkItDown fallback does not accidentally run under macOS system Python 3.9, which is too old for current MarkItDown:

```bash
uv run --python 3.13 --with "markitdown[all]" python scripts/decode.py <source-file> --output <decoded-file.md> --json
```

The script:

- accepts local files by default
- rejects URI input unless `--allow-uri` is explicitly passed
- routes trusted Bilibili video URLs to the built-in Bilibili transcript decoder as a forced route
- routes PDF/images/Word/PowerPoint/Excel to `mineru-open-api extract --model vlm` by default
- routes trusted HTTP(S) article URLs and local saved `.html/.htm` article files to the built-in article extractor as a forced route
- handles ordinary article sources as core正文 extraction, not full-page UI capture
- handles WeChat public article URLs or saved WeChat HTML files with WeChat-specific title/account/body/lazy-image/noise handling
- handles Bilibili videos as Chinese transcript extraction: Chinese human CC subtitles, Chinese Bilibili AI subtitles, translated non-Chinese subtitles, then Whisper if enabled
- routes every other non-Markdown format to MarkItDown
- uses the installed Python `markitdown` package when available
- falls back to a `markitdown` executable on `PATH`
- supports MarkItDown's plugin listing, plugin opt-in, data URI retention, Document Intelligence, and Content Understanding flags
- writes Markdown plus a `.metadata.json` sidecar
- writes MinerU/article extracted assets beside the output by default, or under `<knowledgeRoot>/anything2md/assets/<decoded-name>/` when a knowledge root is supplied
- rewrites Markdown image references to the moved MinerU asset location
- auto-splits PDF inputs above MinerU's per-task page limit into temporary page chunks, runs those chunks with bounded parallelism, then writes one merged Markdown output without leaving intermediate part files
- adds provenance frontmatter unless `--no-frontmatter` is passed
- avoids absolute source paths in frontmatter by default
- supports `--profile auto` by default, which emits generic frontmatter for normal conversion and archive frontmatter when knowledge-root/archive flags are present
- can move the original local document into a deterministic archive root with `--knowledge-root <root> --archive-original`
- exits nonzero with a structured error if the selected decoder is missing or conversion fails

Force a backend only for non-article-source diagnosis:

```bash
uv run --python 3.13 --with "markitdown[all]" python scripts/decode.py report.pdf --decoder mineru --mineru-model vlm --json
uv run --python 3.13 --with "markitdown[all]" python scripts/decode.py 'https://www.bilibili.com/video/BVxxxx/' --allow-uri --decoder bilibili --json
uv run --python 3.13 --with "markitdown[all]" python scripts/decode.py 'https://example.com/article' --allow-uri --decoder article --json
uv run --python 3.13 --with "markitdown[all]" python scripts/decode.py page.html --decoder article --json
```

Check availability without converting:

```bash
uv run --python 3.13 --with "markitdown[all]" python scripts/decode.py --check --json
```

List installed MarkItDown plugins:

```bash
uv run --python 3.13 --with "markitdown[all]" python scripts/decode.py --list-plugins --json
```

## Archive Profile

Use the archive profile when the converted Markdown should become part of a portable knowledge corpus with stable metadata, assets, and original-file retention.

```bash
uv run --python 3.13 --with "markitdown[all]" python scripts/decode.py <sourcePath> \
  --output <decodedMarkdownPath> \
  --knowledge-root <knowledgeRoot> \
  --archive-original \
  --json
```

`--profile auto` selects `archive` when `--knowledge-root`, `--archive-root`, or `--archive-original` is present. You may pass `--profile archive` explicitly when the archive boundary should be visible in the command. Archive mode uses this portable layout by default:

```text
<knowledgeRoot>/anything2md/
├── assets/<decoded-name>/
├── archive/originals/<sha-prefix>/<sha256>/
└── metadata/<decoded-name>.metadata.json
```

The archive profile is self-contained and project-neutral. It does not depend on external repository paths or downstream workflow names.

## Safe Defaults

- Prefer local files. Avoid MarkItDown MCP, MinerU web crawl, and broad URI conversion for normal conversion work.
- For Bilibili video URLs, use the built-in Bilibili decoder with `--allow-uri`; do not route to article extraction, MinerU, MarkItDown, or the external Bilibili reference skill.
- For ordinary web articles and WeChat public articles, use the built-in article extractor; pass `--allow-uri` only for URL inputs. Saved article HTML files route there automatically.
- Bilibili conversion writes Chinese complete transcript Markdown with metadata only. It does not generate AI summaries, summary placeholders, favorite-folder scanning, Knowledge RAG indexing, cron jobs, or notifications.
- Treat article conversion as正文 extraction only. It is not for landing pages, dashboards, interactive UI, or whole-page browser snapshots.
- Ordinary article conversion defaults to no image downloads. WeChat article conversion defaults to downloading article images, following the tested WeChat pipeline behavior; use `--article-images remote` or `--article-images none` when desired.
- Use MinerU `vlm` as the default for routed high-fidelity formats. Use `--mineru-model pipeline` only when the user explicitly prioritizes no-hallucination reliability over complex-layout fidelity.
- Keep plugins disabled unless the user or source explicitly requires a known installed MarkItDown plugin.
- Do not enable cloud Document Intelligence, Azure Content Understanding, OCR, or LLM-backed conversion implicitly. Use `--use-docintel` or `--use-cu` only when the user explicitly selected that cloud path and provided the required endpoint.
- If conversion fails, report the failure and leave the original document untouched; do not create an empty successful artifact.

## Output Contract

For successful conversion, report:

```text
Command: <decode command>
Source document: <original path or safe label>
Decoded Markdown: <decoded .md path>
Metadata: <metadata .json path>
Assets: <asset directory, if extracted>
Original archive: <archived original path, if --archive-original was used>
Profile: <generic or archive>
Result: <conversion summary>
Remaining risks: <conversion quality or missing dependency concerns>
```

## Gotchas

- MinerU sends document content to the configured MinerU API. Use it only when that privacy boundary is acceptable.
- MinerU's effective per-task page limit may be lower than its broad document-size limit. The script automatically splits PDFs over 200 pages when no explicit `--pages` range is supplied, runs up to 10 chunks in parallel by default, and supports `--mineru-chunk-concurrency` plus retry/backoff flags when the operator wants to tune throughput against API rate limits.
- Bilibili video conversion depends on `yt-dlp`. Subtitle-only paths are fast; Whisper fallback requires `ffmpeg` and `whisper`, may be slow, and can be disabled with `--bilibili-no-whisper`.
- Bilibili AI subtitles often require a valid login cookie. Pass `--bilibili-cookies <cookies.txt>` when browser cookie access is unavailable or undesirable. Cookie metadata is redacted by default and records only `file`, `browser`, or `none`; absolute cookie paths are included only when `--include-absolute-paths` is explicitly set.
- Bilibili output is Chinese by default. If only non-Chinese subtitles are available, the decoder translates them to Chinese with `argos` or `trans` when available; if translation is unavailable, it fails instead of returning non-Chinese transcript Markdown. Use `--bilibili-translation-backend none` only for diagnosis.
- MinerU and MarkItDown are not the default for `.html/.htm` article files. Saved article HTML routes to the built-in article extractor and fails there if it is not an article-shaped source.
- Article extraction is intentionally based on tested article-pipeline behavior: load the page, isolate the article body, normalize lazy images, convert HTML to Markdown, and format noise away. Do not replace it with MinerU crawl, MarkItDown fallback, or a general website renderer for article sources.
- The ordinary article branch is for article pages. If the source is a product page, web app, landing page, or visual UI, use a browser/scraper workflow outside this skill.
- WeChat direct fetch may still fail when WeChat returns an access-verification page; report that as a blocked source rather than silently falling back to a summary service.
- MinerU is a better high-fidelity document decoder, but it is still not a verifier. Formula output, OCR, and table structure need review for critical sources.
- MarkItDown fallback is broad, not layout-perfect. It is useful for agent-readable extraction, not exact visual reproduction.
- Do not point agents at `markitdown-mcp` by default; it can read local files and network resources with the server user's privileges.
- `markitdown[all]` can add heavy optional dependencies. If installation is not desired, report that decoding is unavailable instead of silently changing the workflow.
- Use Python 3.13 through `uv`; do not rely on `/usr/bin/python3` on macOS.
- Generic conversion writes `anything2md_decoded` frontmatter. `--profile auto` uses `archive` when knowledge-root/archive flags are used; pass `--profile archive` when you want that behavior to be explicit.
