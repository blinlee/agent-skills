# Decoder Router Notes

## Routing Surface

`anything2md` routes high-fidelity document formats to MinerU, trusted HTTP(S) article URLs to its built-in article extractor, and keeps MarkItDown as the broad fallback.

MinerU-routed extensions:

- `.pdf`
- `.png`, `.jpg`, `.jpeg`, `.jp2`, `.webp`, `.gif`, `.bmp`
- `.doc`, `.docx`
- `.ppt`, `.pptx`
- `.xls`, `.xlsx`

Trusted HTTP(S) article URLs route to the built-in article extractor when `--allow-uri` is passed. All other non-Markdown formats stay on MarkItDown unless the operator explicitly forces a decoder for diagnosis.

MinerU output assets are moved to the configured asset root, and Markdown references are rewritten to point there. If a knowledge root is supplied, the asset root defaults to `anything2md/assets/<decoded-name>/`.

For PDFs above MinerU's per-task page limit, `decode.py` auto-splits the document into page ranges and submits each range separately. Chunk jobs run with bounded parallelism (`--mineru-chunk-concurrency`, default 10) and retry with exponential backoff when a chunk fails. Chunk Markdown files live only in a temporary directory; the final output is a single merged Markdown file with one metadata sidecar.

## Supported Surface

The fallback path is designed around Microsoft MarkItDown's local conversion capability. MarkItDown supports many common source formats through built-in converters, including Office documents, PDFs, HTML, CSV/JSON/XML, EPUB, ZIP archives, notebooks, images, audio, RSS/Wikipedia/YouTube-style captures, and plugin-provided formats.

For `anything2md`, MarkItDown is the fallback for formats outside the MinerU high-fidelity list. It remains especially useful for HTML and lightweight structured text, where MinerU-HTML can be slow or timeout.

## Article URL Boundary

The article extractor is internal to `anything2md`; it does not call external skills. Its behavior is intentionally limited to the tested reference semantics:

- ordinary article URLs: fetch the page, isolate the core article body, remove page chrome/noise, and write Markdown
- WeChat public article URLs: fetch the article page, extract title/author/account/body, repair lazy image URLs, download images by default, and run the WeChat-style Markdown cleanup

Use it for articles, not visual/UI pages. It is not a browser renderer, landing-page archiver, or full DOM snapshot tool.

Article image modes:

- `auto`: download WeChat images; omit ordinary article images
- `download`: download article images under the anything2md asset root
- `remote`: keep remote image URLs
- `none`: omit images

## MinerU Boundary

Use `mineru-open-api extract` for routed high-fidelity local files. The default model is `vlm` because the decoder's purpose is to preserve layout, formulas, tables, images, and OCR text before downstream processing.

Use `--mineru-model pipeline` only when the user explicitly prioritizes no-hallucination reliability over complex-layout fidelity.

Do not use `mineru-open-api crawl` as the default for article URLs or saved HTML drops. Article URLs use the built-in article extractor; saved HTML files are routed to MarkItDown unless the user explicitly asks for MinerU-HTML experimentation.

## Preferred API Boundary

Use local-file conversion by default:

- Python package: `MarkItDown(...).convert_local(path)`
- CLI: `markitdown <path> --output <file.md>`
- MinerU CLI: `mineru-open-api extract <path> --format md --model vlm --output <file.md>`

The bundled `decode.py` script selects MinerU or MarkItDown first, then MarkItDown tries the Python package and falls back to the `markitdown` CLI. Use it through `uv run --python 3.13 --with "markitdown[all]" ...` so the fallback runtime does not fall back to macOS system Python 3.9.

## CLI Surface

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

It also preserves MinerU controls for model, timeout, language, pages, OCR, formula recognition, table recognition, automatic PDF page chunking, chunk concurrency, and retry/backoff behavior, plus article controls for image handling, timeout, and saving extracted HTML.

## Profiles

The generic profile writes `anything2md_decoded` frontmatter and a `anything2md_profile: generic` marker.

The archive profile writes the same neutral marker plus `anything2md_profile: archive`. It is intended for portable knowledge-corpus workflows that need stable metadata, extracted assets, and optional original-file retention.

The default `--profile auto` behaves like generic conversion unless `--knowledge-root`, `--archive-root`, or `--archive-original` is present. Those flags select archive mode automatically because they change where sidecar data and originals are stored.

Archive-related flags:

- `--knowledge-root`
- `--archive-original`
- `--archive-root`

By default, archive mode uses:

```text
<knowledgeRoot>/anything2md/assets/<decoded-name>/
<knowledgeRoot>/anything2md/archive/originals/<sha-prefix>/<sha256>/
<knowledgeRoot>/anything2md/metadata/<decoded-name>.metadata.json
```

Use `--asset-root`, `--archive-root`, or `--metadata-output` to override those locations without changing the decoding logic.

## Deferred Surface

MarkItDown MCP and broad URI conversion are intentionally not the default path. They are useful for local trusted agents, but they widen the read/network surface. Use them only when the user explicitly asks for that execution model and understands the trust boundary.

MinerU web crawling and MinerU-HTML are also not the default path for saved HTML files until timeout/size behavior is better characterized.
