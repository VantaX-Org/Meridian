"""Every shipped rule must be evaluable against the SAP standard dictionary.

These guards exist because earlier rule packs contained corrupted field names
(ANLA.AIESSION …), fields on the wrong table (LFA1.BANKN), inverted
cross-field conditions and single-field 'uniqueness' checks that flagged every
multi-role user. Nothing here needs a SAP system.
"""

import glob
import sys
from pathlib import Path

import pandas as pd
import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from checks.frames import TableFrames, tables_of  # noqa: E402
from checks.runner import REGISTRY, rule_columns  # noqa: E402
from sap.ddic import get_dictionary  # noqa: E402
from validate_rules import unresolved  # noqa: E402


def _rules():
    for path in sorted(glob.glob(str(ROOT / "checks/rules/**/*.yaml"), recursive=True)):
        if path.endswith("column_map.yaml"):
            continue
        doc = yaml.safe_load(Path(path).read_text()) or {}
        for rule in doc.get("rules", []):
            yield Path(path).name, doc.get("module"), rule


ALL = list(_rules())


def test_every_rule_field_exists_in_sap_dictionary():
    assert unresolved() == []


def test_rule_ids_unique_and_check_classes_known():
    ids = [r["id"] for _, _, r in ALL]
    assert len(ids) == len(set(ids))
    assert {r["check_class"] for _, _, r in ALL} <= set(REGISTRY)


def test_uniqueness_is_never_a_duplicated_expression():
    offenders = [r["id"] for _, _, r in ALL if "duplicated" in str(r.get("condition", "")) + str(r.get("fail_when", ""))]
    assert offenders == []


@pytest.mark.parametrize("fname,module,rule", [a for a in ALL if a[2]["check_class"] == "cross_field_check"],
                         ids=lambda v: v["id"] if isinstance(v, dict) else None)
def test_cross_field_expression_evaluates(fname, module, rule):
    """Expression parses and runs on an empty typed frame of its own columns."""
    cols = rule_columns(rule)
    df = pd.DataFrame({c: pd.Series(["X", ""], dtype="string") for c in cols})
    res = REGISTRY["cross_field_check"](rule).run(df)
    assert res is not None and res.error is None, res.error if res else "skipped"


def test_every_rule_resolves_a_grain():
    """Each rule's tables are joinable without fan-out (joins.yaml covers them)."""
    from checks.frames import _graph
    d = get_dictionary("s4hana")
    edges, _ = _graph()
    joinable = {t for e in edges for t in (e.parent, e.child)}
    problems = []
    for fname, module, rule in ALL:
        cols = rule_columns(rule)
        frames = {}
        for t in set(tables_of(cols)) | joinable:
            keys = [f"{t}.{k}" for k in d.keys(t)]
            frames[t] = pd.DataFrame(columns=list(dict.fromkeys(keys + [c for c in cols if c.startswith(t + ".")])))
        tf = TableFrames(frames, module=module)
        try:
            built = tf.frame_for(cols, grain=rule.get("grain"))
        except ValueError as e:
            problems.append(f"{rule['id']}: {e}")
            continue
        if built is None:
            problems.append(f"{rule['id']}: no frame")
    assert problems == []


def test_value_lists_respect_ddic_fixed_values():
    """A rule may restrict a domain, never allow values SAP's domain forbids."""
    d = get_dictionary("s4hana")
    bad = []
    for _, _, r in ALL:
        vals = r.get("allowed_values") if r["check_class"] == "domain_value_check" else None
        f = d.resolve(r.get("field", "")) if r.get("field") else None
        fixed = f.allowed_values() if f else None
        if isinstance(vals, list) and fixed:
            extra = {str(v).strip() for v in vals} - fixed - {""}
            if extra:
                bad.append(f"{r['id']} {r['field']}: {sorted(extra)} not in domain {f.domain}")
    assert bad == []
