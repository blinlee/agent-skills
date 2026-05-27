# anything2md

Standalone skill for converting document-like sources to Markdown.

The project root is the skill root: `SKILL.md`, `scripts/`, `references/`, and `evals/` live directly under this directory.

Primary command:

```bash
uv run --python 3.13 --with "markitdown[all]" python scripts/decode.py <source-file> --output <decoded-file.md> --json
```

Routing:

- MinerU for PDF, images, Word, PowerPoint, and Excel.
- MarkItDown for the remaining non-Markdown formats.

Archive mode is available through `--profile archive`, `--knowledge-root`, `--archive-root`, and `--archive-original` when a caller wants stable metadata, assets, and original-file retention under a portable `anything2md/` layout.
