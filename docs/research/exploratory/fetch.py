# How to run (from the repo root; stdlib only, needs network):
#   python3 -I docs/research/exploratory/fetch.py
# Writes the raw Elexon JSON into docs/research/exploratory/raw/ (git-ignored); files already there are reused.
"""Fetch WINDFOR + FUELHH WIND for January 2026 into raw/ next to this script (cached)."""

import json
import os
import urllib.request
from datetime import date, timedelta

RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")
os.makedirs(RAW, exist_ok=True)
BASE = "https://data.elexon.co.uk/bmrs/api/v1/datasets"


def get(url, path):
    if os.path.exists(path):
        return
    with urllib.request.urlopen(url, timeout=120) as r:
        data = r.read()
    json.loads(data)  # validate
    with open(path, "wb") as f:
        f.write(data)


# WINDFOR: chunk by 7-day publish windows
d = date(2025, 12, 31)
while d < date(2026, 2, 1):
    e = min(d + timedelta(days=7), date(2026, 2, 1))
    url = f"{BASE}/WINDFOR/stream?publishDateTimeFrom={d}T00:00:00Z&publishDateTimeTo={e}T00:00:00Z"
    get(url, os.path.join(RAW, f"windfor_{d}.json"))
    d = e

# FUELHH WIND: one call per ~week of settlement dates
d = date(2026, 1, 1)
while d <= date(2026, 2, 1):
    e = min(d + timedelta(days=6), date(2026, 2, 1))
    url = f"{BASE}/FUELHH/stream?settlementDateFrom={d}&settlementDateTo={e}&fuelType=WIND"
    get(url, os.path.join(RAW, f"fuelhh_{d}.json"))
    d = e + timedelta(days=1)
print("ok", sorted(os.listdir(RAW)))
