# Factor Seed Profile

## Goal

Turn source-backed mechanisms into research hypotheses. A factor seed is not a factor, not a signal, not advice, and not validated alpha.

## Required Table

```markdown
| Seed | Source Mechanism | Observable Proxy | Data Need | Test Shape | Refutation | Caveats | Evidence |
|---|---|---|---|---|---|---|---|
```

## Field Rules

- `Seed`: short hypothesis name.
- `Source Mechanism`: causal or behavioral logic from the corpus.
- `Observable Proxy`: measurable variable candidate.
- `Data Need`: required fields, frequency, universe, and history.
- `Test Shape`: rough backtest or statistical check.
- `Refutation`: what result would weaken or reject the hypothesis.
- `Caveats`: survivorship, liquidity, transaction cost, regime, crowding, lookahead, or data quality risks.
- `Evidence`: source ids and short notes.

## Guardrails

- If there is no mechanism, do not create a factor seed.
- If the proxy is not observable, mark it as speculative.
- If the source is anecdotal, label evidence as weak.
- Do not imply investability without data validation.
- Keep failed or boundary cases; they often define the research hypothesis.

## Example Shape

```markdown
| Auction-strength reversal | Opening auction order behavior may reveal intraday sentiment shift | Change in indicative price and volume between 09:20-09:25 | tick/auction data, tradable universe, suspension flags | bucket by auction-strength delta and test forward returns net costs | no monotonic relation after costs | microstructure changes, crowding, liquidity | S012, S018 |
```
