# Decisions

## 2026-05-22: Retire Raw Full-Query Template Matching As The Main Design

Context: The ToF LiDAR pitfall showed that full raw user text can overmatch unrelated prompt variants and cases.

Options considered:

- Keep raw query matching and add domain keywords.
- Add a routing brief that separates visual intent from content payload.

Chosen option: use a routing brief as the main design.

Rationale: Keyword patches do not generalize across biology, chemistry, finance, engineering, UI, and product tasks. The system needs to know which words choose templates and which words fill content.

Risk: A local deterministic routing brief may still be imperfect. Host LLM-provided routing briefs should be supported when available.

Supersedes: direct use of raw user text as the primary template selection surface.

## 2026-05-22: Retire Prompt Body Injection From Final Prompt Composition

Context: A correct canonical target can still be contaminated by an unrelated prompt intelligence body.

Chosen option: do not inject matched prompt bodies into final prompt composition. Keep prompt intelligence as ranking and diagnostic evidence only.

Rationale: Borrowing an upstream prompt body is too strong a semantic operation. It can override the user request even after the right canonical template is selected.

Supersedes: final prompt sections that preserve a matched prompt body verbatim.

## 2026-05-22: Split Academic And Technical Diagram Families From Generic Infographic

Context: Scientific schematics, mechanism diagrams, ER diagrams, and network topology diagrams are label-heavy, but they are not generic explainer infographics.

Chosen option: route academic figures to `academic-figure` and technical diagrams to `technical-diagram`.

Rationale: This prevents generic infographic slot questions from interrupting already clear diagram requests while keeping readable-label QA active.
