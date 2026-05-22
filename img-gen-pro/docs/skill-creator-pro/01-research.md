# Research Notes

Date: 2026-05-22

## Local Evidence

The pitfall record describes a user request for a ToF LiDAR ranging principle figure. The old system produced:

- `selectedTemplateId: concept-product-breakdown`
- `selectedTarget: references/academic-figures/mechanism-diagram.md`
- prompt body containing product/furniture/device R&D board language

The issue was reproduced locally on 2026-05-22 with the same effective behavior. This confirms the defect remains in the current implementation.

## Code Findings

- `build-prompt.mjs` first attempts template composition, then falls back to selector-based resolution when composition confidence is too low.
- `select-template.mjs` scores full user text across categories, styles, scenes, prompt variants, cases, prompt fragments, and canonical target text.
- `template-brief.mjs` can attach prompt intelligence from a template id even when the selected canonical target belongs to a different semantic family.
- Earlier prompt composition injected matched upstream prompt bodies directly into the final prompt when a selected prompt variant was present. This was retired because the injected body could override the selected canonical template.
- `run-codex-render.mjs` already writes reliable result artifacts, but terminal logs can obscure the final success state.

## CLI-Anything Mindset

The CLI-Anything README emphasizes agent-native command surfaces: structured, composable, self-describing, and reliable command outputs. For this project, the reusable command surface should be the routing and prompt-building pipeline, not only prose inside `SKILL.md`.

Applied principle: repeated routing decisions should become structured script outputs. The routing brief should be inspectable JSON so agents can debug and reuse it.

## What To Borrow

- Structured JSON surfaces for repeated workflow steps.
- Clear CLI commands with `--json`.
- Deterministic validation and regression checks around routing behavior.

## What Not To Borrow

- Do not force every image generation decision into a purely deterministic local CLI. The skill should still allow the host LLM to provide semantic judgment when available.
