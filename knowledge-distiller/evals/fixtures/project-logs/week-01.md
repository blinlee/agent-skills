# Week 01 Retrospective

Decision: keep planning lightweight, but require a written acceptance check before implementation starts.

Changed belief: we thought broad smoke tests were enough for local changes. This failed when a parser bug escaped because the smoke test never exercised the parser directly.

New rule: local behavior needs focused module tests first. Full-suite checks are final confidence, not the first response.

Escalation: if a task changes a contract, update docs and tests in the same change.

Open thread: decide how much process is enough before it slows small fixes.
