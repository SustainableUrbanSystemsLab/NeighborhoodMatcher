# Mutual Nearest Neighbor (MNN)

## Definition

Implemented in `matcher.signals.mnn_confirmed`. Given a target row at
`target_idx` whose forward best match is `best_supp_idx`:

1. Run a reverse search: find the nearest target row to
   `std_rows_2[best_supp_idx]`.
2. Match is **confirmed** iff `target_idx` is among the targets at the
   minimum distance in that reverse search (ties are accepted).

Returns `(confirmed, reverse_repeat_count)`:

- `confirmed` — bool.
- `reverse_repeat_count` — the count of target rows tied for nearest in the
  reverse search. Reported separately so callers can distinguish a clean
  symmetric match from one confirmed only by a tie.

Originates from FLANN-style matching (Muja & Lowe, 2009).

## What it catches

A specific failure mode that distance and NNDR both miss:

> The forward search assigned supplemental row `S` to target row `A`, but `S`
> is actually closer to a different target row `B`. `S` was assigned to `A`
> only because no closer supplemental row exists for `A`.

In other words: the supplemental row "belongs" elsewhere. The forward best
match is a least-bad option, not a real correspondence. This is the
condition demonstrated by the `mnn_not_confirmed` explanatory scenario.

## Tie handling — permissive

When the reverse search finds the supplemental row equidistant from multiple
target rows, *any* of those targets confirm. This is intentional: with
exact-distance ties (common with rounded data), strict tie-breaking would
flag genuinely symmetric matches as failures. The tie itself is reported via
`reverse_repeat_count` so a downstream consumer can apply a stricter rule
if needed.

## Reported as

- `mnn_confirmed` (0/1) in the linked dataset and detail file.
- `mnn_confirmed=False` raises a flag whose message points at the likely
  cause: "MNN not confirmed — supplemental row is closer to a different
  target; this record may have no valid match."

## Edge cases

- **Single target row** — trivially confirmed (no other target to compete).
  This is why a meaningful MNN demonstration needs ≥ 2 targets; see the
  `mnn_not_confirmed` explanatory scenario.
- **Exact match in forward direction** — confirmed iff the supplemental row
  is also closest to this target in reverse. Usually yes, but not
  guaranteed when other target rows are also exact matches.

## Related

- [cascading_nndr.md](cascading_nndr.md) — independent ambiguity check on the
  forward direction.
- [flags.md](flags.md) — MNN flag wording.
