"""Tests run as a development deployment (no licence key needed; see api/middleware/licence.py)."""

import os

os.environ.setdefault("MERIDIAN_ENV", "development")
