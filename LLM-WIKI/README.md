# LLM-WIKI

CLI-first markdown knowledge-base compiler for building human-governed, Obsidian-compatible LLM wikis.

LLM-WIKI is for people who want a durable knowledge layer from source material without collapsing everything into one giant unreviewed notebook. It turns readable inputs into a structured markdown wiki with raw-source evidence, review surfaces, taxonomy proposals, queryable pages, and optional multi-wiki registry management.

## What problem it solves

Most “AI knowledge base” workflows fail in one of two ways:

1. they are too loose, so generated notes drift away from source evidence
2. they are too monolithic, so every topic gets dumped into one polluted vault

LLM-WIKI takes the opposite stance:

- raw sources are preserved as evidence
- generated structure stays reviewable
- taxonomy and routing decisions remain human-governed
- one giant vault is optional, not required

## What this repository contains

- **CLI compiler** for initializing, ingesting, querying, linting, indexing, and reviewing wiki roots
- **Registry workflow** for managing multiple isolated wikis under one registry
- **Human review surfaces** for taxonomy, routing, profile creation, and bridge decisions
- **OpenClaw-facing skill contract** under `skills/llm-wiki/`
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

LLM-WIKI intentionally treats model-generated classifications, routing suggestions, and profile suggestions as **proposals**, not automatic truth. A human reviews and accepts or rejects them.

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
LLM-WIKI/
├── README.md
├── LICENSE
├── package.json
├── src/
├── tests/
├── skills/
└── dist/
```

Notes:

- `dist/` is build output and is git-ignored
- `node_modules/` is git-ignored
- `vendor/`, `.worktrees/`, `.omx/`, local `knowledge-*`, and `review/` are git-ignored local or reference surfaces

## Design stance

LLM-WIKI is opinionated about a few things:

- source evidence matters
- generated structure should stay inspectable
- routing and taxonomy should remain reviewable
- multiple bounded wikis are often better than one giant wiki
- the durable CLI/core should own state mutation, not a thin agent wrapper

## OpenClaw skill boundary

This repository includes a host-neutral skill contract at `skills/llm-wiki/SKILL.md`.

The skill layer is intentionally thin. The durable logic lives in the TypeScript CLI/core. That keeps the repo usable both as a direct CLI project and as a skill backend.

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

LLM-WIKI is not:

- a hosted SaaS product
- an automatic approval system for model-generated classifications
- a replacement for human curation
- a promise that every knowledge workflow belongs in one shared vault

## License

MIT
