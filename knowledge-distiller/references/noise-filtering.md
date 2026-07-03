# Noise Filtering

## Philosophy

High fidelity means preserving meaningful source content, not every token from a messy document. Filter source-production noise before extracting knowledge.

Noise filtering happens after coverage mapping and during semantic reading. It is a judgment layer, not a script-only cleanup pass.

## Remove

Remove or ignore obvious non-body material:

- page headers and footers
- page numbers
- repeated slide titles that only mirror the deck title
- logos, company names, event names, and meeting names when they are just page furniture
- watermarks
- download-site ads
- scan software marks
- OCR edge text
- public-account prompts
- "for study only" boilerplate
- unrelated copyright footers
- template placeholders
- decorative title bars
- source-platform navigation, recommendations, and disclaimers

## Keep

Keep content that affects interpretation:

- author, title, date, or source labels needed for citation
- risk disclaimers that are part of the source's argument
- domain-specific warnings, constraints, or legal boundaries
- repeated phrases that encode a real principle rather than page furniture
- company or product names when the source is about that entity

## Quarantine

If a fragment looks like noise but might matter, place it in a low-confidence note instead of deleting it silently.

Use this shape:

```markdown
## Noise Review
| Fragment | Source | Decision | Reason |
|---|---|---|---|
| ... | S003 | quarantine | May be boilerplate, but appears near risk guidance |
```

## Validation

Final distilled rules should not contain personal/platform labels, download residues, watermarks, or one-off provenance tags unless they are semantically required or cited as source context.

## Duplicates and Near-Duplicates

Repeated text can mean different things:

- repeated headers, footers, logos, deck titles, disclaimers, and platform boilerplate are noise candidates
- repeated rules, examples, or warnings inside body text may signal importance
- near-duplicates with different scope or wording may be variants, not duplicates

Deduplicate only after semantic review. Keep variants when they change context, boundary, or mechanism.
