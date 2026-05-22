# Current Design

Date: 2026-05-22

This is the current effective design. Older raw-query matching semantics are retired and must not be treated as a parallel active design.

## Routing Brief First

Every prompt-building path should distinguish:

- `routingQuery`: the cleaned query used for template selection.
- `contentPayload`: concrete subject matter to put into the final image.
- `weakMatchTerms`: terms that may matter visually but should not dominate template selection.
- `visualTaskType`: the kind of image requested.
- `outputPurpose`: why the image exists.
- `layoutIntent`: the structural shape of the image.
- `styleIntent`: visual style constraints.

Example:

```json
{
  "visualTaskType": "scientific_schematic",
  "outputPurpose": "academic_figure",
  "layoutIntent": "single physical principle diagram",
  "styleIntent": ["clean vector", "white background", "top journal"],
  "routingQuery": "academic scientific schematic single physical principle diagram clean vector white background",
  "contentPayload": {
    "domain": "ToF LiDAR ranging physics",
    "mustInclude": ["emitter", "receiver", "target", "Delta t", "d = c Delta t / 2"]
  },
  "weakMatchTerms": ["ToF", "LiDAR", "specific equation", "specific labels"]
}
```

## Matching Responsibility

Template matching should primarily use:

1. visual task type
2. output purpose
3. layout intent
4. style intent
5. platform / medium

Domain nouns and concrete content should be retained for prompt filling, but they should not decide the template family unless the domain itself changes the visual task type.

## Prompt Body Compatibility

Prompt intelligence bodies are allowed only when compatible with the selected canonical target. If a template id maps to an unrelated canonical target, the prompt builder should use the canonical template brief and omit the incompatible prompt body.

## Final Prompt Contract

The final handoff is always a prompt string whose content is strict JSON.

- JSON-first templates provide the base object and are rendered as JSON after slot/default resolution.
- Structured non-JSON templates remain valid source material, but the builder converts them into a generated JSON prompt object.
- Template composition notes, text-inspection rules, avoid lists, ratio/platform, and user content must be fields inside the JSON object.
- Natural-language or Markdown sections must not be appended outside the JSON object.
- `renderContract.finalHandoffType` is `json-prompt-string`, and `renderContract.promptFormat` is `json`.

## CLI Surface

Repeated routing behavior should be exposed through an agent-friendly command:

```bash
node scripts/analyze-routing-intent.mjs --query "..." --json
```

`build-prompt.mjs` may call the same routing-brief module internally. The JSON output is part of the debugging surface.

## Execution Status

Mode C render status should be judged by result artifacts (`result.json`, expected image path, bytes, last message), not by noisy intermediary terminal logs.
