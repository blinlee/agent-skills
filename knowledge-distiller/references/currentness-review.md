# Currentness Review

## Purpose

Older materials may contain claims that were correct in their original context but are now outdated, incomplete, or misleading. Treat the source corpus as primary evidence, not sacred text.

The agent may use its own knowledge to correct, qualify, or supplement final assets, but every such change must be auditable.

## Core Rule

Preserve three layers separately:

1. **Source Claim**: what the source says, with source ids.
2. **Agent Assessment**: whether the claim appears timeless, period-specific, incomplete, outdated, or needs current verification.
3. **Corrected or Supplemented Claim**: the asset wording the agent chooses for future reuse.

Do not hide layer 3 inside layer 1. If the asset improves on the source, record that improvement in `currentness-ledger.md` or the delivery report.

## Currentness Labels

Use these fields in durable assets when relevant:

```markdown
- Temporal Scope: timeless | period-specific | dated | unknown
- As-of: [source date, inferred period, or unknown]
- Currentness: current | likely-current | possibly-outdated | outdated | needs-verification
- External Check: source-only | llm-prior | current-source-needed
```

## When LLM Judgment May Modify Assets

LLM judgment may enter final assets when it:

- corrects an outdated factual claim
- adds a missing boundary condition
- narrows a once-general rule to its historical context
- supplements a mechanism with widely known background knowledge
- converts a source belief into a historical note rather than a current rule

But the asset must state the intervention:

```markdown
**Source Claim:** [What the source says.]

**Agent Assessment:** [Why it is current, outdated, incomplete, or needs verification.]

**Corrected / Supplemented Claim:** [The version used as durable knowledge.]

**Audit Note:** [What changed from source wording and why.]
```

## Ledger Template

Create `knowledge-assets/currentness-ledger.md` when any asset is corrected or supplemented by LLM judgment.

```markdown
# Currentness Ledger

| Asset ID | Source Claim | Source Period | Currentness | Agent Intervention | Basis | Action |
|---|---|---|---|---|---|---|
| KA-0001 | ... | 2018 | possibly-outdated | narrowed scope | llm-prior | keep with boundary |
```

`Basis` should be one of:

- `source-only`: the corpus itself supports the assessment.
- `llm-prior`: the agent's general knowledge supports the assessment, but no fresh source was checked.
- `current-source`: current external material was checked.
- `user-provided-update`: the user supplied newer evidence.

## High-Volatility Domains

For medical, legal, tax, policy, software versions, market structure, product specs, live financial conditions, or other time-sensitive domains:

- LLM prior knowledge may flag risk and propose a correction.
- Do not present the correction as current fact unless current evidence was checked or the user supplied newer sources.
- Mark the asset `needs-verification` when currentness matters and no current source was checked.

## Report Requirement

The delivery report should include a `Currentness / Context Review` section whenever sources are old, undated, or time-sensitive, or whenever LLM judgment corrected or supplemented an asset.

Use this table:

```markdown
| Asset ID | Source Claim | Source Period | Currentness | Agent Intervention | Basis | Action |
|---|---|---|---|---|---|---|
```

## Actions

- `keep as principle`: source remains broadly valid.
- `keep with boundary`: source is useful only under stated conditions.
- `mark dated`: preserve as historical source belief.
- `supplement`: add missing context or boundary.
- `correct`: use updated wording in the asset and log the correction.
- `needs current verification`: do not rely on it as current knowledge yet.
