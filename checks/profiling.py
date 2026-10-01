"""Field profiling + dependency discovery for an analysed dataset.

Closes the gap against SAP Information Steward's column profiling: every
analysed version carries, per object (module), a profile of each field of the
tables the object's rules read, plus candidate "hidden rules" — functional
dependencies that hold for almost, but not all, records.

Everything here is deterministic pandas / numpy over the frames the check
engine already built: no sampling randomness, no ML, no LLM. Output is plain
JSON-safe dicts so the worker can persist it as-is.

Privacy (POPIA / GDPR): actual values (top values) are stored only for
code-like fields (≤ 50 distinct values and DDIC length ≤ 10) and never for HR /
person tables or fields whose name or data element suggests names, addresses,
bank, tax, personal IDs or contact data. Masked fields still get counts and
shapes — a shape ("AA99 9999") is a format, not a value.
"""

from __future__ import annotations

import re
from typing import Any, Optional

import numpy as np
import pandas as pd

from checks.base import is_blank, record_keys, sap_number
from checks.frames import TableFrames

# ── limits ───────────────────────────────────────────────────────────────────

MAX_PROFILE_ROWS = 200_000      # per table; the first N rows (deterministic head)
TOP_SHAPES = 5
SHAPE_CAP = 20                  # characters of a shape kept
TOP_VALUES = 10
CODE_MAX_DISTINCT = 50          # top values only for code-like fields …
CODE_MAX_LENGTH = 10            # … whose DDIC length is at most this

DEP_MIN_DISTINCT = 2
DEP_MAX_DISTINCT = 200
DEP_MAX_DISTINCT_SHARE = 0.20   # of the table's rows
DEP_MAX_CANDIDATES = 30         # columns per table → at most 870 ordered pairs
DEP_SAMPLE_KEYS = 5
DEP_MAX_PER_TABLE = 50

_CLIENT_FIELDS = {"MANDT", "CLIENT", "RCLNT"}

# ABAP DDIC types whose values are numbers (NUMC is a digit *string*: IDs, not amounts)
NUMERIC_TYPES = {"DEC", "CURR", "QUAN", "INT1", "INT2", "INT4", "INT8", "FLTP",
                 "D16N", "D34N", "D16D", "D34D", "D16R", "D34R", "D16S", "D34S", "DF16_DEC", "DF34_DEC"}

# ── privacy masking ──────────────────────────────────────────────────────────

SENSITIVE_TABLE_PREFIXES = ("PA", "HRPY", "ZMERIDIAN", "PERINFO", "PERPHONE", "PEREMAIL",
                            "PERADDRESS", "EMPEMPLOYMENT")

# name*, address*, bank, tax, personal-ID and contact fields (field name or data element)
_SENSITIVE_PREFIX = ("NAME", "ORT", "CITY", "POST_CODE", "TEL", "SMTP", "STCD", "USRID",
                     # same meaning, other spellings (canonical / non-ABAP schemas)
                     "STREET", "FIRSTNAME", "FIRST_NAME", "LASTNAME", "LAST_NAME", "EMAIL", "PHONE", "FAX")
_SENSITIVE_EXACT = {"STRAS", "PSTLZ", "BANKN", "IBAN", "STCEG", "PERID", "ICNUM",
                    "BANKL", "SWIFT", "GBDAT", "GBORT"}


def _sensitive_name(name: Optional[str]) -> bool:
    if not name:
        return False
    n = name.upper()
    # data elements carry a namespace / component prefix: AD_SMTPADR, BU_NAMEOR1, /ABC/NAME
    variants = {n, n.rsplit("/", 1)[-1]}
    variants |= {v.split("_", 1)[1] for v in list(variants) if "_" in v and len(v.split("_", 1)[0]) <= 3}
    # ... or a suffix: STRAS_GP, PSTLZ_HR
    variants |= {v.split("_", 1)[0] for v in list(variants) if "_" in v}
    return any(v in _SENSITIVE_EXACT or v.startswith(_SENSITIVE_PREFIX) for v in variants)


def is_sensitive(table: str, field: str, data_element: Optional[str] = None) -> bool:
    """True when the field's values must never be stored (POPIA / GDPR)."""
    if table.upper().startswith(SENSITIVE_TABLE_PREFIXES):
        return True
    return _sensitive_name(field) or _sensitive_name(data_element)


# ── shapes ───────────────────────────────────────────────────────────────────

_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)
_DIGIT = re.compile(r"\d", re.UNICODE)


def shape_of(value: str) -> str:
    """'ZA-1234 b' → 'AA-9999 A' (letters A, digits 9, everything else kept), ≤ 20 chars."""
    return _DIGIT.sub("9", _LETTER.sub("A", value))[:SHAPE_CAP]


def _shapes(values: pd.Series) -> pd.Series:
    return (values.str.replace(_LETTER.pattern, "A", regex=True)
            .str.replace(_DIGIT.pattern, "9", regex=True).str.slice(0, SHAPE_CAP))


def _top(counts: pd.Series, n: int) -> list[tuple[str, int]]:
    """Most frequent first; ties by value — deterministic."""
    items = sorted(((str(k), int(v)) for k, v in counts.items()), key=lambda kv: (-kv[1], kv[0]))
    return items[:n]


# ── field profile ────────────────────────────────────────────────────────────


def _dates(values: pd.Series) -> pd.Series:
    """YYYYMMDD (RFC) or YYYY-MM-DD (uploads) → Timestamp, else NaT."""
    s = values.str.replace(r"^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$", r"\1\2\3", regex=True)
    return pd.to_datetime(s, format="%Y%m%d", errors="coerce")


def profile_series(series: pd.Series, table: str, field: str, dictionary: Any = None,
                   sampled: bool = False, table_rows: Optional[int] = None) -> dict:
    """JSON-safe stats for one column (see module docstring for masking)."""
    f = dictionary.field(table, field) if dictionary is not None else None
    ddic_type = (f.type or "").upper() if f else None
    ddic_length = int(f.length) if f and f.length else None

    rows = int(len(series))
    blank_mask = is_blank(series) if rows else pd.Series(dtype=bool)
    blank = int(blank_mask.sum())
    values = series[~blank_mask].astype("string").str.strip()
    filled = int(len(values))
    counts = values.value_counts(sort=False)
    distinct = int(len(counts))
    lengths = values.str.len()

    stats: dict[str, Any] = {
        "rows": rows,
        "table_rows": int(table_rows if table_rows is not None else rows),
        "sampled": bool(sampled),
        "blank": blank,
        "blank_pct": round(blank / rows * 100, 2) if rows else 0.0,
        "distinct": distinct,
        "min_length": int(lengths.min()) if filled else None,
        "max_length": int(lengths.max()) if filled else None,
        "ddic_type": ddic_type,
        "ddic_length": ddic_length,
        "description": (f.description or None) if f else None,
    }

    if ddic_type in NUMERIC_TYPES and filled:
        n = sap_number(values)
        ok = n.dropna()
        stats["numeric"] = {
            "min": float(ok.min()) if len(ok) else None,
            "max": float(ok.max()) if len(ok) else None,
            "mean": round(float(ok.mean()), 6) if len(ok) else None,
            "non_numeric": int(filled - len(ok)),
        }
    if ddic_type == "DATS" and filled:
        d = _dates(values)
        ok = d.dropna()
        stats["dates"] = {
            "min": ok.min().strftime("%Y-%m-%d") if len(ok) else None,
            "max": ok.max().strftime("%Y-%m-%d") if len(ok) else None,
            "invalid": int(filled - len(ok)),
        }

    shape_counts = _shapes(values).value_counts(sort=False) if filled else pd.Series(dtype="int64")
    stats["shapes"] = [{"shape": s, "count": c, "share": round(c / filled, 4)}
                       for s, c in _top(shape_counts, TOP_SHAPES)]
    stats["shape_count"] = int(len(shape_counts))

    if is_sensitive(table, field, f.data_element if f else None):
        stats.update(masked=True, mask_reason="privacy", top_values=None)
    elif ddic_length is None or ddic_length > CODE_MAX_LENGTH or distinct > CODE_MAX_DISTINCT:
        stats.update(masked=True, mask_reason="not_code_like", top_values=None)
    else:
        stats.update(masked=False, mask_reason=None,
                     top_values=[{"value": v, "count": c} for v, c in _top(counts, TOP_VALUES)])
    return stats


def table_frame(frames: TableFrames, table: str) -> Optional[pd.DataFrame]:
    """The per-table frame, or the table's columns of a flat upload that could not be split."""
    if table in frames.frames:
        return frames.frames[table]
    if frames.flat is not None and table in frames.unsplittable:
        cols = [c for c in frames.flat.columns if str(c).startswith(table + ".")]
        return frames.flat[cols] if cols else None
    return None


def _fields_of(df: pd.DataFrame, table: str) -> list[str]:
    out = []
    for c in df.columns:
        c = str(c)
        if c.startswith(table + ".") and c.split(".", 1)[1].upper() not in _CLIENT_FIELDS:
            out.append(c)
    return out


def sample(df: pd.DataFrame, max_rows: int = MAX_PROFILE_ROWS) -> tuple[pd.DataFrame, bool]:
    """Deterministic bound: the first ``max_rows`` rows."""
    return (df.head(max_rows), True) if len(df) > max_rows else (df, False)


def profile_frames(frames: TableFrames, dictionary: Any, tables: list[str],
                   max_rows: int = MAX_PROFILE_ROWS) -> list[dict]:
    """One record per ``TABLE.FIELD``: ``{"table", "field", "stats"}``.

    Tables not in ``frames`` are skipped. At most ``max_rows`` rows per table are
    read (``stats["sampled"]`` then True, ``stats["table_rows"]`` the full count).
    """
    dictionary = dictionary if dictionary is not None else frames.dictionary
    out: list[dict] = []
    for table in dict.fromkeys(tables):
        df = table_frame(frames, table)
        if df is None:
            continue
        part, sampled = sample(df, max_rows)
        for pos, col in enumerate(_fields_of(part, table)):
            field = col.split(".", 1)[1]
            stats = profile_series(part[col], table, field, dictionary, sampled, len(df))
            stats["position"] = pos  # column order of the extract
            out.append({"table": table, "field": field, "stats": stats})
    return out


# ── dependency discovery ─────────────────────────────────────────────────────


def _codes(series: pd.Series) -> tuple[np.ndarray, np.ndarray, int]:
    """(codes, populated mask, cardinality) — blanks are one value "" (code 0 when present)."""
    s = series.astype("string").str.strip().fillna("")
    s = s.where(~is_blank(series), "")
    codes, uniques = pd.factorize(s, sort=True)
    return codes.astype(np.int64), (s != "").to_numpy(), len(uniques)


def discover_dependencies(frame: pd.DataFrame, cols: list[str], min_support: float = 0.99,
                          min_rows: int = 50, key_cols: Optional[list[str]] = None,
                          max_candidates: int = DEP_MAX_CANDIDATES,
                          max_results: int = DEP_MAX_PER_TABLE) -> list[dict]:
    """Candidate hidden rules A → B inside one table.

    Candidates are low-cardinality columns: 2–200 distinct populated values and at
    most 20 % of the rows; the first ``max_candidates`` of ``cols`` (in order)
    qualifying. For each ordered pair, among rows with A populated, B's most
    common value per A value is "expected"; ``support`` is the share of rows that
    agree. Reported when ``min_support ≤ support < 1`` and A explains at least
    half of B's own variation (so a near-constant B is not "determined" by every
    column). Violations are the disagreeing rows; ``sample_keys`` up to five of
    their DDIC record keys (``row:<n>`` without keys). Values are never reported.
    """
    n = len(frame)
    if n < min_rows:
        return []
    cand: list[str] = []
    enc: dict[str, tuple[np.ndarray, np.ndarray, int]] = {}
    for c in cols:
        if c not in frame.columns:
            continue
        codes, pop, card = _codes(frame[c])
        distinct = card - (1 if (~pop).any() else 0)
        if DEP_MIN_DISTINCT <= distinct <= DEP_MAX_DISTINCT and distinct <= DEP_MAX_DISTINCT_SHARE * n:
            cand.append(c)
            enc[c] = (codes, pop, card)
            if len(cand) >= max_candidates:
                break

    keys = [k for k in (key_cols or []) if k in frame.columns]
    out: list[dict] = []
    for a in cand:
        a_codes, a_pop, a_card = enc[a]
        populated = int(a_pop.sum())
        if populated < min_rows:
            continue
        a_sel = a_codes[a_pop]
        for b in cand:
            if b == a:
                continue
            b_codes, _, b_card = enc[b]
            b_sel = b_codes[a_pop]
            table = np.bincount(a_sel * b_card + b_sel, minlength=a_card * b_card).reshape(a_card, b_card)
            agree = int(table.max(axis=1).sum())
            support = agree / populated
            if support < min_support or agree == populated:
                continue
            base = int(np.bincount(b_sel, minlength=b_card).max()) / populated
            if (1 - support) > 0.5 * (1 - base):
                continue  # B is nearly constant anyway: A adds little
            expected = table.argmax(axis=1)  # ties → smallest value (factorize sort=True)
            bad_pos = np.flatnonzero(a_pop)[b_sel != expected[a_sel]]
            first = bad_pos[:DEP_SAMPLE_KEYS]
            if keys:
                sample_keys = [str(k) for k in record_keys(frame.iloc[first], keys)]
            else:
                sample_keys = [f"row:{int(p)}" for p in first]
            out.append({
                "determinant": a, "dependent": b,
                "support": round(support, 6),
                "rows": populated,
                "violations": int(populated - agree),
                "determinant_values": int((a_card - (1 if (~a_pop).any() else 0))),
                "sample_keys": sample_keys,
            })
    out.sort(key=lambda d: (-d["support"], d["determinant"], d["dependent"]))
    return out[:max_results]


def profile_module(frames: TableFrames, dictionary: Any, tables: list[str],
                   max_rows: int = MAX_PROFILE_ROWS) -> tuple[list[dict], list[dict]]:
    """(field profiles, dependencies) for a module's tables, on the same bounded sample."""
    dictionary = dictionary if dictionary is not None else frames.dictionary
    profiles = profile_frames(frames, dictionary, tables, max_rows)
    deps: list[dict] = []
    for table in dict.fromkeys(tables):
        df = table_frame(frames, table)
        if df is None:
            continue
        part, sampled = sample(df, max_rows)
        keys = [f"{table}.{k}" for k in dictionary.keys(table)] if dictionary is not None else []
        for d in discover_dependencies(part, _fields_of(part, table), key_cols=keys):
            deps.append({"table": table, **d, "sampled": sampled})
    return profiles, deps
