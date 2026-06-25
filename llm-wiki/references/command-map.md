# llm-wiki Command Map

Use this reference after `SKILL.md` has selected the workflow and root kind.

Run commands from the llm-wiki package root:

```bash
npm run --silent cli -- <command> ...
```

`--silent` is required because npm banner text can corrupt JSON stdout.

## Setup

```bash
npm run --silent cli -- init <knowledgeRoot>
npm run --silent cli -- status <knowledgeRoot>
npm run --silent cli -- registry-init <registryRoot>
npm run --silent cli -- registry-add <registryRoot> [knowledgeRoot] --id <wikiId> [--title <title>] [--scope <csv>] [--scope-core <csv>] [--scope-adjacent <csv>] [--out-of-scope <csv>] [--alias <csv>]
npm run --silent cli -- registry-list <registryRoot>
```

Use `registry-add` without `knowledgeRoot` to create `wikis/<wikiId>` under the atlas.

## Ingest And Inbox

Known target wiki:

```bash
npm run --silent cli -- ingest <knowledgeRoot> [sourcePathOrUrl] --quality <quality.json> --curation <curation.json> [--recompile]
npm run --silent cli -- ingest <knowledgeRoot> --okf <bundleDir> [--auto-index]
npm run --silent cli -- ingest-inbox <knowledgeRoot>
```

`ingest` and `ingest-inbox` require an explicit quality plan and semantic curation plan for ordinary source material. Read the normalized source and provide:

- `llm-wiki.inbox-quality.v1` with `--quality <quality.json>` or sidecar `<source>.quality.json`
- `llm-wiki.semantic-curation.v1` with `--curation <curation.json>` or sidecar `<source>.curation.json`

The quality plan runs first. It decides accept/reject/park/convert/merge based on duplicate status, readability, junk/noise risk, durable knowledge value, and exact source evidence. Only `decision: "accept"` continues to curation and ingest. A source is worth ingesting only when it improves future reading, retrieval, synthesis, or governance; topic relevance alone is not enough. `knowledgeValue: "none"` cannot be accepted. `knowledgeValue: "low"` should park or reject by default and requires an explicit `overrideReason` before ready accept. Missing, invalid, or non-accept quality returns `needs_review`; the runtime must not ingest first and leave cleanup for govern. Missing or invalid curation also returns `needs_review`; the runtime must not fall back to heuristic entity/concept extraction.

Use `--recompile` only for already-ingested sources when the source content is unchanged but the curation plan changed, such as semantic-page cleanup followed by re-curation. It recompiles the same source identity with the new plan instead of treating unchanged content as a dedup skip.

Atlas-level unclassified inbox:

```bash
npm run --silent cli -- intake-scan <registryRoot>
npm run --silent cli -- intake-status <registryRoot>
npm run --silent cli -- intake-next <registryRoot>
npm run --silent cli -- route <registryRoot> <sourcePathOrUrl>
npm run --silent cli -- route-inbox <registryRoot>
npm run --silent cli -- route-accept <registryRoot> <proposalId> [--wiki <wikiId>] [--reviewer <name>] --quality <quality.json> --curation <curation.json>
npm run --silent cli -- intake-reject <registryRoot> <itemId> --reviewer <name> --reason <reason>
npm run --silent cli -- intake-park <registryRoot> <itemId> --reviewer <name> --reason <reason>
```

`ingest`, `ingest-inbox`, and approved `route-accept` should leave accepted material wiki-ready: raw evidence archived, a Chinese source card written, a full reading mirror created under `wiki/readings`, curation-backed entity/concept/synthesis pages materialized when source evidence justifies them, generated navigation overviews refreshed, and retrieval/index freshness reported. Do not treat missing semantic curation as normal completion.

Generated `wiki/syntheses/wiki-topic-overview.md` pages are Obsidian navigation overviews. They list sources and knowledge entrances, but they are not promoted research conclusions and should not replace query source-reading evidence.

`route-accept` ingests into the target wiki and closes the associated intake item when successful. Do not run `intake-complete` as a second public review step for that accepted source. Use `intake-reject` or `intake-park` only when the user approved that outcome.

`intake-complete` remains available for explicit manual closure or repair cases:

```bash
npm run --silent cli -- intake-complete <registryRoot> <itemId> [--reviewer <name>]
```

## Non-Markdown Decode Before Ingest

Before touching PDF/DOCX/PPTX/images/etc. with llm-wiki ingest or route:

```bash
python3 scripts/skill_discovery.py anything2md --json
python3 scripts/decoder_handoff.py <resolvedRoot> <sourcePath> --anything2md-root <anything2mdSkillRoot>
# run the returned shellCommand
npm run --silent cli -- ingest <knowledgeRoot> <decodedMarkdownPath> --quality <quality.json> --curation <curation.json>
```

If the document is an atlas-level unclassified drop, decode first and route the decoded Markdown derivative. Keep the original under `raw/objects`; do not put tool-specific top-level output directories into an llm-wiki root.

## Query

Default workflow:

```bash
python3 scripts/query_handoff.py "<question>" --reading-mode <passage|document> --json
# run returned recommendedCommand
```

Direct commands:

```bash
npm run --silent cli -- query <knowledgeRoot> <question> [--no-hyde] [--reading-mode <passage|document>] [--full]
npm run --silent cli -- query-registry <registryRoot> <question> [--reading-mode <passage|document>] [--full]
npm run --silent cli -- query-readiness <knowledgeRootOrRegistryRoot>
```

Classify the question yourself before this handoff. If classification is unclear, ask the user before retrieval. Use default output for answering. Use `--full` only for diagnostics, searched-wiki details, full citations, or debugging retrieval quality.

Promotion is approval-gated:

```bash
npm run --silent cli -- save-synthesis <knowledgeRoot> <suggestionId> --confirm
```

Run it only after source-backed query evidence, durable reuse value, and explicit user approval.

## Maintenance

```bash
npm run --silent cli -- maintain <knowledgeRootOrRegistryRoot>
npm run --silent cli -- lint <knowledgeRoot>
npm run --silent cli -- index <knowledgeRoot>
npm run --silent cli -- wiki-overview <knowledgeRoot>
npm run --silent cli -- embed-index <knowledgeRoot>
```

`maintain` accepts either a single wiki root or a registry root. For a registry root, it maintains registered wikis rather than treating the registry as one wiki.

`maintain` also repairs historical source-card-only entries when the dedup manifest points to managed raw evidence. It backfills deterministic assets such as missing `wiki/readings` pages and indexes. It must not invent entity/concept/synthesis pages; those require a source-backed curation plan and a fresh ingest/route acceptance.

Run `query-readiness` when the issue is stale indexes, missing vectors, embedding model drift, or unclear retrieval coverage.

## Dedup

```bash
npm run --silent cli -- dedup <knowledgeRoot> check <sourcePath>
npm run --silent cli -- dedup <knowledgeRoot> pending
npm run --silent cli -- dedup <knowledgeRoot> stats
npm run --silent cli -- dedup <knowledgeRoot> scan
npm run --silent cli -- dedup <knowledgeRoot> decide <decisionId> --decision <skip|update|keep_both|ingest> --reviewer <name> [--note <note>]
npm run --silent cli -- dedup <knowledgeRoot> merge <sourceRef> <targetRef> --confirm merge --reviewer <name> [--note <note>]
npm run --silent cli -- dedup <knowledgeRoot> backfill
```

Use `dedup check` before manually re-ingesting suspicious Markdown/text. If ingest returns a pending dedup decision, show the user the suspected duplicate and run `dedup decide` only after approval.

Use `dedup backfill` after runtime migrations that add new ledger state. It rebuilds `system/dedup/content-index.db` from existing manifests and chunks without re-ingesting sources or rewriting pages.

## Governance

Taxonomy:

```bash
npm run --silent cli -- taxonomy-list <knowledgeRoot>
npm run --silent cli -- taxonomy-accept <knowledgeRoot> <proposalSlug> --reviewer <name>
npm run --silent cli -- taxonomy-reject <knowledgeRoot> <proposalSlug> --reviewer <name> [--reason <reason>]
```

Profiles:

```bash
npm run --silent cli -- profile-suggest <registryRoot> (--from <itemId> | --source <pathOrUrl>) [--id <wikiId>] [--title <title>]
npm run --silent cli -- profile-accept <registryRoot> <proposalId> --reviewer <name> [--reason <reason>]
npm run --silent cli -- profile-reject <registryRoot> <proposalId> --reviewer <name> --reason <reason>
npm run --silent cli -- profile-review <registryRoot>
```

Bridges:

```bash
npm run --silent cli -- bridge-list <registryRoot>
npm run --silent cli -- bridge-targets <registryRoot> <proposalId>
npm run --silent cli -- bridge-accept <registryRoot> <proposalId> --target <wikiId>/<section>/<slug> --reviewer <name> [--reason <reason>]
npm run --silent cli -- bridge-create-landing <registryRoot> <proposalId> --slug <slug> --reviewer <name> [--section bridges] [--reason <reason>]
npm run --silent cli -- bridge-reject <registryRoot> <proposalId> --reviewer <name> --reason <reason>
npm run --silent cli -- bridge-index <registryRoot>
```

All accept/reject commands are human-approval surfaces. Do not run them merely because the CLI generated a high-confidence proposal.

## Interchange

```bash
npm run --silent cli -- export-bundle <knowledgeRoot> --okf <outputDir> [--archive <archivePath>]
npm run --silent cli -- ingest <knowledgeRoot> --okf <bundleDir> [--auto-index]
```

## Mutation Validation

For any mutation:

1. Run the requested operation.
2. Inspect the command result, especially `index`, `embedding`, `dedupDecision`, and proposal state.
3. Run the smallest useful validation:
   - `status` for setup/readiness;
   - `lint` for wiki health;
   - `index` for retrieval/graph freshness;
   - `query-readiness` for query substrate freshness and vector coverage.
4. Report changed files, review gates, validation evidence, and remaining risks.
