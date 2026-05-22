# Test Report

## 2026-05-22

Commands:

- `rtk node .dev/tests/run-checks.mjs`
- `rtk npm run doctor`

Results:

- Golden checks: all 27 cases passed.
- Doctor: passed required file, composer target, documentation wording, gitignore, and prompt-engine cleanliness checks.
- Doctor warning: working tree has pending changes, which is expected during this implementation pass.

Regression coverage added:

- ToF LiDAR scientific schematic routes through `scientific_schematic` routing brief and lands on `references/academic-figures/scientific-schematic.md`.
- Enzyme catalytic mechanism routes through `mechanism_diagram` routing brief and lands on `references/academic-figures/mechanism-diagram.md`.
- Technical ER and network topology requests remain ready and no longer receive generic infographic subtype questions.

Targeted evidence:

- ToF build output: `status=ready`, `family=academic-figure`, `ratio=16:9`, `slotClarificationNeeded=false`.
- ToF prompt keeps `发射脉冲` and `d=cΔt/2` as content while using `academic scientific schematic single physical principle diagram clean vector white background labeled formula` for template matching.

## 2026-05-22 Self-Audit Verification

Commands:

- Retired-wording scan across scripts, skill docs, README files, test cases, and package metadata.
- `rtk node .dev/tests/run-checks.mjs`
- `rtk npm run doctor`
- `rtk node scripts/analyze-routing-intent.mjs --query "ToF 激光雷达测距原理图，包含公式标注" --json`

Results:

- Retired wording scan: no matches.
- Golden checks: all 27 cases passed.
- Doctor: passed required checks; expected pending-change warning only.
- Routing brief smoke test: ToF request mapped to `scientific_schematic`, with `ToF` retained as weak/content signal rather than the routing driver.

## 2026-05-22 Backup Comparison Verification

Commands:

- `rtk diff -qr -x .git -x img-gen-pro <backup> <current>`
- Backup/current `build-prompt --json` probes for ToF, enzyme mechanism, ER diagram, live commerce UI, and A-share report.
- Backup/current `template-brief --target ... --json` probes for live commerce, ecommerce hero, and ToF scientific schematic.
- `rtk node .dev/tests/run-checks.mjs`
- `rtk npm run doctor`

Results:

- No source file was unintentionally deleted.
- New docs and routing scripts are intentional additions.
- Runtime `.omx`, `.dev/tmp`, and `img-gen-pro/prompt` differences are generated local state/artifacts, not source behavior changes.
- Two review findings were fixed during the comparison: prompt fragments for explicit target briefs and principle inheritance for new diagram families.
- Golden checks remained all green after fixes.

## 2026-05-22 Strict JSON Handoff Verification

Commands:

- `rtk node .dev/tests/run-checks.mjs`
- `rtk npm run doctor`
- JSON-first probe: `build-prompt --query "画一张微服务系统架构图..." --json`
- Structured-template probe: `build-prompt --query "ToF激光雷达测距基本物理原理..." --json`

Results:

- Golden checks: all 27 cases passed.
- Doctor: passed required checks; expected pending-change warning only.
- Every `status=ready` prompt in golden checks parsed with `JSON.parse`.
- Every `status=ready` prompt in golden checks was checked for unresolved `{argument ...}` placeholders.
- Representative JSON-first and structured-template probes reported `renderContract.finalHandoffType=json-prompt-string` and `renderContract.promptFormat=json`.
- Both probes had no `{argument` placeholder leak and no `Template composition plan:` natural-language addon.

## 2026-05-22 Additional Self-Test

Commands:

- `rtk rg -n "normalized-text|normalized prompt|string prompt|Template composition plan:|Primary structure template:|Supporting templates to borrow|Style templates to borrow|\\{argument" scripts SKILL.md docs .dev/tests .dev/contracts README*`
- `rtk node .dev/tests/run-checks.mjs`
- `rtk npm run doctor`
- Seven-case `build-prompt --json` smoke probe covering structured templates, JSON-first templates, composed academic/report prompts, multi-reference composition, and explicit target routing.
- `rtk node --check` for changed `.mjs` test/build/routing scripts.
- `rtk git diff --check`

Results:

- Retired wording scan found only intentional documentation/test guard references, not active final-prompt behavior.
- Golden checks: all 27 cases passed.
- Doctor: passed required checks; expected pending-change warning only.
- All 7 representative ready smoke prompts parsed as JSON and reported `json-prompt-string` / `promptFormat=json`.
- Smoke prompts had no unresolved `{argument` placeholders and no natural-language `Template composition plan:` addon.
- Syntax checks and whitespace checks passed.
