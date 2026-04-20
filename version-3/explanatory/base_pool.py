# NOTE: Human authorized
#
# Shared data pool for all explanatory scenarios.
# Values are adapted from U.S. Census Bureau American Community Survey (ACS) data.
# Column names have been replaced with illustrative labels for demonstration purposes.
#
# Real columns used:
#   Total population, Median age in years, pctUnits1Detached, Family households
# Source rows: census tracts from dataseta.csv (version-3/data/acs-test/real-data/)
#
# TARGET  — census tract 4013082019
# SUPP_BASE — 19 additional tracts; each scenario fills in a 20th row to create
#             its specific condition (exact match, rounding error, etc.)

import numpy as np

COLUMNS = [
    {
        "real":    "Total population",
        "silly":   "dragon_sightings",
        "display": "Dragon Sightings",
        "unit":    "count",
        "fmt":     "d",   # integer format
    },
    {
        "real":    "Median age in years",
        "silly":   "avg_wizard_age",
        "display": "Avg. Wizard Age",
        "unit":    "years",
        "fmt":     ".1f",
    },
    {
        "real":    "pctUnits1Detached",
        "silly":   "pct_leprechaun_cottages",
        "display": "Pct. Leprechaun Cottages",
        "unit":    "percent",
        "fmt":     ".1f",
    },
    {
        "real":    "Family households",
        "silly":   "goblin_family_units",
        "display": "Goblin Family Units",
        "unit":    "count",
        "fmt":     "d",
    },
]

DISPLAY_NAMES = [c["display"] for c in COLUMNS]
SILLY_NAMES   = [c["silly"]   for c in COLUMNS]

# Target row — census tract 4013082019
TARGET = np.array([2469.0, 40.2, 99.5, 649.0])

# 19 real supplemental rows. Each scenario appends a 20th row to create
# its specific condition. Order here is arbitrary (pipeline sorts by distance).
SUPP_BASE = np.array([
    [4701.0, 58.7, 100.0, 1519.0],  # 4013040519
    [4223.0, 36.3,  94.2, 1132.0],  # 4013040520
    [6303.0, 29.8, 100.0, 1490.0],  # 4013040521
    [4891.0, 34.4,  99.6, 1339.0],  # 4013050609
    [2524.0, 30.0,  99.5,  557.0],  # 4013060802
    [3885.0, 37.2, 100.0, 1004.0],  # 4013061020
    [6668.0, 32.0,  98.5, 1641.0],  # 4013061033
    [7389.0, 35.0, 100.0, 1851.0],  # 4013061035
    [5006.0, 30.1,  97.5, 1230.0],  # 4013061037
    [4158.0, 29.8,  99.4, 1089.0],  # 4013061040
    [3465.0, 47.9,  92.5, 1080.0],  # 4013071515
    [5094.0, 27.3, 100.0, 1041.0],  # 4013082017
    [3849.0, 42.2,  99.5, 1043.0],  # 4013082020
    [2512.0, 25.8,  96.1,  521.0],  # 4013082025
    [6516.0, 23.3,  99.3, 1385.0],  # 4013082204
    [5296.0, 25.4,  99.3, 1128.0],  # 4013082211
    [2948.0, 33.4,  98.5,  687.0],  # 4013092721
    [4822.0, 25.7,  98.2,  914.0],  # 4013112510
    [4555.0, 26.5,  99.4,  930.0],  # 4013112514
])
