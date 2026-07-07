# Match participant rows to ACS tracts and copy over `new_feature`.
# Mirrors the Python implementation in `acs_matcher.match_participants`.

# NOTE: Requires the 'digest' package for SHA1.
# install.packages("digest")

# Deterministic alias for a GEOID (matches Python hashlib.sha1(str(geoid).encode("utf-8")).hexdigest()[:8])
.alias_for_geoid <- function(geoid) {
  s <- enc2utf8(as.character(geoid))
  h <- digest::digest(s, algo = "sha1", serialize = FALSE)
  paste0("alias_", substr(h, 1, 8))
}

# Convert a vector to numeric where possible, robust to commas and mixed text.
# Non-parsable values become NA.
.to_numeric_series <- function(x) {
  if (is.numeric(x)) {
    return(suppressWarnings(as.numeric(x)))
  }
  
  parse_cell <- function(val) {
    if (is.na(val)) {
      return(NA_real_)
    }
    cleaned <- gsub(",", "", as.character(val), perl = TRUE)
    m <- regexpr("[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?", cleaned, perl = TRUE)
    if (m[1] == -1) {
      return(NA_real_)
    }
    as.numeric(substr(cleaned, m[1], m[1] + attr(m, "match.length") - 1))
  }
  
  vapply(x, parse_cell, numeric(1))
}

# Match participant rows to ACS tracts and copy over `new_feature`.
#This mirrors the Python implementation in `acs_matcher.match_participants`.

#' @param acs_csv_path Path to ACS CSV with columns: geoid, neighborhood features, new_feature
#' @param participant_csv_path Path to participant CSV with columns: id, subset of neighborhood features
#' @param rtol Relative tolerance for matching (default 0.005 = 0.5%)

#' @return A named list with matched_path and unmatched_path
match_participants <- function(acs_csv_path, participant_csv_path, rtol = 0.005) {
  eps <- 1e-12
  
  # Read everything as character to mirror Python pd.read_csv(..., dtype=str)
  acs_df <- utils::read.csv(acs_csv_path, colClasses = "character", check.names = FALSE)
  user_df <- utils::read.csv(participant_csv_path, colClasses = "character", check.names = FALSE)
  
  names(acs_df) <- trimws(names(acs_df))
  names(user_df) <- trimws(names(user_df))
  
  # Required columns
  if (!("id" %in% names(user_df))) {
    stop("Participant file must contain an 'id' column.")
  }
  if (!("geoid" %in% names(acs_df))) {
    stop("ACS data file must contain a 'geoid' column.")
  }
  if (!("new_feature" %in% names(acs_df))) {
    stop("ACS data file must contain a 'new_feature' column.")
  }
  
  # Features and overlap
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
  
  # Numeric versions for comparison (outputs keep original character values)
  user_cmp <- data.frame(lapply(user_df[overlap], .to_numeric_series), check.names = FALSE)
  acs_cmp  <- data.frame(lapply(acs_df[overlap], .to_numeric_series), check.names = FALSE)
  
  # Ensure at least one participant row has some numeric data
  if (sum(rowSums(!is.na(user_cmp)) > 0) == 0) {
    stop("All participant rows are empty/NaN across the overlapping columns.")
  }
  
  # Precompute ACS arrays
  acs_vals  <- as.matrix(acs_cmp)  # numeric matrix (M, K)
  storage.mode(acs_vals) <- "double"
  
  acs_new   <- suppressWarnings(as.numeric(acs_df[["new_feature"]]))
  acs_alias <- vapply(acs_df[["geoid"]], .alias_for_geoid, character(1), USE.NAMES = FALSE)
  
  matched_rows <- list()
  unmatched_rows <- list()
  
  for (i in seq_len(nrow(user_df))) {
    row_cmp <- user_cmp[i, , drop = FALSE]          # 1-row data.frame of numeric comparisons
    valid_cols <- which(!is.na(row_cmp[1, ]))       # indices of overlap cols with values for this participant
    
    if (length(valid_cols) == 0) {
      unmatched_rows[[length(unmatched_rows) + 1]] <- user_df[i, , drop = FALSE]
      next
    }
    
    # Participant vector and ACS matrix restricted to valid columns
    uv <- as.numeric(row_cmp[1, valid_cols, drop = TRUE])  # numeric vector length = K_valid
    av <- acs_vals[, valid_cols, drop = FALSE]             # (M, K_valid)
    
    # Relative diffs: denom = max(max(|av|, |uv|), eps)
    uv_mat <- matrix(uv, nrow = nrow(av), ncol = length(uv), byrow = TRUE)
    denom <- pmax(pmax(abs(av), abs(uv_mat)), eps)
    rel <- abs(av - uv_mat) / denom
    
    # Require ALL provided features within tolerance
    within <- apply(rel <= rtol, 1, all)
    
    if (any(within)) {
      cand_rel <- rel[within, , drop = FALSE]
      mean_rel <- rowMeans(cand_rel)
      best_idx_within <- which.min(mean_rel)
      best_global_idx <- which(within)[best_idx_within]
      
      out_row <- cbind(
        user_df[i, , drop = FALSE],
        data.frame(
          new_feature = acs_new[best_global_idx],
          tract_alias = acs_alias[best_global_idx],
          check.names = FALSE,
          stringsAsFactors = FALSE
        )
      )
      matched_rows[[length(matched_rows) + 1]] <- out_row
    } else {
      unmatched_rows[[length(unmatched_rows) + 1]] <- user_df[i, , drop = FALSE]
    }
  }
  
  # Build outputs (keep original participant column order)
  matched_cols <- c(names(user_df), "new_feature", "tract_alias")
  matched_df <- if (length(matched_rows) > 0) {
    df <- do.call(rbind, matched_rows)
    df <- df[, matched_cols, drop = FALSE]
    df
  } else {
    stats::setNames(data.frame(matrix(ncol = length(matched_cols), nrow = 0), check.names = FALSE), matched_cols)
  }
  
  unmatched_df <- if (length(unmatched_rows) > 0) {
    do.call(rbind, unmatched_rows)
  } else {
    user_df[0, , drop = FALSE]
  }
  
  # Write next to participant file
  base <- tools::file_path_sans_ext(participant_csv_path)
  matched_path <- paste0(base, "_matched.csv")
  unmatched_path <- paste0(base, "_unmatched.csv")
  
  utils::write.csv(matched_df, matched_path, row.names = FALSE, quote = TRUE)
  utils::write.csv(unmatched_df, unmatched_path, row.names = FALSE, quote = TRUE)
  
  message("Matched: ", nrow(matched_df), ". Unmatched: ", nrow(unmatched_df))
  message(" - ", matched_path)
  message(" - ", unmatched_path)
  
  list(matched_path = matched_path, unmatched_path = unmatched_path)
}
