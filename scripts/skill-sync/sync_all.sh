#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
for skill in invest-analysis-pro img-gen-pro LLM-WIKI; do
  python "$ROOT/scripts/skill-sync/sync_skill.py" "$ROOT" "$skill"
done
