with_temp_dir <- function(code) {
  dir <- tempfile("acs_matcher_r_")
  dir.create(dir, showWarnings = FALSE, recursive = TRUE)
  old <- setwd(dir)
  on.exit(setwd(old), add = TRUE)
  force(code)
}

test_that("matches participants and writes outputs", {
  with_temp_dir({
    set.seed(42)
    N <- 100
    N_UNMATCH <- 5
    N_MATCH <- N - N_UNMATCH

    acs <- data.frame(
      geoid = as.character(seq(100000, by = 1, length.out = N)),
      feature_1 = round(runif(N, 0.1, 1.0), 4),
      feature_2 = round(runif(N, 20000, 80000), 2),
      feature_3 = round(runif(N, 0.2, 0.9), 4),
      stringsAsFactors = FALSE
    )
    acs$new_feature <- 0.5 * acs$feature_1 +
      0.00001 * acs$feature_2 +
      0.25 * acs$feature_3

    utils::write.csv(acs, "acs_sim.csv", row.names = FALSE)

    participants <- data.frame(
      id = seq_len(N) - 1,
      feature_1 = NA_real_,
      feature_2 = NA_real_,
      feature_3 = NA_real_,
      stringsAsFactors = FALSE
    )

    noise <- function(n) runif(n, -1e-4, 1e-4)
    participants$feature_1[seq_len(N_MATCH)] <- acs$feature_1[seq_len(N_MATCH)] * (1 + noise(N_MATCH))
    participants$feature_2[seq_len(N_MATCH)] <- acs$feature_2[seq_len(N_MATCH)] * (1 + noise(N_MATCH))
    participants$feature_3[seq_len(N_MATCH)] <- acs$feature_3[seq_len(N_MATCH)] * (1 + noise(N_MATCH))

    unmatched_idx <- seq(N_MATCH + 1, N)
    participants$feature_1[unmatched_idx] <- runif(N_UNMATCH, 5, 10)
    participants$feature_2[unmatched_idx] <- runif(N_UNMATCH, 200000, 300000)
    participants$feature_3[unmatched_idx] <- runif(N_UNMATCH, 5, 10)

    utils::write.csv(participants, "participants_sim.csv", row.names = FALSE)

    res <- match_participants("acs_sim.csv", "participants_sim.csv", rtol = 0.005)

    expect_true(file.exists(res$matched_path))
    expect_true(file.exists(res$unmatched_path))

    matched <- utils::read.csv(res$matched_path, stringsAsFactors = FALSE)
    unmatched <- utils::read.csv(res$unmatched_path, stringsAsFactors = FALSE)

    expect_equal(nrow(matched), N_MATCH)
    expect_equal(nrow(unmatched), N_UNMATCH)

    expected_cols <- c(names(participants), "new_feature", "tract_alias")
    expect_true(all(expected_cols %in% names(matched)))
    expect_true(all(nchar(matched$tract_alias) == 14)) # "alias_" + 8 hex
  })
})

test_that("errors when overlap is missing", {
  with_temp_dir({
    acs <- data.frame(
      geoid = c("g1"),
      feature_a = 1,
      new_feature = 10,
      stringsAsFactors = FALSE
    )
    participants <- data.frame(
      id = "p1",
      feature_b = 1,
      stringsAsFactors = FALSE
    )
    utils::write.csv(acs, "acs.csv", row.names = FALSE)
    utils::write.csv(participants, "participants.csv", row.names = FALSE)

    expect_error(match_participants("acs.csv", "participants.csv"))
  })
})
