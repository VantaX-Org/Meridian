"""SAP dates as they arrive from every source, to one ``datetime.date``.

RFC hands DATS over as ``YYYYMMDD`` text; uploads may carry ``YYYY-MM-DD``; a CSV read
through pandas turns a numeric date column into a float, so a value can reach the
database boundary as ``20221007.0`` or ``"20221007.0"``. SAP's initial date (``0`` /
``00000000``) is no date at all."""

from __future__ import annotations

import math
from datetime import date, datetime
from typing import Any, Optional


def parse_sap_date(value: Any) -> Optional[date]:
    """``YYYYMMDD`` as int, float, str or float-string (also ``YYYY-MM-DD`` and ISO
    timestamps) to a ``date``; ``None`` for 0, ``00000000``, blanks, NaN and anything
    that is not a real calendar date."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, float):
        if math.isnan(value) or value != int(value):
            return None
        value = int(value)
    if isinstance(value, int) and not isinstance(value, bool):
        s = str(value)
    else:
        s = str(value).strip()
        if s.endswith(".0"):
            s = s[:-2]
        if "T" in s or " " in s:  # ISO timestamp: keep the day
            s = s.split("T")[0].split(" ")[0]
        s = s.replace("-", "")
    if len(s) != 8 or not s.isdigit() or s == "00000000":
        return None
    try:
        return date(int(s[:4]), int(s[4:6]), int(s[6:]))
    except ValueError:
        return None
