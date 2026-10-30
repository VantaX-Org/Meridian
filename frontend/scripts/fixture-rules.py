#!/usr/bin/env python3
"""Builds the rule content of the fixtures (lib/api/v2/fixtures) from the shipped rule library (checks/rules/ecc).

Fixture mode must never show a rule the engine does not have. This script takes, for each of the 15 objects the demo
tenant has on ECC production, a fixed sample of enabled rules in the six scored dimensions (40 to 80 per object, the
rules other fixtures name always included) with their real id, message, field, severity, dimension and check class,
and writes:

  library.json    the sampled rules with their results in the fixture run (the rules library, an object's rules,
                  the rule coverage, the changes between runs)
  rules.json      Material master's failing rules (GET /findings) with the YAML's names and classes
  landscape.json  each cell's capping rules and rules measured; the status strip's rules measured is their sum
  receipts.json   each object's rules measured per dimension and its capping rules

so the rules library, the object pages, the landscape and the status strip count the same rules. Run it from the
frontend folder after the rule library changes:  python3 scripts/fixture-rules.py
lib/api/v2/fixtures/contract.test.ts checks the result against the YAML and the API schema.
"""
import glob
import json
import os
import zlib

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "..", "lib", "api", "v2", "fixtures")
RULES = os.path.join(HERE, "..", "..", "checks", "rules", "ecc")
DIMS = ("completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity")

# Rules per object in the demo tenant's run.
SIZE = {
    "material_master": 80, "business_partner": 64, "accounts_payable": 58, "accounts_receivable": 52, "fi_gl": 44,
    "asset_accounting": 46, "controlling": 48, "mm_purchasing": 62, "sd_sales_orders": 60, "plant_maintenance": 50,
    "production_planning": 56, "project_system": 42, "quality_management": 45, "hcm": 47, "sd_customer_master": 40,
}
# Critical rules over tolerance (they cap the score). Material master's are the prototype's two.
BREACHES = {
    "material_master": ["MM003", "MM035"], "business_partner": 3, "accounts_payable": 3, "accounts_receivable": 3,
    "asset_accounting": 2, "controlling": 3, "mm_purchasing": 2, "sd_sales_orders": 3, "plant_maintenance": 2,
    "production_planning": 3, "project_system": ["PS019"], "hcm": 3,
}
# Material master's failing rules, with their counts in the fixture run (GET /findings).
MM_FAILING = {
    "MM142": (3640, 1184000), "MM003": (2904, 902000), "MM007": (3118, 611000), "MM015": (2266, 402000),
    "MM302": (2712, 338000), "MM023": (1894, 268000), "MM035": (1420, 241000), "MM028": (1260, 198000),
}
# Rules other fixtures name (step 9 and 10, approvals, the rule canvas): always in the sample.
PINNED = {
    "material_master": ["MM142", "MM003", "MM007", "MM015", "MM302", "MM023", "MM035", "MM028", "MM169", "MM022", "MM232", "MM042", "MM324", "MM405", "MM033", "MM043"],
    "quality_management": ["QM001", "QM004", "QM058", "QM059"],
    "fi_gl": ["GL001", "GL002", "GL003", "GL006", "GL029", "GL035", "GL036"],
    "accounts_payable": ["AP014", "AP016", "AP018", "AP019", "AP039"],
    "accounts_receivable": ["AR018", "AR021", "AR049", "AR050"],
    "business_partner": ["BP007", "BP008", "BP017", "BP018", "BP020", "BP011"],
}
TOLERANCE_ROWS = 25


def load(module: str) -> list[dict]:
    rows = []
    for f in sorted(glob.glob(os.path.join(RULES, f"{module}.yaml"))) + sorted(glob.glob(os.path.join(RULES, f"{module}.generated.yaml"))):
        rows += yaml.safe_load(open(f, encoding="utf8"))["rules"]
    return rows


def name_of(r: dict) -> str:
    return " ".join(str(r["message"]).split()).replace(chr(0xB7), " ")


def first_sentence(text: str) -> str:
    s = " ".join(str(text or "").split())
    cut = s.find(". ")
    return s if cut < 0 else s[: cut + 1]


def h(s: str) -> int:
    return zlib.crc32(s.encode())


def sample(module: str) -> list[dict]:
    rules = [r for r in load(module) if r.get("enabled", True) and r.get("dimension") in DIMS]
    by_id = {r["id"]: r for r in rules}
    pinned = [by_id[i] for i in [*PINNED.get(module, []), *breach_ids(module, rules)] if i in by_id]
    pinned = list({r["id"]: r for r in pinned}.values())
    missing = [i for i in PINNED.get(module, []) if i not in by_id]
    if missing:
        raise SystemExit(f"{module}: pinned rules not enabled in the YAML: {missing}")
    # Every scored dimension is measured by a few rules (a dimension with a score and no rule would not reconcile).
    for d in DIMS:
        have = sum(1 for r in pinned if r["dimension"] == d)
        pinned += [r for r in rules if r["dimension"] == d and r not in pinned][: max(0, 3 - have)]
    picked = {r["id"] for r in pinned}
    rest = [r for r in rules if r["id"] not in picked]
    want = SIZE[module] - len(pinned)
    step = max(1, len(rest) // max(1, want))
    out = pinned + rest[::step][:want]
    return sorted(out, key=lambda r: r["id"])


def breach_ids(module: str, rules: list[dict]) -> list[str]:
    spec = BREACHES.get(module, 0)
    if isinstance(spec, list):
        return spec
    keyish = ("primary key", "must be 1-10", "number must be")
    crit = [r for r in rules if r.get("enabled", True) and r.get("dimension") in DIMS and r["severity"] == "critical" and not any(k in r["message"] for k in keyish)]
    if len(crit) < spec:
        raise SystemExit(f"{module}: {len(crit)} critical rules in the sample, {spec} wanted")
    return [r["id"] for r in crit[:spec]]


def main() -> None:
    landscape = json.load(open(os.path.join(FIX, "landscape.json"), encoding="utf8"))
    receipts = json.load(open(os.path.join(FIX, "receipts.json"), encoding="utf8"))
    base = json.load(open(os.path.join(FIX, "rules.json"), encoding="utf8"))
    cells = {c["module"]: c for c in landscape["cells"]}
    library = []
    total = 0
    for module in SIZE:
        rules = sample(module)
        cell = cells[module]
        checked = int(cell["records_checked"])
        caps = breach_ids(module, load(module))
        rows = []
        for r in rules:
            rid = r["id"]
            if module == "material_master":
                failing = MM_FAILING.get(rid, (0, 0))[0]
            elif rid in caps:
                failing = 60 + h(rid) % 900
            elif r["severity"] == "critical":
                failing = h(rid) % 12  # within the tolerance of 25 rows
            elif h(rid) % 10 < 3:
                failing = 1 + h(rid + "f") % max(2, checked // 40)
            else:
                failing = 0
            rows.append({"check_id": rid, "module": module, "name": name_of(r), "field": r.get("field"), "severity": r["severity"],
                         "dimension": r["dimension"], "check_class": r["check_class"], "failing": failing, "total": checked})
        library += rows
        total += len(rows)
        cell["rules_measured"] = len(rows)
        cell["breaches"] = caps
        rec = receipts[module]
        rec["label"] = landscape_label(landscape, module)
        rec["rules_measured"] = len(rows)
        for d in rec["dimensions"]:
            d["rules_measured"] = sum(1 for x in rows if x["dimension"] == d["key"])
        by = {x["check_id"]: x for x in rows}
        rec["breaches"] = [
            {"check_id": b, "name": by[b]["name"], "failing": by[b]["failing"], "pct": round(by[b]["failing"] / checked * 100, 2),
             "tolerance_rows": TOLERANCE_ROWS, "tolerance_pct": 0.1}
            for b in sorted(caps, key=lambda b: -by[b]["failing"])
        ]
        cell["breaches"] = [b["check_id"] for b in rec["breaches"]]
        rec["formula"] = "DQS = 0.25 × C + 0.25 × A + 0.20 × Cs + 0.10 × T + 0.10 × U + 0.10 × V"
        if module == "material_master":
            for b in base["rules"]:
                y = by[b["check_id"]]
                src = next(r for r in rules if r["id"] == b["check_id"])
                b.update({"name": y["name"], "field": y["field"], "severity": y["severity"], "dimension": y["dimension"], "check_class": y["check_class"],
                          "why": first_sentence(src.get("sap_impact") or src.get("why_it_matters"))})
                b["affected_count"], b["value_at_risk"] = MM_FAILING[b["check_id"]]
                b["pass_rate"] = round((1 - b["affected_count"] / b["total_count"]) * 100, 2)
    landscape["status_strip"]["rules_measured"] = total
    caps_all = cells["material_master"]["breaches"]
    landscape["sentence"]["release_if_fixed"] = caps_all
    landscape["sentence"]["released"] = sum(1 for c in landscape["cells"] if c["breaches"] and set(c["breaches"]) <= set(caps_all))
    landscape["sentence"]["critical_over_tolerance"] = sum(len(c["breaches"]) for c in landscape["cells"])
    with open(os.path.join(FIX, "library.json"), "w", encoding="utf8") as f:
        f.write('{"rules": [\n' + ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in library) + "\n]}\n")
    json.dump(landscape, open(os.path.join(FIX, "landscape.json"), "w", encoding="utf8"), indent=2, ensure_ascii=False)
    json.dump(receipts, open(os.path.join(FIX, "receipts.json"), "w", encoding="utf8"), indent=2, ensure_ascii=False)
    json.dump(base, open(os.path.join(FIX, "rules.json"), "w", encoding="utf8"), indent=2, ensure_ascii=False)
    print(f"{total} rules over {len(SIZE)} objects")


def landscape_label(landscape: dict, module: str) -> str:
    return next(o["label"] for o in landscape["objects"] if o["module"] == module)


if __name__ == "__main__":
    main()
