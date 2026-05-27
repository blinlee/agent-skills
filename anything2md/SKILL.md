---
name: anything2md
description: Convert document-like sources to Markdown with a deterministic decoder router. Use this whenever a user wants PDFs, images, DOC/DOCX, PPT/PPTX, XLS/XLSX, EPUB, HTML, ZIPs, audio, notebooks, CSV/JSON/XML, or other non-.md/.txt files turned into Markdown for review, knowledge ingest, RAG, wiki workflows, or other agent processing. The router sends PDF, images, Word, PowerPoint, and Excel formats to MinerU for high-fidelity Markdown/assets, and sends remaining formats to MarkItDown. Prefer this skill before downstream skills try to read or ingest non-Markdown documents.
license: MIT
metadata:
  version: 0.1.0
  platforms: [linux, macos, windows]
  tags: [mineru, markitdown, markdown, decoder, document-conversion]
  category: knowledge-ingest
---

# anything2md

Use this skill to convert local non-Markdown documents into Markdown derivatives with structured metadata. The original document remains the source evidence; the decoded Markdown is a derivative for downstream agent workflows.

The bundled script is a decoder router:

- **MinerU precision extraction** for `.pdf`, `.png`, `.jpg`, `.jpeg`, `.jp2`, `.webp`, `.gif`, `.bmp`, `.doc`, `.docx`, `.ppt`, `.pptx`, `.xls`, and `.xlsx`.
- **MarkItDown fallback** for other non-Markdown formats such as EPUB, HTML, CSV/JSON/XML, ZIPs, audio, notebooks, RSS/Wikipedia/YouTube-style captures, and plugin-provided formats.

If the source is already Markdown or plain text, skip conversion unless the user explicitly wants normalized metadata/frontmatter.

## Standard Flow

1. Confirm the source is a trusted local file, or require explicit `--allow-uri` for URI conversion.
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
- routes PDF/images/Word/PowerPoint/Excel to `mineru-open-api extract --model vlm` by default
- routes every other non-Markdown format to MarkItDown
- uses the installed Python `markitdown` package when available
- falls back to a `markitdown` executable on `PATH`
- supports MarkItDown's plugin listing, plugin opt-in, data URI retention, Document Intelligence, and Content Understanding flags
- writes Markdown plus a `.metadata.json` sidecar
- writes MinerU extracted assets beside the output by default, or under `<knowledgeRoot>/anything2md/assets/<decoded-name>/` when a knowledge root is supplied
- rewrites Markdown image references to the moved MinerU asset location
- auto-splits PDF inputs above MinerU's per-task page limit into temporary page chunks, runs those chunks with bounded parallelism, then writes one merged Markdown output without leaving intermediate part files
- adds provenance frontmatter unless `--no-frontmatter` is passed
- avoids absolute source paths in frontmatter by default
- supports `--profile auto` by default, which emits generic frontmatter for normal conversion and archive frontmatter when knowledge-root/archive flags are present
- can move the original local document into a deterministic archive root with `--knowledge-root <root> --archive-original`
- exits nonzero with a structured error if the selected decoder is missing or conversion fails

Force a backend only for diagnosis:

```bash
uv run --python 3.13 --with "markitdown[all]" python scripts/decode.py report.pdf --decoder mineru --mineru-model vlm --json
uv run --python 3.13 --with "markitdown[all]" python scripts/decode.py page.html --decoder markitdown --json
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
- MinerU is not currently the default for HTML. Saved HTML pages can be slow or timeout under MinerU-HTML; use MarkItDown or a dedicated HTML cleaner first.
- MinerU is a better high-fidelity document decoder, but it is still not a verifier. Formula output, OCR, and table structure need review for critical sources.
- MarkItDown fallback is broad, not layout-perfect. It is useful for agent-readable extraction, not exact visual reproduction.
- Do not point agents at `markitdown-mcp` by default; it can read local files and network resources with the server user's privileges.
- `markitdown[all]` can add heavy optional dependencies. If installation is not desired, report that decoding is unavailable instead of silently changing the workflow.
- Use Python 3.13 through `uv`; do not rely on `/usr/bin/python3` on macOS.
- Generic conversion writes `anything2md_decoded` frontmatter. `--profile auto` uses `archive` when knowledge-root/archive flags are used; pass `--profile archive` when you want that behavior to be explicit.
