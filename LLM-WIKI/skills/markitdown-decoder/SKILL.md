---
name: markitdown-decoder
description: Decode non-Markdown documents to Markdown before LLM-WIKI ingest with the repo-local decoder router. Use this whenever a user wants to ingest or prepare PDFs, images, DOC/DOCX, PPT/PPTX, XLS/XLSX, EPUB, HTML, ZIPs, audio, notebooks, or other non-.md/.txt sources for LLM-WIKI, even if they only say "add this document to the wiki" or "put this file in raw/inbox." The router sends PDF, images, Word, PowerPoint, and Excel formats to MinerU for high-fidelity Markdown/assets, and sends the remaining formats to MarkItDown. Prefer this skill before any LLM-WIKI ingest of document-like local files.
license: MIT
metadata:
  version: 0.1.0
  platforms: [linux, macos, windows]
  tags: [mineru, markitdown, markdown, decoder, llm-wiki, document-conversion]
  category: knowledge-ingest
---

# LLM-WIKI Decoder Router

Use this skill to turn local non-Markdown documents into Markdown derivatives before LLM-WIKI ingest. The original document remains evidence; the decoded Markdown is the source passed to the normal LLM-WIKI workflow.

The bundled script is a decoder router:

- **MinerU precision extraction** for `.pdf`, `.png`, `.jpg`, `.jpeg`, `.jp2`, `.webp`, `.gif`, `.bmp`, `.doc`, `.docx`, `.ppt`, `.pptx`, `.xls`, and `.xlsx`.
- **MarkItDown fallback** for all other non-Markdown formats such as EPUB, HTML, CSV/JSON/XML, ZIPs, audio, notebooks, RSS/Wikipedia/YouTube-style captures, and plugin-provided formats.

## When To Use

Use this before LLM-WIKI ingest when the source is not already `.md`, `.markdown`, or plain `.txt`, especially:

- PDFs, scanned PDFs, images, Word, PowerPoint, and Excel files where MinerU can preserve layout, formulas, tables, and extracted assets better than a lightweight text converter
- EPUB, HTML, CSV, JSON, XML, RSS, ZIP archives, notebooks, or audio where MarkItDown remains the broad local fallback
- ZIP archives, notebooks, Outlook messages, YouTube/Wikipedia/Bing result captures when deliberately provided as supported sources

If the source is already Markdown or plain text, skip this skill and ingest normally.

## Standard LLM-WIKI Flow

1. Preserve the original document in the user's chosen evidence location. Do not edit or delete it.
2. Decode the local document to a Markdown derivative.
3. If the source came from a knowledge root's `raw/inbox`, archive the original non-Markdown document during decode so it will not be processed again.
4. Ingest the decoded `.md` file with the normal LLM-WIKI command.
5. Run the usual LLM-WIKI validation, normally `lint`, and `index` when retrieval freshness matters.

```bash
uv run --python 3.13 --with "markitdown[all]" python skills/markitdown-decoder/scripts/decode.py <source-file> \
  --output <decoded-file.md> \
  --knowledge-root <knowledgeRoot> \
  --archive-original \
  --json

npm run --silent cli -- ingest <knowledgeRoot> <decoded-file.md>
npm run --silent cli -- lint <knowledgeRoot>
```

After the decode step, do not invent a parallel ingest path. Treat the decoded Markdown as the source artifact that enters LLM-WIKI's existing archive/stage/review/taxonomy flow.

## Mandatory Deterministic Step

Run the bundled decoder script from the LLM-WIKI package root. Use `uv` with Python 3.13 so the MarkItDown fallback does not accidentally run under macOS system Python 3.9, which is too old for current MarkItDown:

```bash
uv run --python 3.13 --with "markitdown[all]" python skills/markitdown-decoder/scripts/decode.py <source-file> --output <decoded-file.md> --json
```

The script:

- accepts local files by default
- rejects URI input unless `--allow-uri` is explicitly passed
- routes PDF/images/Word/PowerPoint/Excel to `mineru-open-api extract --model vlm` by default
- routes every other non-Markdown format to MarkItDown
- uses the installed Python `markitdown` package when available
- falls back to a `markitdown` executable on `PATH`
- supports MarkItDown's plugin listing, plugin opt-in, data URI retention, Document Intelligence, and Content Understanding flags
- writes Markdown plus a `.metadata.json` sidecar
- writes the metadata sidecar under `<knowledgeRoot>/system/decoders/metadata/` when the decoded Markdown is placed in `<knowledgeRoot>/raw/inbox`, so intake will not reprocess the sidecar
- writes MinerU extracted assets under `<knowledgeRoot>/system/decoders/assets/<decoded-name>/` and rewrites Markdown image references so assets do not land in `raw/inbox`
- adds frontmatter to the Markdown derivative unless `--no-frontmatter` is passed
- avoids absolute source paths in frontmatter by default
- can move the original local document to `raw/archive/document-decoder-originals` with `--knowledge-root <root> --archive-original`
- exits nonzero with a structured error if the selected decoder is missing or conversion fails

Force a backend only for diagnosis:

```bash
uv run --python 3.13 --with "markitdown[all]" python skills/markitdown-decoder/scripts/decode.py report.pdf --decoder mineru --mineru-model vlm --json
uv run --python 3.13 --with "markitdown[all]" python skills/markitdown-decoder/scripts/decode.py page.html --decoder markitdown --json
```

Check availability without converting:

```bash
uv run --python 3.13 --with "markitdown[all]" python skills/markitdown-decoder/scripts/decode.py --check --json
```

Install MarkItDown when missing:

```bash
uv tool install --python 3.13 "markitdown[all]"
```

If you do not want a global tool install, keep using the `uv run --python 3.13 --with "markitdown[all]" ...` form.

List installed MarkItDown plugins:

```bash
uv run --python 3.13 --with "markitdown[all]" python skills/markitdown-decoder/scripts/decode.py --list-plugins --json
```

## Safe Defaults

- Prefer local files. Avoid MarkItDown MCP, MinerU web crawl, and broad URI conversion for normal LLM-WIKI intake.
- Use MinerU `vlm` as the default for routed high-fidelity formats. Use `--mineru-model pipeline` only when the user explicitly prioritizes no-hallucination reliability over complex-layout fidelity.
- Keep plugins disabled unless the user or source explicitly requires a known installed MarkItDown plugin.
- Do not enable cloud Document Intelligence, Azure Content Understanding, OCR, or LLM-backed conversion implicitly. Use `--use-docintel` or `--use-cu` only when the user explicitly selected that cloud path and provided the required endpoint.
- If conversion fails, report the failure and leave the original document untouched; do not create an empty wiki source.
- If a non-Markdown source is in `raw/inbox`, use `--archive-original` after successful decode. Otherwise the original document will be seen again by `ingest-inbox` and rejected as an unsupported source.

## Output Contract

For successful conversion, report:

```text
Command(s): <decode command, then ingest/lint commands if run>
Source document: <original path>
Decoded Markdown: <decoded .md path>
Metadata: <metadata .json path>
Assets: <asset directory, if MinerU extracted images/tables/figures>
Original archive: <archived original path, if --archive-original was used>
Knowledge root: <root, if ingested>
Result: <conversion and ingest summary>
Validation: <lint/index/status result, if run>
Remaining risks: <conversion quality or missing dependency concerns>
```

## Gotchas

- The script name stays `markitdown-decoder` for compatibility, but the active behavior is a MinerU-plus-MarkItDown router.
- MinerU sends document content to the configured MinerU API. Use it for the high-fidelity formats above only when that privacy boundary is acceptable.
- MinerU is not currently the default for HTML in this workflow. Saved HTML pages can be slow or timeout under MinerU-HTML; use MarkItDown or a dedicated HTML cleaner first.
- MinerU is a better high-fidelity document decoder, but it is still not a verifier. Formula output, OCR, and table structure need review for critical sources.
- The original document is evidence. The Markdown file is a derivative prepared for LLM-WIKI.
- LLM-WIKI's current managed raw archive is text-oriented. The decoder archives original non-Markdown documents under `raw/archive/document-decoder-originals` rather than trying to wrap binary files as managed raw Markdown.
- Do not point agents at `markitdown-mcp` by default; it can read local files and network resources with the server user's privileges.
- `markitdown[all]` can add heavy optional dependencies. If installation is not desired, report that decoding is unavailable instead of silently changing the workflow.
- Use Python 3.13 through `uv`; do not rely on `/usr/bin/python3` on macOS.
- Keep `npm run --silent cli -- ...` for LLM-WIKI commands so JSON-like output is not polluted.
