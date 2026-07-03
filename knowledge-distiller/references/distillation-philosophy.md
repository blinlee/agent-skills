# Distillation Philosophy

## Core Definition

Knowledge distillation is not shortening. It is full-corpus, high-fidelity restructuring: the agent reads the source material, filters non-knowledge noise, reconciles repetition and contradiction, and rebuilds the material into reusable, source-backed knowledge assets.

## The Nine Laws

### 1. Full-Corpus Coverage

Do not distill from partial reading unless the user explicitly asks for a sample pass. Every readable source in scope must be semantically reviewed by the agent, even when deterministic scripts created the manifest and chunks.

For large corpora, read in batches, but keep one coverage ledger. If a file, section, or chunk cannot be read, record it as an access or coverage gap. Never silently skip material.

### 2. LLM-Led Understanding

Scripts may discover files, assign ids, chunk text, scaffold sidecars, and validate references. They must not decide what the knowledge means.

The agent must perform semantic reading, evidence selection, concept extraction, contradiction judgment, layer assignment, modeling, and asset writing.

### 3. High-Fidelity Restructuring

Preserve examples, caveats, boundary cases, exceptions, contradictions, vivid source phrasing, operational details, and minority cases when they carry meaning.

When output must be concise, move detail into evidence indexes, appendices, or Source Pack sidecars. Do not delete important detail just to make the synthesis cleaner.

### 4. Clean Before Modeling

Filter source-production noise before extracting knowledge: headers, footers, page numbers, watermarks, downloader ads, repeated logos, OCR edge text, decorative remnants, platform boilerplate, and unrelated disclaimers.

Ambiguous fragments should be quarantined with a reason, not silently deleted or promoted into rules.

### 5. Deduplicate by Meaning

Merge only when ideas have the same meaning, role, and context. Do not merge because words look similar.

Keep variants when wording, scope, emphasis, source context, or failure mode differs. Repetition can be evidence of importance, but repeated page furniture is still noise.

### 6. Contradictions Are Assets

Internal inconsistency is normal in real materials. Preserve and classify it instead of forcing one clean doctrine.

Common treatments:

- `coexist`: both are valid in different contexts.
- `bounds`: one limits when the other applies.
- `refines`: one sharpens or narrows the other.
- `supersedes`: later or stronger evidence replaces earlier framing.
- `unresolved`: the corpus does not support a clean resolution.

### 7. Layer Before Anchoring

Move from evidence to observation, pattern, mechanism, principle, and anchor. Do not jump straight from a quote or tactic to a slogan.

An anchor is valid only when it is attached to a principle, mechanism, boundary, and source evidence.

### 8. Assets Over Reports

The durable output is the asset set, not the delivery report. Reports explain the run. `knowledge-assets/` stores reusable judgment.

Use stable asset ids, source ids, evidence levels, confidence, status, relations, conflicts, and update links so future agents can retrieve and revise the knowledge without rereading the report.

### 9. Source-Led, Not Source-Worship

Use the corpus as primary evidence, but do not treat it as scripture. Older or context-bound sources may contain claims that were correct then but are now outdated, incomplete, or misleading.

The agent may use its own knowledge to correct, narrow, or supplement final assets when that makes the reusable knowledge more accurate. The intervention must be explicit: keep the source claim, the agent assessment, and the corrected or supplemented asset wording separate.

When the domain is highly time-sensitive, LLM prior knowledge is enough to flag risk, but not enough to prove current fact. Mark such assets `needs-verification` unless current evidence or user-provided newer material supports the update.

## Coverage Standard

A report-grade distillation must state:

- sources included
- sources or chunks not read
- batching strategy if the corpus was large
- noise handling
- duplicate handling
- contradiction handling
- currentness/context review
- any LLM correction or supplementation recorded in a ledger or report
- compression or deferral choices

If coverage is incomplete, label the output as partial and do not present it as the corpus doctrine.
