# Classification Review Protocol

Load this reference whenever routing, profile boundary, taxonomy placement, bridge decisions, or atlas `raw/inbox` intake are involved. The CLI route proposal is an audit artifact and candidate generator; the agent remains responsible for semantic review before asking the human to approve a mutation.

## Non-Negotiable Gate

Do not run `route-accept`, `profile-accept`, `bridge-accept`, `taxonomy-accept`, `intake-complete`, `intake-park`, or `intake-reject` until the user explicitly approves the proposed action. High confidence, a strong CLI score, or a good-looking classification package is still only a proposal.

## Review Inputs

For each source, collect:

- the source path and intake item id, if present
- the route proposal, candidates, evidence, risks, human questions, and classification package
- the route proposal's `routingAssessment`, especially `ownershipDecision`, `relationshipHint`, `novelty`, and `reviewFocus`
- registry profiles for plausible target wikis
- source evidence read directly by the agent

For decoded or long documents, read enough source material to understand the document before judging the route. Prefer title, abstract, summary, table of contents, introduction, conclusion, headings, captions/tables that carry domain meaning, and selected high-signal sections. Do not classify only from filenames, frontmatter, route scores, or the first excerpt.

## Semantic Review Steps

1. **Understand the source.** Extract a source domain signature: domain, main subject, method/object/entity, source type, intended retrieval use, and key terms. Separate provenance words from content words.
2. **Inspect existing boundaries.** Compare the source signature to each plausible wiki profile's scope core, scope adjacent, out-of-scope examples, accepted/rejected history, aliases, and review notes.
3. **Apply the classification principles.** Test whether the source belongs to the same concept scheme, whether primary ownership is singular, whether a bridge is enough, and whether a category/facet/internal taxonomy decision is being confused with a wiki boundary decision.
4. **Audit the CLI proposal.** Treat `recommendedWikiId`, candidate scores, topics, aliases, and bridge suggestions as prompts to review. Accept them only when they survive semantic review.
   - Prefer candidates with `matchQuality: strong` plus profile-level `phraseMatches`/alias/core evidence.
   - Treat high scores from fragmented tokens or generic AI/research/model vocabulary as weak routing hints, not ownership evidence.
   - Use `routingAssessment.relationshipHint` to distinguish direct ownership from `possible_child_profile`, `adjacent_family`, `generic_overlap`, or `unrelated` cases.
   - A `possible_child_profile` or `adjacent_family` hint is not approval to route into the nearest wiki; it is a prompt to decide whether to create a bounded profile, park, or override after reading the source.
5. **Choose one proposed action.** Recommend exactly one next operation for the user to approve: accept route, override route to another existing wiki, accept/create a new profile, park for later, reject/convert, or review bridges/taxonomy.
6. **Preserve the review gate.** Return the audited recommendation and the exact command you would run after approval, but do not run it yet.

## Decision Ladder

Use the first fitting outcome:

- **Accept existing wiki** when the source domain signature clearly falls inside one wiki's scope core or durable adjacent scope, and out-of-scope rules do not apply.
- **Override route** when the CLI picked the wrong existing wiki but another registered wiki clearly owns the source.
- **Create or accept a profile proposal** when the source is useful, substantial, and outside existing wiki boundaries, and the proposed boundary is reusable beyond a one-off file.
- **Bridge** when one primary wiki owns the source but another wiki needs explicit cross-scheme context.
- **Park** when the material may be useful but ownership, future corpus, or source quality is not yet clear.
- **Reject or convert** when the source is unsupported, unreadable, duplicate noise, or needs better decoding before classification.

Never force a weak match into the nearest existing wiki. An atlas is open-world: "none of the current wikis owns this" is a valid and often correct result.

## Output Contract

When returning a routing/classification recommendation, use this structure:

```text
Source understanding:
- Domain:
- Main subject:
- Source type:
- Evidence read:

CLI proposal audit:
- Proposed route:
- What the CLI got right:
- What needs correction:

Boundary review:
- Best existing wiki fit:
- Fit strength:
- Why not the other candidates:
- Pollution risk:

Recommended human decision:
- Action:
- Target wiki/profile:
- Category path or facets, if relevant:
- Bridges, if relevant:
- Command after approval:
```

Keep the command actionable but pending. If the user approves a different action, run that approved action instead.

## Anti-Patterns

- Accepting `recommendedWikiId` without reading the source.
- Treating token overlap as semantic ownership.
- Using decoded frontmatter/provenance fields as classification evidence.
- Creating one-off wiki profiles for every isolated source.
- Broadening an existing wiki to avoid proposing a new profile.
- Using taxonomy categories to solve a cross-wiki boundary problem.
- Running accept/reject/park commands before explicit approval.
