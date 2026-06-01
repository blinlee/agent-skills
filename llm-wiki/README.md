# llm-wiki

CLI-first markdown knowledge-base compiler for building human-governed, Obsidian-compatible llm-wiki knowledge bases.

llm-wiki is for people who want a durable knowledge layer from source material without collapsing everything into one giant unreviewed notebook. It turns readable inputs into a structured markdown wiki with raw-source evidence, review surfaces, taxonomy proposals, queryable pages, and optional multi-wiki registry management.

## What problem it solves

Most “AI knowledge base” workflows fail in one of two ways:

1. they are too loose, so generated notes drift away from source evidence
2. they are too monolithic, so every topic gets dumped into one polluted vault

llm-wiki takes the opposite stance:

- raw sources are preserved as evidence
- generated structure stays reviewable
- taxonomy and routing decisions remain human-governed
- one giant vault is optional, not required

## What this repository contains

- **CLI compiler** for initializing, ingesting, querying, linting, indexing, and reviewing wiki roots
- **Registry workflow** for managing multiple isolated wikis under one registry
- **Human review surfaces** for taxonomy, routing, profile creation, and bridge decisions
- **OpenClaw-facing skill contract** at `SKILL.md`
- **TypeScript implementation and tests** for the durable core
- **`AGENTS.md` contributor guidance** for agent-assisted development workflows

## Core concepts

### Knowledge root

A knowledge root is a bounded wiki workspace created by `init`. It includes:

- wiki pages and schema files
- raw source intake and manifests
- review and taxonomy state
- system indexes and logs

### Registry root

A registry root lets you manage multiple bounded wikis instead of forcing everything into one vault. This is useful when topics should stay isolated but still be queryable through a shared operating layer.

### Human-governed proposals

llm-wiki intentionally treats model-generated classifications, routing suggestions, and profile suggestions as **proposals**, not automatic truth. A human reviews and accepts or rejects them.

## Environment requirements

| Item | Version / expectation | Why |
| --- | --- | --- |
| Node.js | >= 22 | required for the TypeScript CLI and test toolchain |
| npm | recent version recommended | used for install, build, and test commands |
| Git | recommended | useful for versioning generated wiki roots and project changes |

No database service, vector store, or Obsidian install is required to run the core CLI.

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

## Test

```bash
npm test
```

## Quick start

### Agent workflow triggers

When used as a skill from this repository root, llm-wiki exposes six stable user-facing workflows:

| Trigger | Use it for |
| --- | --- |
| `/llm-wiki setup` | Connect to or initialize a local knowledge root or registry root. If no root is known, the agent asks for one and can save it as a host-local default. |
| `/llm-wiki inbox` | Inspect `raw/inbox`, decode non-Markdown drops, ingest or route new material, and surface review-gated decisions. |
| `/llm-wiki query <question>` | Ask the current wiki or registry with citation-grounded answers. |
| `/llm-wiki review` | Review pending placement and cross-link decisions in user-facing terms, then approve, reject, park, or override them. |
| `/llm-wiki maintain` | Run health and freshness checks such as `status`, `lint`, and `index`. |
| `/llm-wiki govern` | Manage registry membership, profile boundaries, taxonomy, bridges, and routing policy. |

These are skill-level workflow contracts over the CLI commands below, not separate TypeScript subcommands.

The runtime CLI uses the checked-in compiled entrypoint at `dist/src/cli.js`. `npm run --silent cli -- ...`
therefore does not require global `tsx`; install Node dependencies only when developing, rebuilding, or running tests.

The skill resolves the local target root in this order:

1. an explicit path in the request
2. `llm_wiki_root`
3. a host-local config managed by `scripts/root_config.py`
4. if none exists, ask the user for the root and whether to save it locally

Saved defaults are agent-shared host-local state. `scripts/root_config.py set` writes to `$llm_wiki_config` only when that explicit override is set; otherwise it writes the canonical user config path such as `~/.config/llm-wiki/config.json` on Unix/macOS or `%APPDATA%/llm-wiki/config.json` on Windows. `show` also reads `$XDG_CONFIG_HOME/llm-wiki/config.json` and macOS Application Support as compatibility fallbacks. Defaults are not committed to this repository.

### 1. Initialize a knowledge root

```bash
npm run --silent cli -- init ./knowledge
```

### 2. Ingest a source

```bash
npm run --silent cli -- ingest ./knowledge ./tests/fixtures/inputs/sample.md
```

Or ingest everything currently waiting in the inbox:

```bash
npm run --silent cli -- ingest-inbox ./knowledge
```

### 3. Query the wiki

```bash
npm run --silent cli -- query ./knowledge "What is Compiler Notes?"
```

### 4. Lint the wiki

```bash
npm run --silent cli -- lint ./knowledge
```

### 5. Build the local index

```bash
npm run --silent cli -- index ./knowledge
```

### 6. Inspect readiness and job state

```bash
npm run --silent cli -- status ./knowledge
```

## Multi-wiki registry workflow

If you want multiple isolated wikis under one shared operating layer:

### Initialize a registry

```bash
npm run --silent cli -- registry-init ~/my-wikis
```

### Add a wiki profile

```bash
npm run --silent cli -- registry-add ~/my-wikis --id ai --title "AI Wiki" --scope "llm,agent,rag,deep learning"
```

### List registered wikis

```bash
npm run --silent cli -- registry-list ~/my-wikis
```

### Route a new source into the right wiki

```bash
npm run --silent cli -- route ~/my-wikis ~/Downloads/article.md
```

### Ask across registered wikis

```bash
npm run --silent cli -- query-registry ~/my-wikis "What do my notes say about LoRA?"
```

## Non-Markdown documents

The core llm-wiki CLI ingests Markdown/text-like sources. For PDFs, images, Word, PowerPoint, Excel, EPUB/HTML, ZIPs, audio, notebooks, or other document-like formats, use the installed `/anything2md` skill first to produce a Markdown derivative.

The llm-wiki skill enforces this before ingesting or routing non-Markdown drops:

1. verify `/anything2md` is installed with `python3 scripts/skill_discovery.py anything2md --json`
2. run `python3 scripts/decoder_handoff.py <root> <source> --anything2md-root <anything2mdSkillRoot>`
3. run the returned `shellCommand`, which decodes the source without passing `--knowledge-root`
4. continue with the normal llm-wiki ingest, route, review, lint, and index workflow using the returned `decodedMarkdown`

The handoff command stores the original binary, decoded Markdown, converter metadata, and extracted assets under `raw/objects/<sha-prefix>/<sha>/...`. Do not create or use a top-level `<root>/anything2md/` directory inside an llm-wiki root; that layout belongs to standalone anything2md archive mode, not to llm-wiki.

## Command surface

The CLI currently exposes these main command groups:

### Knowledge-root commands

- `init`
- `ingest`
- `ingest-inbox`
- `query`
- `lint`
- `index`
- `taxonomy-list`
- `taxonomy-accept`
- `taxonomy-reject`
- `status`
- `save-synthesis`

### Registry commands

- `registry-init`
- `registry-add`
- `registry-list`
- `intake-scan`
- `intake-status`
- `intake-next`
- `route`
- `route-inbox`
- `route-accept`
- `intake-complete`
- `intake-park`
- `intake-reject`
- `profile-suggest`
- `profile-accept`
- `profile-reject`
- `profile-review`
- `bridge-list`
- `bridge-accept`
- `bridge-reject`
- `bridge-index`
- `query-registry`

Run commands through:

```bash
npm run --silent cli -- <command> ...args
```

`--silent` is recommended because the CLI emits JSON-oriented output and npm prefix noise can interfere with parsing.

## Repository layout

```text
llm-wiki/
├── README.md
├── LICENSE
├── SKILL.md
├── package.json
├── scripts/
├── references/
├── evals/
├── src/
├── tests/
└── dist/
```

Notes:

- `dist/` is checked-in runtime output for the package CLI; rebuild it with `npm run build` after TypeScript changes
- `node_modules/` is git-ignored
- `SKILL.md`, `scripts/`, and `references/` are the root-level skill surface
- `vendor/`, `.worktrees/`, `.omx/`, local `knowledge-*`, and `review/` are git-ignored local or reference surfaces

## Design stance

llm-wiki is opinionated about a few things:

- source evidence matters
- generated structure should stay inspectable
- routing and taxonomy should remain reviewable
- multiple bounded wikis are often better than one giant wiki
- the durable CLI/core should own state mutation, not a thin agent wrapper

## OpenClaw skill boundary

This repository includes a host-neutral skill contract at `SKILL.md`.

The skill layer is intentionally thin. The durable logic lives in the TypeScript CLI/core. That keeps the repo usable both as a direct CLI project and as a skill backend.

The skill is also where the six `/llm-wiki ...` workflows, `/anything2md` handoff, host-local root default, and human approval gates are documented for agents.

`AGENTS.md` is maintainer guidance for agent-assisted contributors. Regular CLI users can ignore it.

## Typical developer workflow

```bash
npm install
npm test
npm run build
npm run --silent cli -- init /tmp/knowledge-demo
npm run --silent cli -- ingest /tmp/knowledge-demo ./tests/fixtures/inputs/sample.md
npm run --silent cli -- query /tmp/knowledge-demo "What is Compiler Notes?"
```

## What this repository is not

llm-wiki is not:

- a hosted SaaS product
- an automatic approval system for model-generated classifications
- a replacement for human curation
- a promise that every knowledge workflow belongs in one shared vault

## License

MIT
