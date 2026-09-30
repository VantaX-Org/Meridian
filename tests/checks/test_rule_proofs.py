"""Every shipped rule, and every rule the engine generates, is proven: one
record it fails and one it passes (tests/checks/rule_proofs.py). A rule that
cannot fail tests nothing; one that cannot pass condemns every record."""

import glob
import logging

import pytest
import yaml

from checks.value_placement import generate
from sap.ddic import get_dictionary
from tests.checks.rule_proofs import prove

D = get_dictionary("s4hana")


def _rules():
    out = []
    for p in sorted(glob.glob("checks/rules/*/*.yaml")):
        if "column_map" in p or "/tenant/" in p:
            continue
        cfg = yaml.safe_load(open(p)) or {}
        rules = cfg.get("rules") or []
        out += [{**r, "module": cfg.get("module")} for r in rules]
        if cfg.get("module") and "/ztables/" not in p:
            out += generate(cfg["module"], rules, get_dictionary("ecc6"))
    return out


RULES = _rules()


@pytest.mark.parametrize("rule", RULES, ids=[f"{r['module']}:{r['id']}" for r in RULES])
def test_rule_is_proven(rule):
    logging.disable(logging.CRITICAL)
    try:
        verdict, detail = prove(rule, D)
    finally:
        logging.disable(logging.NOTSET)
    assert verdict == "proven", f"{rule['id']}: {verdict} — {detail}"
