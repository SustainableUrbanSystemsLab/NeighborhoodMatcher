import pandas as pd
import numpy as np

# -------------------------------------------------------------
# IMPORT TOOL
# -------------------------------------------------------------
from acs_matcher import match_participants_to_new_feature

np.random.seed(42)

N = 100
N_UNMATCH = 5
N_MATCH = N - N_UNMATCH

# -------------------------------------------------------------
# Create ACS table
# -------------------------------------------------------------
acs = pd.DataFrame({
    "geoid": np.arange(100000, 100000+N).astype(str),
    "feature_1": np.round(np.random.uniform(0.1, 1.0, N), 4),
    "feature_2": np.round(np.random.uniform(20000, 80000, N), 2),
    "feature_3": np.round(np.random.uniform(0.2, 0.9, N), 4),
})

acs["new_feature"] = (
    0.5*acs["feature_1"] +
    0.00001*acs["feature_2"] +
    0.25*acs["feature_3"]
)

acs_path = "acs_sim_fixed.csv"
acs.to_csv(acs_path, index=False)

# -------------------------------------------------------------
# Create participant table
# -------------------------------------------------------------
participants = pd.DataFrame({"id": np.arange(N)})

# Noise guaranteed < 0.1% of each feature
participants.loc[:N_MATCH-1, "feature_1"] = acs["feature_1"][:N_MATCH] * (1 + np.random.uniform(-0.0001, 0.0001, N_MATCH))
participants.loc[:N_MATCH-1, "feature_2"] = acs["feature_2"][:N_MATCH] * (1 + np.random.uniform(-0.0001, 0.0001, N_MATCH))
participants.loc[:N_MATCH-1, "feature_3"] = acs["feature_3"][:N_MATCH] * (1 + np.random.uniform(-0.0001, 0.0001, N_MATCH))

# 5 intentionally unmatched rows
participants.loc[N_MATCH:, "feature_1"] = np.random.uniform(5, 10, N_UNMATCH)
participants.loc[N_MATCH:, "feature_2"] = np.random.uniform(200000, 300000, N_UNMATCH)
participants.loc[N_MATCH:, "feature_3"] = np.random.uniform(5, 10, N_UNMATCH)

participant_path = "participants_sim_fixed.csv"
participants.to_csv(participant_path, index=False)

# -------------------------------------------------------------
# Run matcher
# -------------------------------------------------------------
matched_path, unmatched_path = match_participants_to_new_feature(
    acs_csv_path=acs_path,
    participant_csv_path=participant_path,
    rtol=0.005
)

matched = pd.read_csv(matched_path)
unmatched = pd.read_csv(unmatched_path)

print("MATCHED:", len(matched))
print("UNMATCHED:", len(unmatched))

# Assertions for the report
assert len(matched) == N_MATCH, f"Expected {N_MATCH}, got {len(matched)}"
assert len(unmatched) == N_UNMATCH, f"Expected {N_UNMATCH}, got {len(unmatched)}"

print("\nSUCCESS: 95 matched, 5 unmatched exactly.")
