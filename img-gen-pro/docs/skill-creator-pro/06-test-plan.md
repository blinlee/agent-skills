# Test Plan

Date: 2026-05-22

## Regression Coverage

Add or update golden cases for:

- ToF LiDAR physical principle academic schematic.
- Chemistry / material mechanism figure.
- Technical architecture with many component names.
- UI mockup where product copy should not route the template.
- Product visual where white background / premium wording should not route to academic templates.

## Assertions

For each routing-sensitive case, check:

- selected canonical target.
- composition primary target.
- absence of incompatible prompt body phrases.
- retention of content payload in prompt.
- text inspection behavior.
- render dry-run artifact behavior where relevant.

## Commands

```bash
node .dev/tests/run-checks.mjs
npm run doctor
```

Use targeted `build-prompt --json` probes for new cases before adding them to golden cases.

