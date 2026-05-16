# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the TypeScript CLI and durable core modules. `tests/` contains smoke, unit, and integration coverage. `skills/llm-wiki/` holds the host-neutral skill contract. Build output belongs in `dist/` and should not be edited by hand.

## Build, Test, and Development Commands

Run everything from the repository root:

```bash
npm install
npm test
npm run build
npm run --silent cli -- status ./knowledge
```

Use `npm run --silent cli -- ...` for JSON-oriented CLI calls so npm prefix noise does not corrupt stdout.

## Coding Style & Naming Conventions

Use TypeScript ES modules, strict typing, and 2-space indentation. Keep durable behavior in core modules under `src/` and keep thin adapter layers small. Name tests as `*.test.ts`. Prefer explicit, domain-oriented filenames over generic helpers.

## Testing Guidelines

Vitest is the test runner. Add unit tests for pure parsing, path, and analysis logic. Add integration tests for CLI flows that mutate a knowledge root or registry root. Before merging behavior changes, run `npm test` and `npm run build`.

## Commit & Pull Request Guidelines

Prefer Conventional Commit prefixes such as `feat:`, `fix:`, `chore:`, and `docs:`. Keep commit subjects specific and imperative. PRs should explain changed behavior, affected surfaces, and the validation commands used.

## Security & Configuration Tips

Do not commit credentials, local review state, generated knowledge roots, or ignored runtime directories. Keep any upstream-derived or vendor-derived material clearly separated from the durable core.
