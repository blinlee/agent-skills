# Requirements

Date: 2026-05-22

## User Goals

- Produce high-quality standard-JSON image prompts from natural language requests.
- Choose templates by visual task type and output purpose, not by accidental domain keywords.
- Preserve concrete subject matter, labels, equations, components, and copy in the final prompt.
- Avoid template body contamination from unrelated prompt intelligence.
- Keep local execution modes inspectable and recoverable.

## Inputs

- Raw user request.
- Optional reference-image summary / keep / change notes.
- Optional explicit template target or template id for debugging.
- Optional routing brief when the host LLM has already analyzed the request.

## Outputs

- Structured routing brief.
- Template composition / selection result.
- Generation-ready prompt string whose content is strict standard JSON.
- Render contract.
- Mode A/B/C/D execution artifacts when rendering is requested.

## Constraints

- Do not solve this by adding narrow ToF, optics, biology, chemistry, or finance keyword patches.
- Raw content nouns must not dominate template selection.
- A selected prompt body may only be injected when it is semantically compatible with the selected canonical template.
- Final prompt handoff must be a JSON prompt string that parses with `JSON.parse`; no natural-language addon may be appended outside the JSON object.
- Documentation and implementation must stay aligned under `docs/skill-creator-pro/`.

## Non-goals

- Building a GUI.
- Exact reverse engineering of reference-image prompts.
- Guaranteeing scientific correctness beyond what the user provides.
- Removing template retrieval entirely.
