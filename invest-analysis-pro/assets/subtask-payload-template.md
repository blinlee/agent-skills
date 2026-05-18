# Subtask Payload Template

Use this payload for every dispatched or simulated role task. Keep the role bounded; do not let a role task re-plan the full workflow or produce the final investment decision.

```text
Role: <Technical Analyst | Intel Analyst | Fundamentals & Flow Analyst | Risk Officer | Strategy Specialist | Portfolio Analyst>
Prompt: references/prompts/<role>.md
Stock: <code + name + market if known>
Mode: <quick | standard | full | specialist>
Objective: <the exact question this role must answer in this round>
Evidence slices:
  - envelope.status: <ok|partial|failed>
  - coverage summary: <requested/succeeded/failed>
  - relevant data: <compact JSON or key-field excerpt>
  - errors/warnings relevant to this role: <list>
Prior opinions: <none | Technical output | Intel output | Fundamentals & Flow output | Risk output | Strategy output>
Strategy YAML: <required only for Strategy Specialist; paste the corresponding strategies/*.yaml content>
Tool policy: do not call external tools or data adapters unless the controller explicitly authorizes it
Worker selection: prefer a dedicated callable subagent from the host runtime's configured agent list; if none is callable for this role, dispatch a same-agent/self-spawn worker
Output language: Chinese unless the user requested another language
Output contract: JSON only; no markdown fence; follow the prompt schema; no final report; no final controller decision
Missing-data policy: mark unknown/missing_data, lower confidence, and state what evidence is required to resolve it
```
