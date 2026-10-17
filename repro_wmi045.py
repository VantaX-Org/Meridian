"""Reproduce WMI045 on the golden MLGT frame."""
import sys
sys.path.insert(0, '.')
import pandas as pd
from checks.frames import TableFrames
from checks.runner import run_rule, _with_reference
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")
mlgt = pd.DataFrame({"MLGT.MATNR": ["RESIN-200", "BOLT-M12"], "MLGT.LGNUM": ["100", "100"],
                     "MLGT.LGTYP": ["005", "005"], "MLGT.LGPLA": ["05-01-01", "05-02-01"],
                     "MLGT.LPMIN": ["50", "500"], "MLGT.LPMAX": ["200", "300"]})
import yaml
rule = next(r for r in yaml.safe_load(open("checks/rules/warehouse/wm_interface.yaml"))["rules"]
            if r["id"] == "WMI045")
rule = _with_reference(dict(rule), {"MLGT.LGTYP": {"001", "002", "005", "902", "916", "999"}})
res = run_rule(rule, TableFrames({"MLGT": mlgt}, D, module="wm_interface"), {})
print("error:", res.error)
print("affected:", res.affected_count, "of", res.total_count)
print("failing keys:", res.failing_record_keys)
print()
print("coerced comparison per row:")
for r in rule.get("_compiled", []) if False else []:
    pass
df = TableFrames({"MLGT": mlgt}, D, module="wm_interface").table("MLGT")
print(df.dtypes)
print(df[["MLGT.MATNR", "MLGT.LPMIN", "MLGT.LPMAX"]])
