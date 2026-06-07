# anything2md

Standalone skill for converting document-like sources, local article HTML files, trusted article URLs, and trusted Bilibili video URLs to Markdown.

The project root is the skill root: `SKILL.md`, `scripts/`, `references/`, and `evals/` live directly under this directory.

Primary command:

```bash
uv run --python 3.13 --with "markitdown[all]" python scripts/decode.py <source-file> --output <decoded-file.md> --json
```

Routing:

- MinerU for PDF, images, Word, PowerPoint, and Excel.
- Built-in Chinese Bilibili transcript extraction for trusted Bilibili video URLs when `--allow-uri` is passed.
- Built-in article extraction for trusted ordinary article URLs and WeChat public article URLs when `--allow-uri` is passed, plus local saved `.html/.htm` article files.
- MarkItDown for the remaining non-Markdown formats.

Bilibili cookies may be supplied with `--bilibili-cookies` or discovered from a browser, but default metadata records only the redacted source kind. Resolved cookie paths are emitted only with `--include-absolute-paths`.

Bilibili output defaults to Chinese: Chinese subtitles are selected first; if only non-Chinese subtitles are available, the decoder translates them to Chinese with `argos` or `trans` when available and records the translation metadata. Use `--bilibili-translation-backend auto|argos|trans|none` to control that fallback.

Archive mode is available through `--profile archive`, `--knowledge-root`, `--archive-root`, and `--archive-original` when a caller wants stable metadata, assets, and original-file retention under a portable `anything2md/` layout.
