---
name: llm-wiki
description: Operate an llm-wiki knowledge root or atlas registry through the llm-wiki CLI. Use this skill whenever the user asks to set up, ingest into, query, maintain, govern, route, classify, search, or answer from an llm-wiki/wiki/atlas knowledge base, even if they do not write `/llm-wiki`. Use for raw inbox processing, RAG/source-reading queries, root sharing across agents, embedding/index maintenance, taxonomy/profile/bridge governance, and synthesis promotion. Non-Markdown documents must be decoded through /anything2md before llm-wiki ingest/route. Do not use for generic Markdown editing outside an llm-wiki root.
license: MIT
metadata:
  version: 0.4.1
  platforms: [linux, macos, windows]
  tags: [wiki, knowledge-base, markdown, obsidian, compiler, cli, raw-evidence]
  category: research
---

# llm-wiki Skill

Use this skill to operate an llm-wiki knowledge root or atlas registry through the package CLI. The CLI/core is the mutation surface; the agent chooses the right workflow, preserves approval gates, and reports validation evidence.

## Resolve Root First

Before any llm-wiki command, identify the local root for this run:

- **knowledge root**: one wiki, used by `init`, `ingest`, `query`, `lint`, `index`, taxonomy commands, and most per-wiki maintenance.
- **registry root**: atlas of wikis, used by `registry-*`, `intake-*`, `route-*`, `bridge-*`, `profile-*`, and `query-registry`.

Resolution order:

1. Use the root explicitly provided by the user.
2. Otherwise use `llm_wiki_root` from the current environment.
3. Otherwise read the host-local default:

```bash
python3 scripts/root_config.py show --strict --require-existing
```

4. If no root is available, stop before running llm-wiki commands and ask for the local wiki/registry root. When the user provides one, save it back to host-local config unless they explicitly say not to:

```bash
python3 scripts/root_config.py set <root> --kind <knowledge|registry|unknown>
```

The saved default is shared host-local state for Codex, Claude, OpenClaw, and other agents on the same machine. Never commit a personal absolute root into this skill or the repo.

## Public Workflows

Resolve the root first for all five workflows.

- `/llm-wiki setup` -> connect or create a root. Use `init`/`status` for one wiki, or `registry-init`/`registry-list` for an atlas.
- `/llm-wiki inbox` -> process new raw material end to end. Inspect `raw/inbox`, decode non-Markdown files with `/anything2md`, route or ingest through the CLI, present the batch's placement/linking decisions in user-facing terms, and execute only the human-approved accept/reject/park/override operation. A completed inbox pass leaves the new batch accepted, rejected, or explicitly parked.
- `/llm-wiki query <question>` -> run the retrieval workflow before answering. Start with `python3 scripts/query_handoff.py "<question>" --json`, execute the returned `recommendedCommand`, and answer only from the returned source-reading pack. Follow `references/rag-query-workflow.md`.
- `/llm-wiki maintain` -> refresh derived maintenance artifacts and health/freshness state. Run `maintain <knowledgeRootOrRegistryRoot>` plus focused `status`, `lint`, `index`, or `query-readiness` checks when relevant. Report problems; do not perform broad repair unless asked.
- `/llm-wiki govern` -> manage knowledge organization: registry membership, profile boundaries, taxonomy/category decisions, bridge links, and routing policy review. Use governance commands while preserving approval gates.

## Command Map

Run commands from the package root and keep JSON stdout clean with `npm run --silent cli -- ...`.

For exact commands and subcommand details, read `references/command-map.md` when you need to execute anything beyond the short workflow bullets above.

Core command families:

- setup/status: `init`, `status`, `registry-init`, `registry-list`, `registry-add`
- ingest/inbox: `ingest`, `ingest-inbox`, `intake-scan`, `intake-status`, `intake-next`, `route`, `route-inbox`, `route-accept`
- query: `query`, `query-registry`, `query-readiness`, `save-synthesis`
- maintenance: `maintain`, `lint`, `index`, `wiki-overview`, `embed-index`, `dedup *`
- governance: `taxonomy-*`, `profile-*`, `bridge-*`
- packaging/interchange: `export-bundle`, `ingest --okf`

For any mutation, run the requested command, then the smallest useful validation. Normally use `lint`; add `index` when retrieval/graph freshness matters, `status` for setup/readiness questions, and `query-readiness` for query substrate concerns. For ingest/route acceptance, inspect returned index and embedding summaries first.

## Query Hard Gate

Never answer an llm-wiki question from source inspection, README reading, architecture memory, or implementation recall alone. Retrieval comes first.

Default query output is intentionally compact:

- `question`
- `answerability`
- `readiness`
- `sourceReadingPack`

Use `sourceReadingPack.passages[]` as the factual reading payload. If `sourceReadingPack.readingMode === "document"`, use `sourceReadingPack.documents[]` as the concise original-document reading list for survey/framework/landscape questions. Use `--full` only for diagnostics.

Final RAG evidence for agents must be original source text or exact original-source fragments whenever raw-backed evidence exists. `wiki-overview`, `key_info`, taxonomy, graph, review, and ledger artifacts are routing/context layers, not final factual passages.

## Classification And Governance Gates

Classification is semantic judgment plus auditable CLI state. The CLI route result is a candidate generator, not proof.

For atlas routing, profile boundaries, taxonomy/category placement, bridge decisions, or disputed classification, read `references/classification-review.md` before recommending an approval action.

Hard gate: do not run `route-accept`, `profile-accept`, `bridge-accept`, `taxonomy-accept`, `intake-complete`, `intake-park`, `intake-reject`, `dedup decide`, `dedup merge`, or `save-synthesis --confirm` until the user explicitly approves the proposed action.

Use user-facing terms in Chinese by default for inbox/govern reports:

- suggested home, not `route proposal`
- new or adjusted boundary, not `profile proposal`
- suggested category structure, not `taxonomy proposal`
- suggested cross-link, not `bridge proposal`

Keep proposal ids and exact commands in a short operator note only when needed.

## Non-Markdown Input

Non-Markdown local documents are not direct llm-wiki ingest inputs. Verify `/anything2md` exists, then use `scripts/decoder_handoff.py` to archive the original under `raw/objects` and create a decoded Markdown derivative. Route/ingest only the decoded Markdown.

```bash
python3 scripts/skill_discovery.py anything2md --json
python3 scripts/decoder_handoff.py <resolvedRoot> <sourcePath> --anything2md-root <anything2mdSkillRoot>
```

If `/anything2md` is missing, stop and report that dependency. Do not create placeholder Markdown and do not run ingest/intake/route on the original PDF/DOCX/etc.

## Optional Retrieval Substrates

Embedding, HyDE, rerank, query expansion, key-info extraction, entity extraction, and wiki overview are optional host-local or derived substrates. They improve retrieval but do not replace source evidence or approval gates.

Read `references/embedding-provider.md` before configuring or claiming embedding contribution. A successful `embed-index` alone is not proof query used embeddings; verify query result signals.

## Gotchas

- Always include `--silent`; npm banner text can corrupt machine-readable JSON output.
- Distinguish the package root from the knowledge/registry root passed to the CLI.
- Do not infer personal paths from examples, prior sessions, or repo history.
- `ingest <root>` with no source means ingest that root's `raw/inbox`.
- `route-accept` on an intake item now closes the successful inbox item; remaining taxonomy/bridge/profile proposals belong to govern/maintain surfaces.
- Do not edit managed raw files to fix drift. Preserve raw evidence and repair generated layers.
- Do not expect ingest to create durable entity/concept pages from candidates; approval creates durable semantic pages.
- Do not promote a query answer just because it reads well. Promotion needs source-backed evidence, durable reuse value, and explicit user approval.
- Embedding caches are rebuildable retrieval artifacts under `system/index/embeddings/`; they are not canonical knowledge and are not required for basic query.
- Cross-wiki links must be explicit `llm-wiki://<wikiId>/<section>/<slug>` bridge links.

## Report Format

```text
Command(s): <commands run>
Knowledge root: <path>
Result: <what changed or what was answered>
Files: <created/updated/review files, if available>
Review gates: <pending proposals, review items, or none>
Validation: <lint/status/build/query-readiness result with evidence>
Remaining risks: <only material gaps>
```

If no mutation was made, omit `Files` and state the evidence source instead.
