# img-gen-pro Execution Eval

## Purpose

Skill-level quality evaluation — tests whether the skill produces correct templates, triggers text QA gate, asks clarifying questions when needed, and delivers usable prompts for real user tasks.

This is **not** the same as `.dev/tests/golden-cases.json` (which tests script plumbing — select-template and build-prompt CLI behavior).

## How to use

### Manual run (recommended)

1. Pick an eval case from `evals.json`
2. Feed the prompt to a session with the skill enabled
3. Review the output against `expected_behavior`
4. Log results in `evals/results/`

### Automated run (future)

```bash
# With skill
sessions_spawn(
  task="Use the local img-gen-pro skill repository to handle: <eval prompt>",
  mode="run",
  runTimeoutSeconds=300
)

# Baseline (no skill)
sessions_spawn(
  task="<eval prompt>",
  mode="run",
  runTimeoutSeconds=300
)
```

Then compare outputs and grade against assertions.

## Assertions

Each eval case has `expected_behavior` with checkable assertions:

| Field | What it checks |
|---|---|
| `template_category` | Did the skill land on the right template category? |
| `template_file` | Did it select the correct canonical template? |
| `text_qa_triggered` | Did the text QA gate activate for text-bearing images? |
| `critical_text` | Are the specified text strings present in the final prompt? |
| `ratio` | Is the output ratio correct? |
| `workflow` | Did it select the right editing workflow? |
| `reference_workflow_triggered` | Did the reference image workflow activate? |
| `clarification_needed` | Did the skill recognize it needs to ask? |
| `should_ask_about` | Did it ask about the right topics? |

## Coverage

The 10 eval cases cover:

| # | Template category | Workflow type |
|---|---|---|
| 1 | UI mockups | Text generation |
| 2 | Infographics | Text generation |
| 3 | Editing workflows | Edit (background) |
| 4 | Reference image | Reference rebuild |
| 5 | Technical diagrams | Text generation |
| 6 | Branding & packaging | Text generation |
| 7 | Product visuals | Text generation |
| 8 | Academic figures | Text generation |
| 9 | Storyboards | Text generation |
| 10 | Ambiguous | Clarification |

## Iteration protocol

1. Run all 10 evals
2. Grade each against `expected_behavior`
3. Identify failures → update SKILL.md / scripts / templates
4. Rerun failed evals
5. Repeat until all pass
