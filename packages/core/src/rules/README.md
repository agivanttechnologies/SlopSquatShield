# rules

The rule engine (FR-4): turns a package's **facts** into a **verdict** — `CLEAN`, `WARN` or `BLOCK` —
with the exact signals that fired. It is rule-based intersection-of-signals, deliberately *not* a
weighted score, so every verdict is auditable and nothing is blocked on an opaque number.

| File | What it is |
|---|---|
| `types.ts` | `PackageFacts` (the source-agnostic input), `Signal`, `Verdict`, `Tier`, `RuleThresholds` and `DEFAULT_RULE_THRESHOLDS`. |
| `engine.ts` | `evaluatePackage(identifier, ecosystem, facts, options)` — the engine itself. |
| `similarity.ts` | `findSimilarPopularPackage` — edit distance to a reference list. An exact match (distance 0) is the same package, not a look-alike. |
| `dependency-confusion.ts` | `PrivateScopeConfig` and `isExpectedPrivate` — does a name match a convention the project declared private? |
| [`popular-packages/`](popular-packages/README.md) | The reference lists the similarity signal compares against. |

## The signals

| Signal | Default | Alone | Combined |
|---|---|---|---|
| `non-existence` | package isn't on the registry | **BLOCK** | — |
| `private-registry-mismatch` | a name declared private resolves on the *public* registry | **BLOCK** | — |
| `age` | first published < 14 days ago | WARN | counts toward BLOCK |
| `popularity` | < 500 downloads/week (npm, PyPI) | WARN | counts toward BLOCK |
| `name-similarity` | edit distance ≤ 2 from a popular package | WARN | counts toward BLOCK |
| `missing-repo-link` | no source repository in the metadata | WARN | counts toward BLOCK |

**Two or more WARN signals together escalate to BLOCK.** Maven has no popularity signal (no public
download counts), so its pool of combinable signals is three, not four. `popularity: undefined`
means "structurally unavailable" and never itself contributes a signal.

Every `Verdict` carries `reason`, its signals' own sentences joined in order (NFR-6.1) — e.g.
`Only 220 downloads a week (threshold: 500). Looks like the popular "lodash" (2 characters different).`
The reason never repeats the package's name or tier: every surface shows those next to it. Where a
verdict stands alone (the install wrapper, the agent hooks, an editor's Problems list), use
`describeVerdict(verdict)` from `describe.ts` — `lodahs (npm): Only 220 downloads a week …`, plus
`declared in <manifest>` when an install read the package from one (`verdict.declaredIn`).
The `name-similarity` signal (and a `non-existence` one whose name is a typo of a popular package)
also carries a `suggestion` — the popular package it resembles — which the editor's "did you mean"
quick-fix uses.

## Configuration

Thresholds and private scopes come from `EvaluateOptions` (`thresholds`, `privateScope`), which the
project config (`../config/`) fills in. The engine takes `now` as an injectable clock so age rules
are testable.

## Tests

`test/rules/` — one case per row of the table above.
