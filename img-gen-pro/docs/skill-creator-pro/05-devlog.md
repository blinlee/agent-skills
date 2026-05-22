# Devlog

## 2026-05-22: Routing Architecture Cleanup Begins

Reason: User approved work after identifying that the failure was not a ToF-specific gap but a general raw-query matching defect.

Actions:

- Created full backup at `/Users/blinlee/.openclaw/skills/img-gen-pro.backup-20260522-180713`.
- Created the `docs/skill-creator-pro/` documentation system.
- Recorded the active design: routing brief first, content payload separated from template matching, and prompt body compatibility guard.

Files touched:

- `docs/skill-creator-pro/*`

Eval required: yes, after implementation changes.

Next action: implement routing brief support and compatibility gating, then add regression cases.

## 2026-05-22: Routing Brief Implementation And Cleanup

Actions:

- Added local routing brief generation with `visualTaskType`, `outputPurpose`, `layoutIntent`, `styleIntent`, `routingQuery`, `contentPayload`, and `weakMatchTerms`.
- Added `analyze-routing` CLI entry point for inspecting the routing brief before prompt composition.
- Rewired template composition and selector matching to use `routingQuery` instead of the full raw request.
- Kept the original user request as prompt content, ratio/platform/text QA input, and content payload.
- Removed matched prompt body injection from final prompt composition.
- Split `academic-figure` and `technical-diagram` from generic `infographic`.
- Removed retired selector wording from `SKILL.md`, README files, script help text, and test names.
- Added cross-domain regressions for ToF scientific schematics and enzyme mechanism diagrams.

Files touched:

- `scripts/routing-brief.mjs`
- `scripts/analyze-routing-intent.mjs`
- `scripts/build-prompt.mjs`
- `scripts/compose-templates.mjs`
- `scripts/select-template.mjs`
- `scripts/template-brief.mjs`
- `scripts/prompt-compose-utils.mjs`
- `scripts/doctor-img-gen-pro.mjs`
- `data/template-composer-profiles.json`
- `.dev/tests/run-checks.mjs`
- `.dev/tests/golden-cases.json`
- `SKILL.md`
- `README.md`
- `README.zh-CN.md`
- `package.json`

Verification:

- `rtk node .dev/tests/run-checks.mjs`: all 27 golden cases passed.
- `rtk npm run doctor`: passed required checks; reported expected pending working tree changes.

## 2026-05-22: Self-Audit And SKILL.md Optimization

Actions:

- Re-read the `skill-creator-pro` workflow and checked the local documentation gate.
- Audited `SKILL.md` against the new routing-brief design.
- Added routing brief boundaries directly to `SKILL.md` so agents know which data drives template matching and which data remains prompt content.
- Added `scripts/analyze-routing-intent.mjs` and `scripts/routing-brief.mjs` to the skill structure section.
- Clarified that prompt intelligence supports ranking and diagnostics but matched upstream prompt bodies must not be injected into final prompts.
- Updated the gotchas around content payload and ratio inference.

Verification:

- Retired-wording scan across scripts, docs, tests, and README files: no active-code matches after excluding the audit description itself.
- `rtk node .dev/tests/run-checks.mjs`: all 27 golden cases passed.
- `rtk npm run doctor`: passed required checks; reported expected pending working tree changes.
- `rtk node scripts/analyze-routing-intent.mjs --query "ToF 激光雷达测距原理图，包含公式标注" --json`: produced `visualTaskType=scientific_schematic` and kept `ToF` as a weak/content signal.

## 2026-05-22: Backup Comparison Review

Actions:

- Compared the current workspace against `/Users/blinlee/.openclaw/skills/img-gen-pro.backup-20260522-180713`.
- Separated source/docs changes from runtime state and ignored prompt artifacts.
- Ran backup-versus-current probes for ToF, enzyme mechanism, ER diagram, live commerce UI, A-share report, explicit `template-brief --target`, and explicit `build-prompt --target`.

Findings fixed:

- `template-brief --target ...` had lost prompt fragments when no `--template-id` was supplied. Fixed by using the canonical target for family/profile but the ranked template id for prompt fragments.
- New `academic-figure` and `technical-diagram` families had lost generic infographic principles. Fixed with family aliases in `principlesForFamily`.

Verification:

- Explicit target probes now preserve prompt fragments while keeping corrected families.
- `rtk node .dev/tests/run-checks.mjs`: all 27 golden cases passed.
- `rtk npm run doctor`: passed required checks; reported expected pending working tree changes.

## 2026-05-22: Strict JSON Prompt Handoff

Reason: User clarified that the final image prompt must be standard JSON in the same spirit as the JSON templates, not a natural-language prompt string or a JSON body followed by prose.

Actions:

- Changed prompt composition so ready prompts are serialized JSON objects.
- Converted template composition metadata from a natural-language addon into `template_composition_plan` JSON fields.
- Rendered `{argument ... default=...}` placeholders inside JSON templates before final handoff.
- Updated the render contract to `finalHandoffType=json-prompt-string` and `promptFormat=json`.
- Updated tests to require every ready build prompt to parse with `JSON.parse`.
- Updated `SKILL.md` and design docs to retire the old normalized-text handoff wording.
- Extended academic/white-vector conflict cleanup into the final JSON prompt object so JSON-first template defaults cannot preserve incompatible dark README/blog styling.

Verification:

- `rtk node .dev/tests/run-checks.mjs`: all 27 golden cases passed with ready prompts parsed as JSON.
- `rtk npm run doctor`: passed required checks; reported expected pending working tree changes.
- Representative JSON-first and structured-template probes both produced `json-prompt-string` with `promptFormat=json`, no `{argument` leak, and no natural-language composition addon.
