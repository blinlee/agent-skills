# llm-wiki

CLI-first markdown knowledge-base compiler for source-grounded, human-governed LLM wikis.

llm-wiki turns source material into a durable Markdown wiki with preserved raw evidence, Chinese source cards, full reading mirrors, curation-backed entity/concept/synthesis pages, retrieval indexes, source-reading query output, and optional multi-wiki registry management. It is both a TypeScript CLI package and a skill backend.

## What It Provides

- Knowledge-root setup, ingest, query, lint, index, maintenance, and OKF export/import.
- Registry-root workflows for multiple bounded wikis under one atlas.
- Inbox routing with explicit human approval for accept, reject, park, profile, taxonomy, and bridge decisions.
- Inbox completion that writes directly usable wiki assets: source card, full reading page, curation-backed semantic pages when justified, and indexes.
- Raw-backed RAG retrieval that returns original source passages or concise original-document reading packs.
- Optional embedding, HyDE, query expansion, rerank, entity graph, key-info, wiki overview, and SQLite-backed cache/state surfaces.
- Deduplication workflows for exact, semantic, pending-decision, merge, stats, scan, and historical backfill cases.
- Host-local root configuration shared by Codex, Claude, OpenClaw, and other agents on the same machine.

## Core Concepts

### Knowledge Root

A knowledge root is one bounded wiki workspace. It contains wiki pages, full reading mirrors, raw evidence, manifests, review/proposal state, logs, schemas, and system indexes.

### Registry Root

A registry root is an atlas that manages multiple knowledge roots. Use it when topics should stay isolated but still be discoverable through one query and governance surface.

### Source Evidence

Raw files and decoded originals stay under `raw/`. Generated wiki pages, overviews, indexes, graph context, and proposal ledgers help route and organize knowledge; final query evidence should come from original source text or raw-backed source fragments whenever available.

### Human-Governed Proposals

Model-generated routing, taxonomy, profile, bridge, dedup, and synthesis decisions are proposals until a human approves them. Approval-gated commands require explicit user approval. Ordinary source-card, reading-page, entity-page, and concept-page generation inside an accepted wiki is part of ingest completion, not a separate public review pass.

## Requirements

| Tool | Requirement |
| --- | --- |
| Node.js | >= 22 |
| npm | Used for install, build, test, and CLI wrappers |
| Git | Recommended for source and generated-wiki history |
| Python 3 | Used by skill helper scripts |

The core CLI uses local files and SQLite. It does not require a hosted database, vector service, or Obsidian installation.

## Install And Build

```bash
npm install
npm run build
```

The compiled entrypoint at `dist/src/cli.js` is checked in for skill/runtime handoff:

```bash
npm run --silent cli -- <command> ...args
```

Use `--silent` for JSON-oriented output.

## Skill Workflows

The skill exposes five public workflows:

| Workflow | Purpose |
| --- | --- |
| `/llm-wiki setup` | Resolve, save, initialize, or inspect a knowledge root or registry root. |
| `/llm-wiki inbox` | Process new raw drops, decode non-Markdown sources, write quality and curation plans, route or ingest accepted material, execute approved placement decisions, and finish accepted material as usable wiki pages plus indexes. |
| `/llm-wiki query <question>` | Classify the question, ask for clarification if route is unclear, run `scripts/query_handoff.py --reading-mode <passage|document>`, execute the recommended query command, and answer with broader knowledge plus the returned local source-reading pack. |
| `/llm-wiki maintain` | Refresh deterministic reading/index assets, indexes, overviews, readiness, embedding state, lint/status, and derived maintenance artifacts. |
| `/llm-wiki govern` | Manage registry membership, wiki profiles, taxonomy, bridge links, routing policy, and approval queues. |

The active skill contract is [SKILL.md](SKILL.md). Detailed operator references live in:

- [references/command-map.md](references/command-map.md)
- [references/rag-query-workflow.md](references/rag-query-workflow.md)
- [references/classification-review.md](references/classification-review.md)
- [references/embedding-provider.md](references/embedding-provider.md)
- [references/governance.md](references/governance.md)

## Root Resolution

Skill workflows resolve the target root in this order:

1. Explicit root path from the user.
2. `llm_wiki_root`.
3. Host-local config via `scripts/root_config.py`.
4. User-provided path saved back to host-local config when approved.

```bash
python3 scripts/root_config.py show --strict --require-existing
python3 scripts/root_config.py set <root> --kind <knowledge|registry|unknown>
```

Host-local root config is machine state, not repository state.

## Quick Start

Create and query one wiki:

```bash
npm run --silent cli -- init ./knowledge
npm run --silent cli -- ingest ./knowledge ./tests/fixtures/inputs/sample.md --quality ./sample.quality.json --curation ./sample.curation.json
npm run --silent cli -- query ./knowledge "What is Compiler Notes?"
npm run --silent cli -- lint ./knowledge
```

Process a wiki inbox:

```bash
npm run --silent cli -- ingest-inbox ./knowledge
npm run --silent cli -- maintain ./knowledge
```

Before ingesting ordinary source material, write an `llm-wiki.inbox-quality.v1` JSON plan and an `llm-wiki.semantic-curation.v1` JSON plan with exact source quotes. The quality plan decides accept/reject/park/convert/merge before ingest; only accepted material reaches curation. After a successful inbox pass, accepted sources have generated pages under `wiki/sources`, `wiki/readings`, and any curation-backed `wiki/entities` / `wiki/concepts` / `wiki/syntheses` entries. `govern` is for structural changes, not for finishing ordinary ingestion. `maintain` backfills deterministic reading/index assets when managed raw evidence is present; it does not invent semantic pages.

Create and query a registry:

```bash
npm run --silent cli -- registry-init ./atlas
npm run --silent cli -- registry-add ./atlas --id ai --title "AI Wiki" --scope "llm,agent,rag"
npm run --silent cli -- route ./atlas ./notes/article.md
npm run --silent cli -- route-accept ./atlas <proposalId> --quality ./article.quality.json --curation ./article.curation.json
npm run --silent cli -- query-registry ./atlas "What do my notes say about LoRA?"
```

## Command Surface

### Setup And Status

- `init`
- `status`
- `registry-init`
- `registry-add`
- `registry-list`

### Ingest And Inbox

- `ingest`
- `ingest-inbox`
- `intake-scan`
- `intake-status`
- `intake-next`
- `intake-complete`
- `intake-park`
- `intake-reject`
- `route`
- `route-inbox`
- `route-accept`

### Query And Synthesis

- `query`
- `query-registry`
- `query-readiness`
- `save-synthesis`

Default query output is compact and source-reading oriented. Use returned passages/documents as local wiki evidence, then clearly separate the final answer into what the local wiki supports and what broader domain knowledge adds. Use `--full` for diagnostics.

### Maintenance And Indexing

- `maintain`
- `lint`
- `index`
- `wiki-overview`
- `embed-index`

### Deduplication

- `dedup check`
- `dedup pending`
- `dedup decide`
- `dedup merge`
- `dedup stats`
- `dedup scan`
- `dedup backfill`

### Governance

- `taxonomy-list`
- `taxonomy-accept`
- `taxonomy-reject`
- `profile-suggest`
- `profile-accept`
- `profile-reject`
- `profile-review`
- `bridge-list`
- `bridge-targets`
- `bridge-index`
- `bridge-accept`
- `bridge-create-landing`
- `bridge-reject`

### Packaging And Interchange

- `export-bundle --okf`
- `ingest --okf`

## Non-Markdown Documents

The CLI ingests Markdown/text-like sources. PDFs, images, Word, PowerPoint, Excel, EPUB/HTML, ZIPs, audio, notebooks, and similar document formats should be decoded through the installed `/anything2md` skill before ingest or route.

```bash
python3 scripts/skill_discovery.py anything2md --json
python3 scripts/decoder_handoff.py <root> <source> --anything2md-root <anything2mdSkillRoot>
```

The decoder handoff preserves the original object under `raw/objects/<sha-prefix>/<sha>/...` and returns a Markdown derivative for llm-wiki ingest or routing.

## Retrieval And Embeddings

Retrieval uses Markdown/wiki indexes, raw-backed chunks, lexical signals, optional embeddings, optional HyDE, optional query expansion, optional rerank, graph context, and domain/profile calibration. Embedding caches live under `system/index/embeddings/` and are rebuildable.

For survey/framework questions, query output can use document-reading mode and return a concise set of original documents. For precise questions, query output returns stitched original-source passages.

## Repository Layout

```text
llm-wiki/
├── SKILL.md
├── README.md
├── README.zh-CN.md
├── package.json
├── scripts/
├── references/
├── evals/
├── src/
├── tests/
└── dist/
```

`dist/` is checked-in runtime output for the package CLI. Rebuild it after TypeScript changes.

## Development

```bash
npm install
npm run build
npm test
npm run --silent test:unit
npm run --silent test:query
npm run --silent test:registry
npm run --silent test:embedding
npm run --silent test:smoke
node scripts/main_workflow_smoke.mjs --output /tmp/llm-wiki-main-workflow-smoke.json
```

`scripts/main_workflow_smoke.mjs` exercises setup, inbox, query, maintain, and govern on temporary local roots.

## Boundaries

llm-wiki is not a hosted service, automatic approval system, or replacement for human curation. It is a local, source-preserving knowledge workflow for auditable evidence, controlled organization, and reusable retrieval context.

## License

MIT
