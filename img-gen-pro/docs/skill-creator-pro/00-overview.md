# img-gen-pro Skill Project Overview

Date: 2026-05-22

`img-gen-pro` is an OpenClaw-first image generation and editing skill. Its durable value is not direct rendering alone; it is the governed workflow that turns a user's visual request into a reliable template-backed prompt, then routes execution through the available runtime mode.

Current work stage: routing architecture cleanup and regression hardening.

## Current Goal

Replace raw-query template matching with intent-aware routing:

1. Understand what kind of visual artifact the user wants.
2. Use that routing intent to choose templates.
3. Keep domain-specific content and labels for prompt filling, not template selection.
4. Prevent incompatible prompt bodies from being injected into otherwise-correct canonical templates.
5. Keep Mode A/B/C/D execution behavior clear and verifiable.

## Triggering Incident

The ToF LiDAR pitfall record at `/Users/blinlee/Downloads/2026-05-21-tof-lidar-img-gen-pro-pitfall.md` showed that the old flow could select an academic canonical target while injecting product R&D board prompt text. The failure is treated as a routing architecture defect, not as a missing optics keyword.

## Backup

Before this work, a full directory backup was created at:

```text
/Users/blinlee/.openclaw/skills/img-gen-pro.backup-20260522-180713
```

