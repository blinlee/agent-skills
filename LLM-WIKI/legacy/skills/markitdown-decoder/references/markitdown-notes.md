# Decoder Router Notes

## Routing Surface

The llm-wiki decoder script now routes high-fidelity document formats to MinerU and keeps MarkItDown as the broad fallback.

MinerU-routed extensions:

- `.pdf`
- `.png`, `.jpg`, `.jpeg`, `.jp2`, `.webp`, `.gif`, `.bmp`
- `.doc`, `.docx`
- `.ppt`, `.pptx`
- `.xls`, `.xlsx`

All other non-Markdown formats stay on MarkItDown unless the operator explicitly forces `--decoder mineru` for diagnosis.

MinerU output assets are moved out of `raw/inbox` into `system/decoders/assets/<decoded-name>/`, and Markdown references are rewritten to point there. This prevents extracted images from being scanned as fresh raw inbox drops.

## Supported Surface

The fallback path is designed around Microsoft MarkItDown's local conversion capability. MarkItDown supports many common source formats through built-in converters, including Office documents, PDFs, HTML, CSV/JSON/XML, EPUB, ZIP archives, notebooks, images, audio, RSS/Wikipedia/YouTube-style captures, and plugin-provided formats.

For llm-wiki, MarkItDown is now the fallback for formats outside the MinerU high-fidelity list. It remains especially useful for HTML and lightweight structured text, where MinerU-HTML can be slow or timeout.

## MinerU Boundary

Use `mineru-open-api extract` for routed high-fidelity local files. The default model is `vlm` because the decoder's purpose is to preserve layout, formulas, tables, images, and OCR text before llm-wiki ingest.

Use `--mineru-model pipeline` only when the user explicitly prioritizes no-hallucination reliability over complex-layout fidelity.

Do not use `mineru-open-api crawl` as the default for saved HTML drops. A saved HTML file is routed to MarkItDown unless the user explicitly asks for MinerU-HTML experimentation.

## Preferred API Boundary

Use local-file conversion by default:

- Python package: `MarkItDown(...).convert_local(path)`
- CLI: `markitdown <path> --output <file.md>`
- MinerU CLI: `mineru-open-api extract <path> --format md --model vlm --output <file.md>`

The bundled `decode.py` script selects MinerU or MarkItDown first, then MarkItDown tries the Python package and falls back to the `markitdown` CLI. Use it through `uv run --python 3.13 --with "markitdown[all]" ...` so the fallback runtime does not fall back to macOS system Python 3.9.

## Migrated CLI Features

The internal script covers the practical MarkItDown CLI surface:

- output file writing
- extension, MIME type, and charset hints
- plugin opt-in
- plugin listing
- data URI retention
- Azure Document Intelligence opt-in
- Azure Content Understanding opt-in
- local file conversion by default
- trusted URI conversion behind `--allow-uri`

The llm-wiki workflow keeps cloud and URI features opt-in because they widen the trust boundary.

## Deferred Surface

MarkItDown MCP and broad URI conversion are intentionally not the default llm-wiki path. They are useful for local trusted agents, but they widen the read/network surface. Use them only when the user explicitly asks for that execution model and understands the trust boundary.

MinerU web crawling and MinerU-HTML are also not the default llm-wiki path for saved HTML files until timeout/size behavior is better characterized.
