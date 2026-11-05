"""Aletheia verified fixes: AI-drafted ``auto_fix`` step lists that are machine-verified before a steward sees them.

Flow for one rule:

  1. ``build_shape`` reduces the rule's failing values to an aggregate: pattern masks (``AAA-999``), a length
     histogram, a case profile and whitespace counts. Raw values never leave this function, and the LLM prompt
     is built from the shape and the rule definition only (CLAUDE.md principle 2).
  2. The LLM (when on) proposes a step list from the existing op vocabulary (checks/auto_fix.OPS). Anything
     with an unknown op or a malformed spec is rejected by ``validate_steps``.
  3. ``verify`` applies the steps in-process with ``auto_fix.proposals`` (which re-runs the rule on the
     corrected rows) and reports fixed / still failing / rejected, plus how many rows that already pass the
     rule the steps would break.
  4. When the LLM is off, fails, or drafts nothing that verifies, ``deterministic_candidates`` derives specs from
     the shape alone and the best verified one wins.

A draft is stored as a pending tenant setting (``fix_draft.<rule_id>``) and is never applied until a steward
approves it. ``checks.overrides`` merges approved drafts onto the rule as its ``auto_fix``.
"""

from __future__ import annotations

import json
import re
import time
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import numpy as np
import pandas as pd

from checks import auto_fix

KEY_PREFIX = "fix_draft."
STATUSES = ("pending", "approved", "rejected")
MAX_MASK = 40          # a mask is cut here
TOP_PATTERNS = 10
SAMPLE_CAP = 5000      # failing values read into the shape
# ponytail: mask alphabet is fixed; anything else is "?" so a mask can never carry a letter or digit of the data
_PUNCT = set("-_./:,;+#&$@()%")
_SAFE_MASK = re.compile(r"^[Aa9~?\-_./:,;+#&$@()%]*$")
_SHAPE_KEYS = {"total_failing", "blank", "masks", "other_masks", "lengths", "case", "leading_ws", "trailing_ws",
               "inner_ws", "legend"}
_RULE_KEYS = ("check_class", "pattern", "allowed_values", "valid_values", "message", "severity", "dimension")
LEGEND = {"A": "upper case letter", "a": "lower case letter", "9": "digit", "~": "space", "?": "other character"}


# ---------------------------------------------------------------- shape

def mask_of(v: str) -> str:
    out = []
    for ch in v[:MAX_MASK]:
        if ch == " ":
            out.append("~")
        elif ch.isascii() and ch.isalpha():
            out.append("A" if ch.isupper() else "a")
        elif ch.isascii() and ch.isdigit():
            out.append("9")
        elif ch in _PUNCT:
            out.append(ch)
        else:
            out.append("?")
    return "".join(out)


def _squash(mask: str) -> str:
    """Run-length squash so ``AAAAAA-99`` and ``AAA-99`` are one pattern family only when asked; kept exact."""
    return mask


def build_shape(values: pd.Series) -> dict:
    """Aggregate of the failing values: counts only, never a value."""
    vals = values.dropna().astype(str).iloc[:SAMPLE_CAP]
    blank = int(len(values) - len(vals) + (vals.str.strip() == "").sum())
    vals = vals[vals.str.strip() != ""]
    masks = Counter(mask_of(v) for v in vals)
    top = masks.most_common(TOP_PATTERNS)
    lengths = Counter(min(len(v.strip()), 64) for v in vals)
    case = {"upper": 0, "lower": 0, "mixed": 0, "none": 0}
    for v in vals:
        letters = [c for c in v if c.isalpha()]
        if not letters:
            case["none"] += 1
        elif all(c.isupper() for c in letters):
            case["upper"] += 1
        elif all(c.islower() for c in letters):
            case["lower"] += 1
        else:
            case["mixed"] += 1
    return {"total_failing": int(len(values)), "blank": blank,
            "masks": [{"mask": m, "count": c} for m, c in top],
            "other_masks": int(sum(masks.values()) - sum(c for _, c in top)),
            "lengths": [{"length": k, "count": c} for k, c in sorted(lengths.items())],
            "case": case,
            "leading_ws": int(vals.str.match(r"^\s").sum()), "trailing_ws": int(vals.str.contains(r"\s$").sum()),
            "inner_ws": int(vals.str.strip().str.contains(r"\s{2,}").sum()), "legend": LEGEND}


def assert_aggregate(shape: dict) -> None:
    """Guard for the prompt: only whitelisted keys, masks only from the mask alphabet, no free text."""
    extra = set(shape) - _SHAPE_KEYS
    if extra:
        raise ValueError(f"shape keys not allowed in an LLM prompt: {sorted(extra)}")
    for m in shape["masks"]:
        if not _SAFE_MASK.match(m["mask"]) or len(m["mask"]) > MAX_MASK:
            raise ValueError("pattern mask carries data")


# ---------------------------------------------------------------- LLM

def build_prompt(rule: dict, shape: dict) -> str:
    assert_aggregate(shape)
    cfg = {k: rule[k] for k in _RULE_KEYS if k in rule}
    return (
        "You repair SAP master data. A data quality rule is failing; propose a deterministic fix.\n"
        "Return ONLY a JSON object {\"steps\": [ {\"op\": ...}, ... ]} with no prose and no code fences.\n"
        "Allowed ops and their parameters (use no others): "
        f"{json.dumps({k: sorted(v) for k, v in auto_fix.OPS.items()})}.\n"
        "Steps run in order on the field value. Prefer the fewest steps. If no safe fix exists return {\"steps\": []}.\n"
        "The failing values are summarised as pattern masks (A upper letter, a lower letter, 9 digit, ~ space, "
        "? other) with counts. You never see the values.\n\n"
        f"Rule {rule.get('id')} on {rule.get('field')}: {json.dumps(cfg, default=str)}\n"
        f"Failing shape: {json.dumps(shape)}\n")


def parse_steps(out: Optional[str]) -> Optional[list]:
    if not out:
        return None
    s = out.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else ""
        s = s.rsplit("```", 1)[0]
    try:
        doc = json.loads(s)
    except ValueError:
        return None
    steps = doc.get("steps") if isinstance(doc, dict) else doc
    return steps if isinstance(steps, list) else None


def ask_llm(tenant_id: str, rule: dict, shape: dict) -> Optional[list]:
    """Steps from the LLM, or None when it is off, fails or answers unparseably. Sync: run in a threadpool."""
    from api.utils.llm_logger import log_llm_call
    from llm.provider import get_llm, llm_is_noop, safe_invoke
    if llm_is_noop():
        return None
    from api.services.prompt_shapes import aggregates_only
    from api.utils.pii_fields import is_pii_header
    if aggregates_only(tenant_id) or is_pii_header(str(rule.get("field") or "")):
        # no pattern masks or length counts (they are read off the rows): whitespace and case counts only
        shape = {**shape, "masks": [], "other_masks": 0, "lengths": []}
    prompt = build_prompt(rule, shape)
    llm = get_llm()
    t0 = time.monotonic()
    out = safe_invoke(llm, prompt, timeout_seconds=90, max_tokens=600)
    log_llm_call(tenant_id, "fix_drafter", prompt, getattr(llm, "model", "unknown"),
                 len(prompt) // 4, int((time.monotonic() - t0) * 1000), out is not None)
    return parse_steps(out)


# ---------------------------------------------------------------- validation + verification

def _with_spec(rule: dict, steps: list) -> dict:
    r = {k: v for k, v in rule.items() if k != "fix_value"}
    return {**r, "auto_fix": {"steps": steps, "confidence": "low"}}


def validate_steps(rule: dict, steps: Any) -> list[str]:
    """Errors in a drafted step list (unknown op, wrong parameter, malformed); [] when valid."""
    if not isinstance(steps, list) or not steps:
        return ["steps must be a non-empty list"]
    if not all(isinstance(s, dict) for s in steps):
        return ["every step must be an object"]
    return auto_fix.validate_auto_fix(_with_spec(rule, steps))


def verify(rule: dict, steps: list, df: pd.DataFrame, failing: np.ndarray, evaluate: Callable, refs=None) -> dict:
    """Apply the steps in-process and count. ``failing`` is the rule's failing mask over ``df``.

    fixed: corrected and the rule accepts it. rejected: the steps changed the value but the rule still fails.
    still_failing: the steps produced nothing. broken: rows that passed before and fail after the steps."""
    r, field = _with_spec(rule, steps), rule["field"]
    rows = pd.Series(failing, index=df.index)
    raw = auto_fix.proposals(r, df, rows, refs)
    ok = auto_fix.proposals(r, df, rows, refs, evaluate)
    passing = auto_fix.proposals(r, df, ~rows, refs)
    broken = 0
    if passing:
        fixed = df[field].astype(object).to_numpy(copy=True)
        for p, (v, _) in passing.items():
            fixed[p] = v
        ev = evaluate(df.assign(**{field: fixed}))
        if ev is not None:
            still = np.asarray(ev.failing, dtype=bool)
            broken = int(sum(1 for p in passing if still[p]))
    n = int(failing.sum())
    return {"failing": n, "fixed": len(ok), "rejected": len(raw) - len(ok), "still_failing": n - len(raw),
            "touched_passing": len(passing), "broken": broken}


def deterministic_candidates(shape: dict) -> list[list[dict]]:
    """Step lists derivable from the shape alone. Verification, not this list, decides which is any good."""
    c = shape["case"]
    out: list[list[str]] = []
    if shape["leading_ws"] or shape["trailing_ws"]:
        out.append(["strip"])
    if shape["inner_ws"]:
        out += [["collapse_spaces"], ["strip", "collapse_spaces"]]
    if c["lower"] or c["mixed"]:
        out += [["upper"], ["strip", "upper"]]
        if shape["inner_ws"]:
            out.append(["strip", "collapse_spaces", "upper"])
    if c["upper"] or c["mixed"]:
        out += [["lower"], ["strip", "lower"]]
    return [[{"op": o} for o in ops] for ops in out]


# ---------------------------------------------------------------- draft

def draft(rule: dict, df: pd.DataFrame, evaluate: Callable, tenant_id: str, *, use_llm: bool = True, refs=None) -> dict:
    """Pending draft for one rule over its frame, or ``{"steps": []}`` when nothing verifies."""
    field = rule["field"]
    failing = np.asarray(evaluate(df).failing, dtype=bool)
    shape = build_shape(df[field][failing])
    best: Optional[dict] = None
    errors: list[str] = []
    tried = 0
    if use_llm and failing.any():
        steps = ask_llm(tenant_id, rule, shape)
        if steps is not None:
            errors = validate_steps(rule, steps)
            tried = 1
            if not errors:
                v = verify(rule, steps, df, failing, evaluate, refs)
                if v["fixed"] > 0:
                    best = {"source": "llm", "steps": steps, "verification": v}
    if best is None and failing.any():
        scored = []
        for steps in deterministic_candidates(shape):
            if not validate_steps(rule, steps):
                scored.append((steps, verify(rule, steps, df, failing, evaluate, refs)))
        scored = [(s, v) for s, v in scored if v["fixed"] > 0 and v["broken"] == 0]
        if scored:
            s, v = min(scored, key=lambda x: (-x[1]["fixed"], len(x[0])))
            best = {"source": "deterministic", "steps": s, "verification": v}
    base = {"rule_id": rule["id"], "field": field, "shape": shape, "errors": errors, "llm_tried": bool(tried)}
    if best is None:
        return {**base, "source": None, "steps": [], "verification": None, "status": "none"}
    return {**base, **best, "status": "pending", "confidence": "low",
            "drafted_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}


# ---------------------------------------------------------------- coverage

def coverage() -> list[dict]:
    """Per module: rules and how many carry an ``auto_fix`` (or legacy ``fix_value``)."""
    from checks.runner import CATEGORIES, RULES_DIR, module_rules
    names = sorted({p.stem for c in CATEGORIES for p in (RULES_DIR / c).glob("*.yaml")
                    if not p.name.endswith(".generated.yaml") and "column_map" not in p.name})
    out = []
    for m in names:
        try:
            rules = module_rules(m)
        except Exception:
            continue
        if rules:
            out.append({"module": m, "rules": len(rules), "with_fix": sum(1 for r in rules if auto_fix.enabled(r))})
    return out


# ---------------------------------------------------------------- storage

async def load(db, tenant_id, rule_id: str) -> Optional[dict]:
    from api.services.tenant_settings import get_setting
    return await get_setting(db, tenant_id, KEY_PREFIX + rule_id)


async def save(db, tenant_id, user_id, rule_id: str, doc: dict) -> None:
    from api.services.tenant_settings import put_setting
    await put_setting(db, tenant_id, KEY_PREFIX + rule_id, doc, user_id)


async def list_all(db, tenant_id) -> list[dict]:
    from sqlalchemy import text
    rows = (await db.execute(text("SELECT value FROM tenant_settings WHERE tenant_id = :t AND key LIKE :p"),
                             {"t": str(tenant_id), "p": KEY_PREFIX.replace("_", r"\_") + "%"})).fetchall()
    return sorted((r[0] for r in rows), key=lambda d: d.get("drafted_at", ""), reverse=True)
