"""Every column a SuccessFactors rule names, in its field, fail_when or record template,
must exist in the canonical SuccessFactors dictionary, or in the ECC dictionary for the
on-premise HCM and payroll rules that share these packs (they skip when the tables are
absent). A placeholder on a column that exists nowhere renders blank in the cleaning
workbook, which is what LMS087 did with LEARNINGASSIGNMENT.ASSIGNMENT_ID."""

import re
from pathlib import Path

import yaml

from sap.ddic import get_dictionary

PACKS = sorted(Path("checks/rules/successfactors").glob("*.yaml"))
REF = re.compile(r"\b([A-Z][A-Z0-9_]+)\.([A-Z][A-Z0-9_]+)\b")


def _known():
    sf = yaml.safe_load(open("sap/dictionaries/canonical/successfactors.yaml"))["tables"]
    cols = {(t, f) for t, v in sf.items() for f in v.get("fields", {})}
    ecc = get_dictionary("ecc6")
    return cols, set(sf), ecc


def test_every_sf_rule_reference_exists():
    cols, sf_tables, ecc = _known()
    bad = []
    for pack in PACKS:
        for r in yaml.safe_load(pack.read_text()).get("rules") or []:
            if r.get("enabled") is False:
                continue
            if r.get("table") and r["table"] not in sf_tables and ecc.table(r["table"]) is None:
                bad.append(f"{pack.name}:{r.get('id')} unknown table {r['table']}")
            text = " ".join(str(r.get(k, "")) for k in ("field", "fail_when", "record_fix_template"))
            for t, f in REF.findall(text):
                if t in sf_tables:
                    if (t, f) not in cols:
                        bad.append(f"{pack.name}:{r.get('id')} {t}.{f}")
                elif ecc.table(t) is None or ecc.field(t, f) is None:
                    bad.append(f"{pack.name}:{r.get('id')} {t}.{f}")
    assert not bad, bad[:20]
