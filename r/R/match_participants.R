#' Match participant rows to ACS tracts and copy over `new_feature`.
#'
#' This mirrors the Python implementation in `acs_matcher.match_participants`.
match_participants <- function(acs_csv_path, participant_csv_path, rtol = 0.005) {
  eps <- 1e-12

  acs_df <- utils::read.csv(acs_csv_path, stringsAsFactors = FALSE, check.names = FALSE)
  user_df <- utils::read.csv(participant_csv_path, stringsAsFactors = FALSE, check.names = FALSE)

  names(acs_df) <- trimws(names(acs_df))
  names(user_df) <- trimws(names(user_df))

  if (!("id" %in% names(user_df))) {
    stop("Participant file must contain an 'id' column.")
  }
  if (!("geoid" %in% names(acs_df))) {
    stop("ACS data file must contain a 'geoid' column.")
  }
  if (!("new_feature" %in% names(acs_df))) {
    stop("ACS data file must contain a 'new_feature' column.")
  }

  user_feature_cols <- setdiff(names(user_df), "id")
  acs_feature_cols <- setdiff(names(acs_df), c("geoid", "new_feature"))

  extra <- setdiff(user_feature_cols, acs_feature_cols)
  if (length(extra) > 0) {
    warning(
      "Columns in participant CSV not found in ACS Data (ignored): ",
      paste(extra, collapse = ", ")
    )
  }

  overlap <- intersect(user_feature_cols, acs_feature_cols)
  if (length(overlap) == 0) {
    stop("No overlapping neighborhood feature columns between participant CSV and ACS.")
  }

  user_cmp <- data.frame(lapply(user_df[overlap], .to_numeric_series), stringsAsFactors = FALSE)
  acs_cmp <- data.frame(lapply(acs_df[overlap], .to_numeric_series), stringsAsFactors = FALSE)

  if (sum(rowSums(!is.na(user_cmp)) > 0) == 0) {
    stop("All participant rows are empty/NaN across the overlapping columns.")
  }

  acs_vals <- as.matrix(data.frame(lapply(acs_cmp, as.numeric)))
  acs_new <- suppressWarnings(as.numeric(acs_df[["new_feature"]]))
  acs_alias <- vapply(acs_df[["geoid"]], .alias_for_geoid, character(1), USE.NAMES = FALSE)

  matched_rows <- list()
  unmatched_rows <- list()

  for (i in seq_len(nrow(user_df))) {
    row_cmp <- user_cmp[i, , drop = FALSE]
    valid_cols <- which(!is.na(row_cmp))

    if (length(valid_cols) == 0) {
      unmatched_rows[[length(unmatched_rows) + 1]] <- user_df[i, , drop = FALSE]
      next
    }

    uv <- as.numeric(row_cmp[valid_cols])
    av <- acs_vals[, valid_cols, drop = FALSE]

    uv_mat <- matrix(uv, nrow = nrow(av), ncol = length(uv), byrow = TRUE)
    denom <- pmax(pmax(abs(av), abs(uv_mat)), eps)
    rel <- abs(av - uv_mat) / denom
    within <- apply(rel <= rtol, 1, all)

    if (any(within)) {
      cand_rel <- rel[within, , drop = FALSE]
      mean_rel <- rowMeans(cand_rel)
      best_idx <- which.min(mean_rel)
      global_idx <- which(within)[best_idx]

      out_row <- cbind(
        user_df[i, , drop = FALSE],
        data.frame(
          new_feature = acs_new[global_idx],
          tract_alias = acs_alias[global_idx],
          stringsAsFactors = FALSE
        )
      )
      matched_rows[[length(matched_rows) + 1]] <- out_row
    } else {
      unmatched_rows[[length(unmatched_rows) + 1]] <- user_df[i, , drop = FALSE]
    }
  }

  matched_cols <- c(names(user_df), "new_feature", "tract_alias")
  matched_df <- if (length(matched_rows) > 0) {
    do.call(rbind, matched_rows)
  } else {
    stats::setNames(data.frame(matrix(ncol = length(matched_cols), nrow = 0)), matched_cols)
  }

  unmatched_df <- if (length(unmatched_rows) > 0) {
    do.call(rbind, unmatched_rows)
  } else {
    user_df[0, , drop = FALSE]
  }

  base <- tools::file_path_sans_ext(participant_csv_path)
  matched_path <- paste0(base, "_matched.csv")
  unmatched_path <- paste0(base, "_unmatched.csv")

  utils::write.csv(matched_df, matched_path, row.names = FALSE)
  utils::write.csv(unmatched_df, unmatched_path, row.names = FALSE)

  message("Matched: ", nrow(matched_df), ". Unmatched: ", nrow(unmatched_df))
  message(" - ", matched_path)
  message(" - ", unmatched_path)

  list(matched_path = matched_path, unmatched_path = unmatched_path)
}

.alias_for_geoid <- function(geoid) {
  h <- substring(digest::sha1(as.character(geoid)), 1, 8)
  paste0("alias_", h)
}

.to_numeric_series <- function(x) {
  if (is.numeric(x)) {
    return(as.numeric(x))
  }

  parse_cell <- function(val) {
    if (is.na(val)) {
      return(NA_real_)
    }
    cleaned <- gsub(",", "", as.character(val), fixed = FALSE)
    m <- regexpr("[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?", cleaned, perl = TRUE)
    if (m[1] == -1) {
      return(NA_real_)
    }
    as.numeric(substring(cleaned, m[1], m[1] + attr(m, "match.length") - 1))
  }

  vapply(x, parse_cell, numeric(1))
}
