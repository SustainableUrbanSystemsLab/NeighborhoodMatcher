with_temp_dir <- function(code) {
  dir <- tempfile("acs_matcher_r_")
  dir.create(dir, showWarnings = FALSE, recursive = TRUE)
  old <- setwd(dir)
  on.exit(setwd(old), add = TRUE)
  force(code)
}

test_that("matches participants and writes outputs", {
  with_temp_dir({
    acs <- data.frame(
      geoid = c("g1", "g2"),
      feature_a = c(100, 200),
      feature_b = c(50, 75),
      new_feature = c(1.1, 2.2),
      stringsAsFactors = FALSE
    )

    participants <- data.frame(
      id = c("p1", "p2", "p3"),
      feature_a = c("100", "205", NA),
      feature_b = c("50.2", "74.9", "50"),
      stringsAsFactors = FALSE
    )

    utils::write.csv(acs, "acs.csv", row.names = FALSE)
    utils::write.csv(participants, "participants.csv", row.names = FALSE)

    res <- match_participants("acs.csv", "participants.csv", rtol = 0.05)

    expect_true(file.exists(res$matched_path))
    expect_true(file.exists(res$unmatched_path))

    matched <- utils::read.csv(res$matched_path, stringsAsFactors = FALSE)
    expect_equal(matched$id, c("p1", "p2", "p3"))
    expect_equal(matched$new_feature, c(1.1, 2.2, 1.1))
    expect_true("tract_alias" %in% names(matched))
    expect_true(all(nchar(matched$tract_alias) == 14)) # "alias_" + 8 hex

    unmatched <- utils::read.csv(res$unmatched_path, stringsAsFactors = FALSE)
    expect_equal(nrow(unmatched), 0)
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
