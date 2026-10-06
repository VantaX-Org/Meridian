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


# Personal / identifying data a fix instruction must never echo: refer to the field by name.
_SENSITIVE = {"NAME1", "NAME2", "NAME3", "NAME4", "NAME_FIRST", "NAME_LAST", "NAME_ORG1", "NAME_ORG2", "STRAS",
              "ORT01", "ORT02", "PSTLZ", "PFACH", "BANKN", "BANKL", "IBAN", "STCD1", "STCD2", "STCD3", "STCD4",
              "STCEG", "SMTP_ADDR", "TELF1", "TELF2", "TELFX", "ADRNR", "BIRTHDT", "DEATHDT", "FOUND_DAT",
              "LIQUID_DAT", "STREET", "CITY1", "TEL_NUMBER", "SORT1", "SORT2", "NACHN", "VORNA", "GBDAT", "BKONT",
              "KOINH", "BKREF", "MCOD1", "MCOD2", "MCOD3"}
_PUBLIC_TABLES = {"BNKA", "T012", "T012K"}  # bank directory / house banks: reference data, not personal


def test_fix_templates_never_echo_sensitive_values():
    import re
    offenders = []
    for _, _, r in ALL:
        texts = [r.get("record_fix_template") or "", r.get("fix_template") or "", *map(str, (r.get("fix_map") or {}).values())]
        fld = r.get("field") or "X.X"
        sensitive_rule = fld.split(".")[-1] in _SENSITIVE and fld.split(".")[0] not in _PUBLIC_TABLES
        for ph in re.findall(r"\{([^}]+)\}", " ".join(texts)):
            t, _, f = ph.partition(".")
            if (f in _SENSITIVE and t not in _PUBLIC_TABLES) or (ph in ("actual_value", "invalid_value") and sensitive_rule):
                offenders.append((r["id"], ph))
    assert offenders == []


def test_ecc_dictionary_misses_are_only_s4_moved_fields():
    """Fields absent from the ECC DDIC (S/4 status fields) are repointed to their ECC table
    (VBUK/VBUP) by TableFrames; anything else missing on ECC is a real defect."""
    from checks.frames import _MOVED
    from validate_rules import rule_refs
    ecc = get_dictionary("ecc6")
    missing = set()
    for _, _, r in ALL:
        for ref in rule_refs(r):
            t, f = ref.split(".")
            if t[0] in "ZY" or f.startswith(("ZZ", "YY")) or ecc.resolve(ref):
                continue
            if ref not in _MOVED or ecc.resolve(_MOVED[ref]) is None:
                missing.add(ref)
    assert missing == set()
