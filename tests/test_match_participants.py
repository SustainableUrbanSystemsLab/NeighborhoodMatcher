import unittest
import pandas as pd
import numpy as np
import os
import tempfile
import shutil
from acs_matcher import match_participants_to_new_feature

class TestMatchParticipants(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        np.random.seed(42)
        
        self.N = 100
        self.N_UNMATCH = 5
        self.N_MATCH = self.N - self.N_UNMATCH
        
        # Create ACS table
        self.acs = pd.DataFrame({
            "geoid": np.arange(100000, 100000+self.N).astype(str),
            "feature_1": np.round(np.random.uniform(0.1, 1.0, self.N), 4),
            "feature_2": np.round(np.random.uniform(20000, 80000, self.N), 2),
            "feature_3": np.round(np.random.uniform(0.2, 0.9, self.N), 4),
        })
        
        self.acs["new_feature"] = (
            0.5*self.acs["feature_1"] +
            0.00001*self.acs["feature_2"] +
            0.25*self.acs["feature_3"]
        )
        
        self.acs_path = os.path.join(self.test_dir, "acs_sim.csv")
        self.acs.to_csv(self.acs_path, index=False)
        
        # Create participant table
        self.participants = pd.DataFrame({"id": np.arange(self.N)})
        
        # Noise guaranteed < 0.1% of each feature
        self.participants.loc[:self.N_MATCH-1, "feature_1"] = self.acs["feature_1"][:self.N_MATCH] * (1 + np.random.uniform(-0.0001, 0.0001, self.N_MATCH))
        self.participants.loc[:self.N_MATCH-1, "feature_2"] = self.acs["feature_2"][:self.N_MATCH] * (1 + np.random.uniform(-0.0001, 0.0001, self.N_MATCH))
        self.participants.loc[:self.N_MATCH-1, "feature_3"] = self.acs["feature_3"][:self.N_MATCH] * (1 + np.random.uniform(-0.0001, 0.0001, self.N_MATCH))
        
        # 5 intentionally unmatched rows
        self.participants.loc[self.N_MATCH:, "feature_1"] = np.random.uniform(5, 10, self.N_UNMATCH)
        self.participants.loc[self.N_MATCH:, "feature_2"] = np.random.uniform(200000, 300000, self.N_UNMATCH)
        self.participants.loc[self.N_MATCH:, "feature_3"] = np.random.uniform(5, 10, self.N_UNMATCH)
        
        self.participant_path = os.path.join(self.test_dir, "participants_sim.csv")
        self.participants.to_csv(self.participant_path, index=False)

    def tearDown(self):
        shutil.rmtree(self.test_dir)

    def test_matching_logic(self):
        matched_path, unmatched_path = match_participants_to_new_feature(
            acs_csv_path=self.acs_path,
            participant_csv_path=self.participant_path,
            rtol=0.005
        )
        
        matched = pd.read_csv(matched_path)
        unmatched = pd.read_csv(unmatched_path)
        
        self.assertEqual(len(matched), self.N_MATCH, f"Expected {self.N_MATCH} matched, got {len(matched)}")
        self.assertEqual(len(unmatched), self.N_UNMATCH, f"Expected {self.N_UNMATCH} unmatched, got {len(unmatched)}")
        
        # Verify columns in matched output
        expected_cols = list(self.participants.columns) + ["new_feature", "tract_alias"]
        self.assertTrue(all(col in matched.columns for col in expected_cols))

if __name__ == '__main__':
    unittest.main()
