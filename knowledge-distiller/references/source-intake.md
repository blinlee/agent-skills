# Source Intake

## Goal

Build a lightweight Source Pack so later synthesis can cite and re-enter the original material.

The Source Pack is not a substitute for reading. It is the coverage map the agent uses to ensure every readable source in scope receives semantic review.

## Accepted Inputs

- Markdown notes
- Courseware converted to Markdown
- Slide-derived Markdown
- Plain text notes
- Chat or meeting transcripts exported as text
- Project, product, or research logs

For PDFs, DOCX, PPTX, or images, convert them to Markdown first with an appropriate document-conversion skill. This skill starts from local text-like files.

## Source Pack Fields

`source_manifest.json` should contain:

- `id`: stable source id such as `S001`
- `path`: path relative to corpus root
- `title`: first H1 or filename-derived title
- `kind`: file extension or source type
- `line_count`: line count at intake time
- `fingerprint`: sha256 of source bytes

`chunk_index.json` should contain:

- `id`: stable chunk id such as `C00001`
- `source_id`
- `path`
- `heading_path`
- `start_line`
- `end_line`
- `fingerprint`
- `text` unless omitted for size

`evidence_snippets.json` starts as an empty scaffold and is filled by the agent with source excerpts that support final claims.

`concept_table.json` starts as an empty scaffold and is filled by the agent with concepts, layer assignments, variants, source pointers, and confidence.

`relation_notes.json` starts as an empty scaffold and is filled by the agent with concept relations such as duplicate, support, contradiction, refinement, evolution, and prerequisite.

## Intake Rules

- Sort files deterministically by relative path.
- Exclude `.git`, `.omx`, `node_modules`, `__pycache__`, and `source-pack`.
- Prefer line ranges when available. Use chunk ids as fallback anchors.
- Keep paths relative to the corpus root so reports remain portable.
- Treat duplicate-looking files as separate sources until semantic review confirms duplication.
- Do not put semantic conclusions into deterministic scripts. Scripts create stable containers; the agent performs evidence selection, concept extraction, and relation judgment.

## Coverage Rules

- Report-grade distillation requires semantic review of every readable source in the selected scope.
- For large corpora, read in batches but keep one source manifest and one coverage note.
- Do not silently skip files, chunks, appendices, or late sections because early material appears sufficient.
- If a source cannot be read, record the source id, path, reason, and expected impact in the delivery report and `open-questions.md`.
- If the user explicitly asks for a sample, label the result as a sample distillation, not a corpus doctrine.

## Large Corpus Handling

For large folders, process in batches but keep a single manifest. Do not skip files silently. If a source cannot be read, record it as an access issue in the working notes and continue with readable files.
