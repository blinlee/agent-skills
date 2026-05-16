# img-gen-pro

GPT Image 2 skill and script toolkit for image generation, image editing, and prompt composition, with a first-class OpenClaw integration layer.

`img-gen-pro` is built for one practical problem: **do not improvise image prompts from scratch when a reusable workflow already exists**. It combines a skill-facing operating contract, a canonical template library, retrieval metadata, and runnable Node.js scripts so the same project can serve both agent workflows and direct command-line usage.

## What this repository contains

- **OpenClaw skill layer**: `SKILL.md` defines how an agent should route image tasks, ask clarifying questions, choose templates, and decide runtime mode.
- **Canonical template library**: `references/` contains reusable image-task templates across posters, UI, products, infographics, architecture diagrams, portraits, editing workflows, and more.
- **Retrieval and composition data**: `data/` holds routing metadata, crosswalks, prompt-intelligence assets, and template-composer profiles.
- **Runnable scripts**: `scripts/` provides prompt composition, runtime detection, generation, editing, and repo health checks.
- **Evaluation and dev assets**: `evals/` and `.dev/` contain maintenance helpers and local evaluation assets.

## Core use cases

`img-gen-pro` supports two direct API actions and one larger workflow layer:

1. **Generate a new image**
2. **Edit an existing image**
3. **Compose a better prompt before either of the above happens**

The project is useful when you want one of these:

- an OpenClaw skill for image tasks
- a reusable GPT Image 2 prompt system
- a scriptable local generation/edit workflow
- a repo of governed prompt templates instead of one-off prompt files

## Runtime modes

The skill routes work through four runtime modes:

| Mode | When it applies | What happens |
| --- | --- | --- |
| A | `ENABLE_GARDEN_IMAGEGEN` is truthy and `OPENAI_API_KEY` is available | `img-gen-pro` can generate or edit images directly through the image API |
| B | direct image API is not used, but the host agent already has its own image tool | `img-gen-pro` composes prompts and the host tool renders |
| C | no host image tool, but Codex CLI is available | `img-gen-pro` composes prompts and prepares a Codex CLI render path |
| D | none of the above are available | `img-gen-pro` falls back to high-quality prompt output only |

## Environment requirements

### Required

| Item | Version / expectation | Why |
| --- | --- | --- |
| Node.js | >= 22 | All scripts are written as modern ESM Node programs |
| Git | recent version recommended | needed for repository workflows and the doctor script |

### Needed only for specific modes

| Item | Needed for | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | Mode A | required for direct image API generation/editing |
| OpenAI-compatible image endpoint | Mode A | defaults to `https://api.openai.com/v1` |
| Codex CLI | Mode C | used only when you want Codex-based render delegation |
| OpenClaw host image tool | Mode B | optional; host-specific |

## Environment variables

| Variable | Required? | Default | Purpose |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Mode A only | none | authenticates image API requests |
| `OPENAI_BASE_URL` | optional | `https://api.openai.com/v1` | overrides the image API base URL |
| `OPENAI_IMAGE_MODEL` | optional | `gpt-image-2` | overrides the image model name |
| `ENABLE_GARDEN_IMAGEGEN` | optional | unset | enables direct local generation/edit mode |
| `IMG_GEN_HOST_HAS_IMAGE_TOOL` | optional | unset | tells the mode detector that the host can render images natively |
| `CODEX_BIN` | optional | `codex` | points to a custom Codex CLI binary |

You can place environment values in one of these files:

- `.env` in the repo root
- `.gateway.env` in the repo root
- `~/.gateway.env`

## Quick start

### 1. Detect the current runtime mode

```bash
npm run check-mode
```

JSON output:

```bash
npm run check-mode -- --json
```

### 2. Compose a prompt first

```bash
npm run build-prompt -- --query "Landing page hero visual for an AI video app" --json
```

Or inspect composition without full build:

```bash
npm run compose -- --query "Scientific infographic about RAG architecture" --json
```

### 3. Generate an image directly (Mode A)

```bash
npm run generate -- --prompt "A cinematic product hero shot of a translucent wearable device" --size 1536x1024
```

### 4. Edit an existing image directly (Mode A)

```bash
npm run edit -- --image ./assets/source.png --prompt "Replace the background with a clean studio scene"
```

### 5. Run the repo doctor

```bash
npm run doctor
```

## Direct script entrypoints

If you do not want to use npm scripts, the direct entrypoints are:

```bash
node scripts/check-mode.js --json
node scripts/build-prompt.mjs --query "..." --json
node scripts/compose-templates.mjs --query "..." --json
node scripts/generate.js --prompt "..."
node scripts/edit.js --image ./source.png --prompt "..."
node scripts/doctor-img-gen-pro.mjs
```

## Output behavior

By default, generated runtime artifacts are kept local:

- prompts are written under `garden-gpt-image-2/prompt/`
- generated images are written under `garden-gpt-image-2/image/`

These runtime artifacts are intentionally git-ignored.

## Repository layout

```text
img-gen-pro/
├── SKILL.md
├── README.md
├── README.zh-CN.md
├── LICENSE
├── package.json
├── data/
├── evals/
├── references/
├── scripts/
└── .dev/
```

## OpenClaw usage

If you are using OpenClaw, install or mount this repository as a skill and point the runtime at `SKILL.md`. OpenClaw is the primary integration target today, but the prompt/data/script layers are intentionally usable outside OpenClaw as a standalone repo.

The skill is designed to:

- route image requests into a governed prompt workflow
- use templates before freeform prompting
- ask clarifying questions when the visual direction is ambiguous
- separate prompt construction from render execution

## What is intentionally not promised

This repo does **not** promise:

- one-click support for every image provider
- universal GUI tooling
- automatic delivery back into chat in every host
- exact prompt reverse-engineering from a reference image

Its job is to make image workflows more reusable, more explainable, and less dependent on ad-hoc prompting.

## Internal maintenance notes

`.dev/` is a maintainer workspace for rebuild helpers, schema notes, and local checks. It is not part of the runtime contract.

## Recommended pre-publish checklist for consumers

If you fork or extend this project, check these first:

- verify your template additions are routed correctly
- keep runtime artifacts git-ignored
- do not commit private API keys or local render outputs
- document any host-specific Mode B or Mode C assumptions

## License

MIT
