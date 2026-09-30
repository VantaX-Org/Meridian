#!/usr/bin/env python3
"""Validate every rule's TABLE.FIELD references against the SAP dictionary.

Exit code 1 when any reference does not resolve. Used by CI
(tests/checks/test_rule_fields_resolve.py) and by developers when adding rules.

    python scripts/validate_rules.py            # summary + unresolved list
    python scripts/validate_rules.py --json     # machine-readable
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sap.ddic import get_dictionary  # noqa: E402

_REF = re.compile(r"\b([A-Z][A-Z0-9_]{1,29})\.([A-Z][A-Z0-9_]{0,29})\b")
_RULE_KEYS = ("field", "fields", "condition", "applies_when", "reference_field",
              "date_field", "compare_field", "secondary_field")


def rule_refs(rule: dict) -> set[str]:
    refs: set[str] = set()
    for k in _RULE_KEYS:
        if rule.get(k) is None:
            continue
        blob = rule[k] if isinstance(rule[k], str) else yaml.safe_dump(rule[k])
        refs.update(f"{m.group(1)}.{m.group(2)}" for m in _REF.finditer(blob))
    return refs


def unresolved() -> list[dict]:
    d = get_dictionary("s4hana")  # superset: ECC fields + S/4 moved fields + canonical
    out = []
    for path in sorted((ROOT / "checks" / "rules").rglob("*.yaml")):
        if path.name == "column_map.yaml":
            continue
        for rule in (yaml.safe_load(path.read_text()) or {}).get("rules", []):
            for ref in sorted(rule_refs(rule)):
                table = ref.split(".")[0]
                if table.startswith(("Z", "Y")) or ref.split(".")[1].startswith(("ZZ", "YY")):
                    continue  # customer namespace — validated against the live DDIC only
                if d.resolve(ref) is None:
                    out.append({"file": str(path.relative_to(ROOT)), "rule": rule.get("id"),
                                "ref": ref, "table_known": d.table(table) is not None})
    return out


if __name__ == "__main__":
    bad = unresolved()
    if "--json" in sys.argv:
        print(json.dumps(bad, indent=1))
    else:
        for b in bad:
            print(f"{b['file']}:{b['rule']}: {b['ref']}{'' if b['table_known'] else '  (unknown table)'}")
        print(f"\n{len(bad)} unresolved reference(s)")
    sys.exit(1 if bad else 0)
