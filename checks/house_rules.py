"""Learned house rules: implicit rules a tenant's own data follows for at least 95%
of records, mined deterministically chunk by chunk, proposed for human approval.

Kinds
  dependency  A decides B: every frequent A value maps to one B value.
  value_set   A limits B: every frequent A value maps to at most 5 B values.
  format      B's dominant shape (letter A, digit 9) as an anchored regex.
  range       numeric B per group A: [p2.5, p97.5] widened by 10% of the span.

Determinism: no sampling. Counts are summed over every chunk in file order;
fitted parameters come from the first FIT_ROWS rows; ties break on the
smallest value; outputs are sorted. See the plan
docs/superpowers/plans/2026-10-10-learned-rules-and-fix-back.md "Algorithms".
"""
from __future__ import annotations

import hashlib
from collections import Counter
from dataclasses import dataclass
from typing import Literal

import pandas as pd

from checks.base import is_blank

MIN_CONFIDENCE = 0.95
MIN_GROUP_ROWS = 200
MIN_GROUP_SHARE = 0.005
MAX_SET = 5
CARD_MIN, CARD_MAX = 2, 200
MAX_DISTINCT_SHARE = 0.20
MAX_CANDIDATES = 30
MAX_PER_KIND = 50
FORMAT_MIN_ROWS = 1000
RANGE_Q = (0.025, 0.975)
RANGE_PAD = 0.10
SAMPLE_KEYS = 5

Kind = Literal["dependency", "value_set", "format", "range"]
# ponytail: Python 3.11 has no `type` statement (PEP 695); plain alias instead.
Json = str | int | float | bool | None | list["Json"] | dict[str, "Json"]


@dataclass(frozen=True)
class Proposal:
    kind: Kind
    field: str
    determinant: str | None
    body: dict[str, Json]
    confidence: float
    support_rows: int
    violations: int
    sample_keys: tuple[str, ...] = ()

    @property
    def table(self) -> str:
        return self.field.split(".", 1)[0]

    @property
    def fingerprint(self) -> str:
        """Identity of the learned rule across runs: same kind, columns → same proposal row."""
        return hashlib.sha1(f"{self.kind}|{self.determinant or ''}|{self.field}".encode()).hexdigest()[:16]


def norm(s: pd.Series) -> pd.Series:
    """Stripped text; blanks (None, NaN, whitespace) as ''."""
    t = s.astype("string").str.strip().fillna("")
    return t.where(~is_blank(s), "")


class PairCounts:
    """(A value, B value) -> rows for ordered column pairs, summed over chunks (rows with A filled).
    A pair whose determinant passes CARD_MAX distinct values is dropped for good."""

    def __init__(self, pairs: list[tuple[str, str]]) -> None:
        self.counts: dict[tuple[str, str], Counter[tuple[str, str]]] = {p: Counter() for p in pairs}
        self.rows = 0

    def add(self, chunk: pd.DataFrame) -> None:
        self.rows += len(chunk)
        cols = sorted({c for p in self.counts for c in p})
        cache = {c: norm(chunk[c]) for c in cols if c in chunk}
        for p in list(self.counts):
            if p[0] not in cache or p[1] not in cache:
                continue
            a, b = cache[p[0]], cache[p[1]]
            filled = a != ""
            vc = pd.DataFrame({"a": a[filled], "b": b[filled]}).value_counts(sort=False)
            self.counts[p].update({(str(k[0]), str(k[1])): int(n) for k, n in vc.items()})
            if len({k[0] for k in self.counts[p]}) > CARD_MAX:
                del self.counts[p]


def _message(kind: Kind, field: str, determinant: str | None) -> str:
    return {
        "dependency": f"{field} does not follow {determinant} the way the rest of your data does",
        "value_set": f"{field} holds a value not normally used with this {determinant}",
        "format": f"{field} does not match the format almost every other record uses",
        "range": f"{field} is outside the usual range for this {determinant}",
    }[kind]


def value_set_rule(counts: Counter[tuple[str, str]], rows: int, det: str, dep: str) -> Proposal | None:
    """Shortest set of B values covering at least 95% of each frequent A value's rows."""
    by_a: dict[str, list[tuple[str, int]]] = {}
    for (a, b), n in counts.items():
        by_a.setdefault(a, []).append((b, n))
    floor = max(MIN_GROUP_ROWS, MIN_GROUP_SHARE * rows)
    allowed: dict[str, list[str]] = {}
    inside = total = 0
    for a in sorted(by_a):
        bs = sorted(by_a[a], key=lambda x: (-x[1], x[0]))
        n_a = sum(n for _, n in bs)
        if n_a < floor:
            continue
        cum, keep = 0, []
        for b, n in bs:
            keep.append(b)
            cum += n
            if cum >= MIN_CONFIDENCE * n_a:
                break
        if len(keep) > MAX_SET:
            return None
        allowed[a] = sorted(keep)
        inside, total = inside + cum, total + n_a
    if not allowed or len({tuple(v) for v in allowed.values()}) == 1:
        return None
    conf = inside / total
    if conf < MIN_CONFIDENCE or conf >= 1.0:
        return None
    kind: Kind = "dependency" if all(len(v) == 1 for v in allowed.values()) else "value_set"
    body: dict[str, Json] = {"check_class": "dependency_check", "determinant": det, "field": dep,
                             "allowed": {k: list(v) for k, v in allowed.items()},
                             "grain": dep.split(".", 1)[0], "dimension": "consistency",
                             "message": _message(kind, dep, det)}
    return Proposal(kind, dep, det, body, conf, total, total - inside)
