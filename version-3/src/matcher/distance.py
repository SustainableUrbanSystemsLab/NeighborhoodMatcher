import numpy as np

# Squared-distance contribution of a dimension that is missing on either
# side. Under joint z-scoring each column has variance 1, so the expected
# squared difference between two unrelated rows is Var(z_a - z_b) ~= 2.
# Charging a missing dimension this neutral prior keeps rows with missing
# data comparable to complete rows WITHOUT letting them look artificially
# close: rescaling the observed dimensions instead (the sklearn
# nan-Euclidean convention) assumes the missing dimensions behave like this
# pair's observed ones, which lets a supplemental row that agrees on its
# few observed dimensions "exact-match" at distance 0 and displace the true
# complete-row match.
MISSING_PENALTY = 2.0


def euclidean_distance(row_a, row_b):
    """
    Euclidean distance between two standardized numpy rows, tolerating
    missing (NaN) dimensions.

    Dimensions observed in BOTH rows contribute their squared difference;
    every other dimension contributes MISSING_PENALTY. Returns inf when the
    rows share no observed dimension — such a pair carries no evidence of
    similarity at all.
    """
    diff = row_a - row_b
    observed = ~np.isnan(diff)
    n_observed = int(observed.sum())
    n_features = diff.shape[0]
    if n_observed == 0:
        return np.inf
    if n_observed == n_features:
        return np.sqrt(np.sum(diff ** 2))
    # Penalty terms are summed in place (not appended) so this reduction is
    # bitwise identical to the chunked engine in match_all, which writes
    # MISSING_PENALTY into the missing positions of the same sequence.
    sq = np.where(observed, diff * diff, MISSING_PENALTY)
    return np.sqrt(np.sum(sq))


def compute_sorted_distances(target_row, reference_rows):
    """
    Computes distances from target_row to every reference row.
    Returns (sorted_dists, best_index, repeat_count).

    sorted_dists : 1-D array of all distances, ascending (inf sorts last).
    best_index   : index of the closest row in the *original* reference_rows.
    repeat_count : number of rows tied at the minimum distance
                   (0 when even the best distance is inf — no valid match).
    """
    dists = np.array([euclidean_distance(target_row, ref) for ref in reference_rows])
    order = np.argsort(dists, kind='stable')
    sorted_dists = dists[order]
    best_index = int(order[0])
    if np.isinf(sorted_dists[0]):
        return sorted_dists, best_index, 0
    repeat_count = int(np.sum(dists == sorted_dists[0]))
    return sorted_dists, best_index, repeat_count


def match_all(std_rows_1, std_rows_2, threshold=0.8, top_k=0, hist_bins=0,
              chunk_size=64, progress_cb=None, fast=False):
    """
    Vectorized brute-force matching of every target row against every
    supplemental row. Bitwise identical to calling compute_sorted_distances
    per target plus the mnn_confirmed reverse search (pinned by
    tests/test_match_all.py), but runs in chunked numpy operations and never
    materializes a full N x M distance matrix (peak transient memory is one
    chunk_size x M block).

    This stays brute force ON PURPOSE — the privacy posture of this project
    forbids spatial index structures (see docs/architecture.md, "Brute
    force, by design"). Only the arithmetic is vectorized.

    std_rows_1 : (N, d) standardized target rows (may contain NaN).
    std_rows_2 : (M, d) standardized supplemental rows (may contain NaN).
    threshold  : NNDR threshold for the near-miss cascade.
    top_k      : per target, retain the k smallest distances (0 = skip).
    hist_bins  : per target, retain a histogram of finite distances (0 = skip).
    chunk_size : target rows per block; bounds transient memory at
                 chunk_size * M * d floats.
    progress_cb: optional callable(fraction in 0..1), called once per chunk.
    fast       : False (default) computes every distance with the exact
                 subtract/square/np.sum sequence of euclidean_distance —
                 results are bitwise reproducible and independent of
                 chunk_size. True switches to a fused einsum reduction (plus
                 inner-product corrections on missing data), roughly 25%
                 faster, whose accumulation can differ from the exact path
                 in the last ulp: distances/NNDR drift by ~1e-16 relative,
                 and a COINCIDENTAL exact-distance tie between two different
                 supplemental rows may round apart (identical rows still tie
                 exactly). Use for exploratory runs where throughput matters
                 more than tie-exact reproducibility.

    Returns a dict of per-target arrays/lists (length N):
        best_index    int,   -1 for a no-match row
        best_distance float, inf for a no-match row
        second_distance float, nan when M < 2 or no finite second
        repeats       int,   exact-distance ties at the minimum (0 = no match)
        nndr          float, per the cascading_nndr contract
        near_miss     int,   per the cascading_nndr contract
        mnn_confirmed bool,  fused reverse-search confirmation
        top_k         list of ascending distance lists (only if top_k > 0)
        histograms    list of (counts, edges) tuples (only if hist_bins > 0)
    """
    targets = np.asarray(std_rows_1, dtype=float)
    refs = np.asarray(std_rows_2, dtype=float)
    n, d = targets.shape
    m = refs.shape[0]

    has_nan = bool(np.isnan(targets).any() or np.isnan(refs).any())
    if has_nan and fast:
        # Missing-data algebra (see chunk loop): precompute zero-filled
        # copies and per-side observation masks once.
        refs_z = np.nan_to_num(refs, nan=0.0)
        refs_missing = np.isnan(refs).astype(float)          # (M, d)
        refs_sq = refs_z * refs_z                            # (M, d)

    best_index = np.full(n, -1, dtype=np.int64)
    best_distance = np.full(n, np.inf)
    second_distance = np.full(n, np.nan)
    repeats = np.zeros(n, dtype=np.int64)
    nndr = np.zeros(n)
    near_miss = np.zeros(n, dtype=np.int64)
    top_k_lists = [] if top_k > 0 else None
    histograms = [] if hist_bins > 0 else None

    # Fused MNN: running per-supplemental-row minimum across all targets.
    col_min = np.full(m, np.inf)

    n_chunks = (n + chunk_size - 1) // chunk_size
    for c in range(n_chunks):
        lo = c * chunk_size
        hi = min(lo + chunk_size, n)
        chunk = targets[lo:hi]

        # (t, M, d) broadcast. The exact path (default) reproduces the
        # per-row euclidean_distance bitwise: same subtract, square, np.sum
        # reduction and penalty writes per cell, independent of chunk_size.
        # The fast path fuses the reduction (einsum) and computes missing-
        # data corrections as inner products — up to 1 ulp accumulation
        # drift; see the docstring.
        diff = chunk[:, None, :] - refs[None, :, :]
        if has_nan and fast:
            # Zero-fill + corrections: with az/bz = values (NaN -> 0),
            #   base(i,j)  = sum_d (az - bz)^2      (einsum, one broadcast pass)
            # overcounts a^2 on dims where only the target is observed and
            # b^2 where only the ref is observed; both corrections are exact
            # inner products against the miss masks (0/1), so complete pairs
            # get correction 0 exactly. Mutually missing dims contribute 0 to
            # every term and are charged MISSING_PENALTY via n_obs.
            chunk_z = np.nan_to_num(chunk, nan=0.0)
            chunk_missing = np.isnan(chunk).astype(float)     # (t, d)
            chunk_obs = 1.0 - chunk_missing                   # (t, d)
            diff = chunk_z[:, None, :] - refs_z[None, :, :]
            sq = np.einsum("tmd,tmd->tm", diff, diff)
            sq -= (chunk_z * chunk_z) @ refs_missing.T        # a^2 where b missing
            sq -= chunk_missing @ refs_sq.T                   # b^2 where a missing
            n_obs = chunk_obs @ (1.0 - refs_missing).T
            np.maximum(sq, 0.0, out=sq)                       # guard fp round-down
            sq += MISSING_PENALTY * (d - n_obs)
            dists = np.sqrt(sq)
            dists[n_obs == 0] = np.inf
        elif has_nan:
            observed = ~np.isnan(diff)
            np.multiply(diff, diff, out=diff)
            diff[~observed] = MISSING_PENALTY
            n_obs = observed.sum(axis=2)
            dists = np.sqrt(diff.sum(axis=2))
            dists[n_obs == 0] = np.inf
        elif fast:
            dists = np.sqrt(np.einsum("tmd,tmd->tm", diff, diff))
        else:
            np.multiply(diff, diff, out=diff)
            dists = np.sqrt(diff.sum(axis=2))

        np.minimum(col_min, dists.min(axis=0), out=col_min)

        # Per-target stats, vectorized across the chunk's rows. Semantics
        # match cascading_nndr / compute_sorted_distances exactly (the
        # equivalence is pinned by tests/test_match_all.py).
        t = hi - lo
        rows = np.arange(t)
        j_arr = np.argmin(dists, axis=1)
        d1_arr = dists[rows, j_arr]
        matched_rows = ~np.isinf(d1_arr)

        best_distance[lo:hi] = d1_arr
        best_index[lo:hi] = np.where(matched_rows, j_arr, -1)
        nndr[lo:hi] = np.where(matched_rows, 0.0, 1.0)
        repeats[lo:hi] = np.where(
            matched_rows, (dists == d1_arr[:, None]).sum(axis=1), 0
        )

        if m >= 2:
            d2_arr = np.partition(dists, 1, axis=1)[:, 1]
            second_distance[lo:hi] = np.where(np.isfinite(d2_arr), d2_arr, np.nan)

            # d1 > 0: nndr = d1/d2; near_miss counts d1/di >= threshold.
            pos = matched_rows & (d1_arr > 0)
            if pos.any():
                nndr_pos = d1_arr[pos] / d2_arr[pos]
                with np.errstate(divide="ignore", invalid="ignore"):
                    counts = (d1_arr[pos, None] / dists[pos] >= threshold).sum(axis=1)
                nndr[lo:hi][pos] = nndr_pos
                near_miss[lo:hi][pos] = counts - 1

            # d1 == 0 with d2 == 0: tied exact matches — maximally ambiguous.
            zero_tied = matched_rows & (d1_arr == 0) & (d2_arr == 0)
            if zero_tied.any():
                nndr[lo:hi][zero_tied] = 1.0
                near_miss[lo:hi][zero_tied] = (dists[zero_tied] == 0.0).sum(axis=1) - 1
            # d1 == 0 with d2 > 0: uniquely exact — nndr 0, near_miss 0 (defaults).

        if top_k_lists is not None or histograms is not None:
            for r in range(t):
                dv = dists[r]
                if not matched_rows[r]:
                    if top_k_lists is not None:
                        top_k_lists.append([])
                    if histograms is not None:
                        histograms.append(([], []))
                    continue
                finite = dv[np.isfinite(dv)]
                if top_k_lists is not None:
                    k = min(top_k, finite.size)
                    top_k_lists.append(
                        np.sort(np.partition(finite, k - 1)[:k]).tolist() if k > 0 else []
                    )
                if histograms is not None:
                    if finite.size:
                        counts, edges = np.histogram(finite, bins=hist_bins)
                        histograms.append((counts.tolist(), edges.tolist()))
                    else:
                        histograms.append(([], []))

        if progress_cb is not None:
            try:
                progress_cb((c + 1) / n_chunks)
            except Exception:
                pass

    # A match is MNN-confirmed when the target's distance to its matched
    # supplemental row equals that row's minimum over ALL targets — the same
    # comparison mnn_confirmed makes, read off the identical distance matrix.
    confirmed = np.zeros(n, dtype=bool)
    matched = best_index >= 0
    confirmed[matched] = (
        best_distance[matched] == col_min[best_index[matched]]
    )

    result = {
        "best_index": best_index,
        "best_distance": best_distance,
        "second_distance": second_distance,
        "repeats": repeats,
        "nndr": nndr,
        "near_miss": near_miss,
        "mnn_confirmed": confirmed,
    }
    if top_k_lists is not None:
        result["top_k"] = top_k_lists
    if histograms is not None:
        result["histograms"] = histograms
    return result


def brute_find_best_match(target_row, reference_rows):
    """
    Brute-force search for the closest row in reference_rows.
    Returns ((best_distance, best_index), repeat_count).
    repeat_count tracks exact-distance ties.

    When no reference row shares an observed dimension with the target,
    best_distance is inf, best_index is None and repeat_count is 0.
    """
    best_distance = np.inf
    best_index = None
    repeat_count = 0

    for i, ref_row in enumerate(reference_rows):
        d = euclidean_distance(target_row, ref_row)
        if d < best_distance:
            best_distance = d
            best_index = i
            repeat_count = 1
        elif d == best_distance and best_index is not None:
            repeat_count += 1

    return (best_distance, best_index), repeat_count
