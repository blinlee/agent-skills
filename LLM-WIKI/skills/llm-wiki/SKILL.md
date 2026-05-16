---
name: llm-wiki
description: Build, ingest, organize, query, lint, repair, review, and promote an LLM-WIKI knowledge root through the LLM-WIKI CLI. Use this whenever the user asks to create or maintain an Obsidian-compatible AI wiki, ingest raw sources or raw/inbox, classify or review knowledge, manage backlinks/indexes/taxonomy, detect raw-source drift, answer questions from a wiki, promote syntheses, audit wiki health, or work with LLM-WIKI/karpathy/Hermes-style wiki workflows. Do not use for generic markdown editing unless an LLM-WIKI knowledge root or layout is involved.
license: MIT
metadata:
  version: 0.4.0
  platforms: [linux, macos, windows]
  tags: [wiki, knowledge-base, markdown, obsidian, compiler, cli, raw-evidence]
  category: research
---

# LLM-WIKI Skill

Use this skill to operate an LLM-WIKI knowledge root through the repo CLI. The CLI/core is the mutation surface; choose the right command, preserve review gates, and report validation evidence.

## First orient yourself

For existing roots, inspect these before mutation when useful:

1. `wiki/SCHEMA.md` — local conventions, review policy, page thresholds.
2. `wiki/index.md` — durable page catalog.
3. `wiki/log.md` — recent mutations and query history.
4. `review/queue/` and `taxonomy/proposals/` — unresolved review items.

Distinguish the **package root** where `npm run --silent cli -- ...` runs from the **knowledge root** passed to the CLI.

## Task map

- **Create/setup wiki** → `init`, then `status`.
- **Create/setup atlas registry** → `registry-init <registryRoot>`, then `registry-list <registryRoot>`.
- **Register an isolated wiki** → `registry-add <registryRoot> [knowledgeRoot] --id <wikiId> --scope <terms>`; omit `knowledgeRoot` to create `wikis/<wikiId>` under the atlas. Prefer concise seed profiles; let later profile proposals refine boundaries.
- **Route source for a personal atlas** → `intake-scan <registryRoot>` / `intake-next <registryRoot>` for dropped files in `raw/inbox`, then `route <registryRoot> <sourcePathOrUrl>` or `route-inbox <registryRoot>`; return the route/profile/classification package to the user and ask for approval before ingest.
- **Accept route** → `route-accept <registryRoot> <proposalId> [--wiki <wikiId>] [--reviewer <name>]`, then lint/index the accepted target wiki and close the intake item with `intake-complete`, `intake-park`, or `intake-reject`.
- **Profile boundary work** → `profile-suggest`, `profile-accept`, `profile-reject`, and `profile-review`; profiles evolve through explicit proposals, never silent drift.
- **Review cross-wiki bridges** → `bridge-list`, then `bridge-accept` or `bridge-reject`; accepted bridges append explicit `llm-wiki://<wikiId>/<section>/<slug>` links to generated wiki pages. Run `bridge-index` after bridge edits.
- **Ingest one source into a known target wiki** → `ingest <root> <sourcePathOrUrl>`, then `lint`. Use this only when the target wiki is already explicit or user-approved.
- **Ingest dropped files into a known wiki** → if the user says files are in a specific wiki root's `raw/inbox`, run `ingest-inbox <root>` or `ingest <root>` with no input, then `lint`. For atlas-level unclassified drops, use the intake/route workflow instead.
- **Ask/search one wiki** → `query <root> <question>`; answer from returned citations and say when no evidence matched.
- **Ask/search an atlas** → `query-registry <registryRoot> <question>`; report which wikis were searched and preserve per-wiki citations.
- **Promote reusable answer** → run `query`, then `save-synthesis <root> <suggestionId> --confirm` only when the user clearly wants durable promotion.
- **Build retrieval/graph substrate** → `index <root>` after ingest or repair to write page/chunk/link/backlink indexes.
- **Audit/repair health** → `lint`; fix generated layers (`wiki/`, `review/`, `taxonomy/`, `system/`) as appropriate; rerun `lint`.
- **Review classification** → run `taxonomy-list <root>`, return the proposed operation summary, and ask whether to accept, reject, or edit the plan. Run `taxonomy-accept` or `taxonomy-reject` only after approval.

## Classification principles

When classification is involved, use model judgment inside a controlled knowledge-organization frame:

1. **Wiki boundary = concept scheme.** A wiki is a governance/retrieval boundary, not a folder. Split only when terminology, source standards, retrieval intent, review habits, expected corpus growth, and pollution risk justify an isolated scheme. Otherwise keep the material in one wiki and classify internally.
2. **Primary ownership is singular by default.** Route each source to one primary wiki. Cross-domain sources can list secondary wikis and bridge links, but do not duplicate canonical pages across wikis unless the user explicitly approves duplication.
3. **Categories are curated hierarchy, not free tags.** Place pages in the most specific fitting category path(s); do not also attach redundant parent categories. Category edges must be acyclic and must mean a real broader/narrower, part/whole, instance/type, location/time, agent/work, or other declared relation.
4. **Facets handle multi-axis meaning.** Use controlled facet tags for dimensions that should combine freely, such as method, object/entity, application, source type, evidence status, time/place, and review state. Prefer facets over inventing deep compound categories.
5. **Second/third levels require a stable division principle.** A subcategory needs a clear parent relation, reusable name, scope note, examples, out-of-scope counterexamples, and expected future use. Do not create one-off leaves or arbitrary depth just because a source mentions a phrase.
6. **Intersection categories are exceptional.** A compound category may combine at most two important criteria when the intersection is repeatedly useful. Otherwise express intersections through facets/search/indexes.
7. **Controlled vocabulary beats synonym drift.** Keep one preferred label per concept, record aliases, and use redirects/disambiguation for competing terms. Do not create parallel categories for synonyms.
8. **Never force weak matches.** If no profile/category fits strongly, propose a bounded new wiki/profile/category, park for later, reject/convert the source, or ask for a user override. Do not silently broaden an existing profile.
9. **New profile/category proposals need evidence.** Show existing mismatch evidence, satisfied creation criteria, proposed parent/related concepts, aliases, scope notes, risks of too broad/too narrow boundaries, and concrete review questions.
10. **Links are semantic relationships, not classification shortcuts.** Use wikilinks/backlinks for concept relationships, citations, contrasts, dependencies, applications, and evidence trails. Use cross-wiki `llm-wiki://...` links for bridges between schemes.
11. **Historical decisions calibrate future classification.** Use accepted/rejected routes, taxonomy decisions, aliases, and `profile-review` to suggest boundary repairs, but never let profiles or category graphs drift automatically.

Standard atlas flow: `intake-scan` → `intake-next` → `route`/`route-inbox` → return `decisionType`, candidates, evidence, risks, review questions, `classificationPackage` (primary wiki, secondary wikis, proposed category path, facet tags, aliases, related pages/concepts, bridge/link suggestions, new profile/category proposals) and any `newWikiProposalId` → ask the user to approve one next operation → run the approved `route-accept`, `profile-accept`, `bridge-accept`, `taxonomy-accept`, `intake-park`, or `intake-reject`. Do not skip the approval step for review-gated operations.

## Mandatory deterministic steps

Run commands from the package root and keep JSON stdout clean:

```bash
npm run --silent cli -- init <knowledgeRoot>
npm run --silent cli -- ingest <knowledgeRoot> [sourcePathOrUrl]
npm run --silent cli -- ingest-inbox <knowledgeRoot>
npm run --silent cli -- query <knowledgeRoot> <question>
npm run --silent cli -- lint <knowledgeRoot>
npm run --silent cli -- index <knowledgeRoot>
npm run --silent cli -- taxonomy-list <knowledgeRoot>
npm run --silent cli -- taxonomy-accept <knowledgeRoot> <proposalSlug> --reviewer <name>
npm run --silent cli -- taxonomy-reject <knowledgeRoot> <proposalSlug> --reviewer <name> [--reason <reason>]
npm run --silent cli -- status <knowledgeRoot>
npm run --silent cli -- save-synthesis <knowledgeRoot> <suggestionId> --confirm
npm run --silent cli -- registry-init <registryRoot>
npm run --silent cli -- registry-add <registryRoot> [knowledgeRoot] --id <wikiId> [--title <title>] [--scope <csv>] [--scope-core <csv>] [--scope-adjacent <csv>] [--out-of-scope <csv>] [--alias <csv>]
npm run --silent cli -- registry-list <registryRoot>
npm run --silent cli -- intake-scan <registryRoot>
npm run --silent cli -- intake-status <registryRoot>
npm run --silent cli -- intake-next <registryRoot>
npm run --silent cli -- route <registryRoot> <sourcePathOrUrl>
npm run --silent cli -- route-inbox <registryRoot>
npm run --silent cli -- route-accept <registryRoot> <proposalId> [--wiki <wikiId>] [--reviewer <name>]
npm run --silent cli -- intake-complete <registryRoot> <itemId> [--reviewer <name>]
npm run --silent cli -- intake-reject <registryRoot> <itemId> --reviewer <name> --reason <reason>
npm run --silent cli -- intake-park <registryRoot> <itemId> --reviewer <name> --reason <reason>
npm run --silent cli -- profile-suggest <registryRoot> [--from <itemId>] [--source <pathOrUrl>] [--id <wikiId>] [--title <title>]
npm run --silent cli -- profile-accept <registryRoot> <proposalId> --reviewer <name> [--reason <reason>]
npm run --silent cli -- profile-reject <registryRoot> <proposalId> --reviewer <name> --reason <reason>
npm run --silent cli -- profile-review <registryRoot>
npm run --silent cli -- bridge-list <registryRoot>
npm run --silent cli -- bridge-accept <registryRoot> <proposalId> --reviewer <name> [--reason <reason>]
npm run --silent cli -- bridge-reject <registryRoot> <proposalId> --reviewer <name> --reason <reason>
npm run --silent cli -- bridge-index <registryRoot>
npm run --silent cli -- query-registry <registryRoot> <question>
```

For any mutation (`init`, `registry-add`, `intake-scan`, `route-inbox`, `route-accept`, `intake-complete`, `intake-park`, `intake-reject`, `profile-accept`, `profile-reject`, `taxonomy-accept`, `taxonomy-reject`, `ingest`, `ingest-inbox`, `save-synthesis`, `index`, manual repair):

1. Run the requested operation.
2. Run the smallest useful validation, normally `lint`; add `index` when retrieval/graph freshness matters and `status` for setup/readiness questions.
3. Report changed files, review gates, and validation result.

## Governance rules

- Per-wiki `raw/inbox` is a known-target dropzone; atlas-level `raw/inbox` is only an unclassified source dropzone and should stay nearly empty. `intake-scan` moves atlas drops into sharded `raw/objects/<sha-prefix>/<sha>/...` and records sha256/status/object path in `system/intake/items/<itemId>.json` so scheduled agents can find pending work from the ledger and exit silently when none exists. Managed per-wiki `raw/staged`, `raw/archive`, and `raw/rejected` are also sharded immutable evidence areas with sha256 frontmatter and manifest tracking.
- Do not directly edit managed raw files. Corrections, notes, synthesis, and repair belong in generated `wiki/`, `review/`, `taxonomy/`, or `system/` layers.
- Model-generated source categories, wiki routing, topics, tags, target folders, entity/concept assignments, bridge links, merges, and backlinks are proposals until approved. Return the proposal summary and planned command, then wait for explicit approval before executing accept/reject/promote commands.
- High confidence is not approval; high model confidence is still only a proposal signal.
- Query outputs are not durable wiki knowledge unless promoted.
- For broad personal encyclopedia use, prefer multiple bounded wiki roots plus a registry. Do not silently ingest unrelated domains into one large wiki just because the source is parseable.

For deeper rationale and risk controls, read `references/governance.md` only when working on review policy, raw integrity, classification, or audit behavior.

## Gotchas

- Always include `--silent`; npm banner text can corrupt machine-readable JSON output.
- `ingest <root>` with no source means ingest the root's `raw/inbox`.
- Do not confuse source paths with wiki page slugs; let the CLI resolve slugs and collisions.
- Do not fix raw drift by editing the raw file to match expectations; preserve raw and repair downstream generated knowledge.
- Bare wikilinks can become ambiguous; prefer qualified links like `[[sources/foo|Foo]]`.
- A polished page is not necessarily verified; check `confidence`, `contested`, review records, and citations.
- Large roots need retrieval discipline: use `query`/search and heed lint scale warnings instead of reading only `wiki/index.md`.
- Registry routing, intake ledger state, and taxonomy listing are deterministic and auditable in the MVP; they are review aids, not proof that the classification is correct.
- Cross-wiki links must be explicit `llm-wiki://<wikiId>/<section>/<slug>` bridge links; do not pretend they are local Obsidian links.

## Report format

Use this concise structure after work:

```text
Command(s): <commands run>
Knowledge root: <path>
Result: <what changed or what was answered>
Files: <created/updated/review files, if available>
Review gates: <pending proposals, review items, or none>
Validation: <lint/status/build result with evidence>
Remaining risks: <only material gaps>
```

If no mutation was made, omit `Files` and state the evidence source instead.
