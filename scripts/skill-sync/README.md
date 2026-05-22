# skill-sync

This directory manages the local source-of-truth skill repos and mirrors them into the aggregate publish repo.

## Source-of-truth repos

- `invest-analysis-pro` -> `/Users/blinlee/.openclaw/skills/invest-analysis-pro`
- `img-gen-pro` -> `/Users/blinlee/.openclaw/skills/img-gen-pro`
- `LLM-WIKI` -> `/Users/blinlee/.openclaw/.workspace/project/LLM-WIKI`

## Aggregate publish repo

- `/Users/blinlee/.openclaw/.workspace/project/agent-skills`

The aggregate repo is the publish mirror that pushes to:

- private: `17636191639/agent-skill`
- public: `blinlee/agent-skills`

Do not treat the aggregate repo as the primary editing surface for the three skills.

## Commands

Sync one skill into the aggregate repo:

```bash
python scripts/skill-sync/sync_skill.py /Users/blinlee/.openclaw/.workspace/project/agent-skills <skill-name>
```

Sync all three skills:

```bash
scripts/skill-sync/sync_all.sh
```
