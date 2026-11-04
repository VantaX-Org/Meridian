"""Rule impact dry run: what enabling, editing or adding one rule would do, before anyone does it.

Read-only. The rule runs through ``checks.runner.run_rule`` over the object's latest stored extraction (never SAP,
never the findings tables); the object is then rescored from the run's stored findings with the rule's result
swapped in, using the same ``simulate_fix.receipt_of`` / ``score_module`` path the run scored with. Failing values
are reported as counts by shape (``checks.profiling.shape_of``); sensitive fields arrive already masked.
"""
from __future__ import annotations

from collections import Counter

import pandas as pd
import yaml

from api.services import rule_authoring as ra
from api.services import simulate_fix as sf
from api.services.scoring import scoring_config
from checks.base import MASKED, CheckResult, pass_rate_of
from checks.frames import TableFrames
from checks.profiling import shape_of
from checks.runner import run_rule

DEFAULT_ROW_CAP = 50_000
MAX_ROW_CAP = 200_000
TOP_SHAPES = 10


def validate(rule: dict, module: str, dictionary) -> list[str]:
    # the authoring validator refuses ids that already exist, so it checks the rule under a throwaway id
    _, errors = ra.validate_rule_yaml(yaml.safe_dump({**rule, "id": "DRYRUN_TMP"}), module, dictionary)
    return errors


def cap_frames(frames: TableFrames, cap: int) -> tuple[TableFrames, dict[str, int]]:
    """Frames with every table cut to its first ``cap`` rows, and the full row count of each table cut."""
    cut: dict[str, int] = {}
    out = {}
    for name, t in frames.frames.items():
        if isinstance(t, pd.DataFrame) and len(t) > cap:
            cut[name] = len(t)
            t = t.head(cap)
        out[name] = t
    return TableFrames(out, frames.dictionary, module=frames.module), cut


def evaluate(rule: dict, frames: TableFrames, cut: dict[str, int]) -> dict:
    """{result, scale, error} for one rule; ``scale`` lifts sample counts to the full table when rows were cut."""
    _, result = run_rule(rule, frames)
    if result is None:
        return {"result": None, "scale": 1.0, "error": "the extraction holds no records for this rule's fields"}
    if result.error:
        return {"result": None, "scale": 1.0, "error": str(result.error)}
    kept = len(frames.frames[result.grain]) if result.grain in frames.frames else 0
    scale = cut[result.grain] / kept if result.grain in cut and kept else 1.0
    return {"result": result, "scale": scale, "error": None}


def _scaled(r: CheckResult, scale: float) -> CheckResult:
    if scale == 1.0:
        return r
    affected, total = round(r.affected_count * scale), round(r.total_count * scale)
    return r.model_copy(update={"affected_count": affected, "total_count": total,
                                "pass_rate": pass_rate_of(total, affected), "passed": affected == 0})


def shapes(r: CheckResult) -> list[dict]:
    """Failing values of the rule's field as counts by shape; masked fields are one category."""
    c: Counter[str] = Counter()
    for rec in r.failing_record_values or []:
        v = rec.get(r.field)
        c["masked" if v == MASKED else "blank" if v in (None, "") else shape_of(str(v))] += 1
    return [{"shape": s, "count": n} for s, n in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP_SHAPES]]


def project(run: sf.ObjectRun, rule_id: str, replacement: CheckResult) -> tuple[dict, dict]:
    """(current receipt, receipt with the rule's result replaced or added) from the run's stored findings."""
    thresholds = scoring_config(run.raw_cfg)["thresholds"]
    base = sf.rebuild(run.findings, run.module)
    after = [r for r in base if r.check_id != rule_id] + [replacement]
    return sf.receipt_of(base, run, thresholds, {}, []), sf.receipt_of(after, run, thresholds, {}, [])


def dry_run(run: sf.ObjectRun, frames: TableFrames, rule: dict, current: dict | None, cap: int) -> dict:
    """Counts, projected score and (for an edit) the delta against the current rule."""
    capped, cut = cap_frames(frames, cap)
    new = evaluate(rule, capped, cut)
    r: CheckResult | None = new["result"]
    out: dict = {"module": run.module, "run_id": run.run_id, "rule_id": rule["id"],
                 "mode": "new" if current is None else "edit", "evaluated": r is not None, "reason": new["error"],
                 "row_cap": {"cap": cap, "sampled": bool(cut), "tables_cut": cut,
                             "note": "first rows of each table; counts are scaled to the full table"}}
    if r is None:
        return out
    out["sample"] = {"records_evaluated": r.total_count, "records_failing": r.affected_count}
    scaled = _scaled(r, new["scale"])
    out["records_evaluated"], out["records_failing"] = scaled.total_count, scaled.affected_count
    out["failure_rate"] = round(100 - scaled.pass_rate, 2)
    out["failing_shapes"] = shapes(r)
    before, after = project(run, rule["id"], scaled)
    out["dqs"] = {"before": before["score"], "after": after["score"], "delta": sf.delta_of(before, after)["score"],
                  "breaches_before": before["breaches"], "breaches_after": after["breaches"]}
    if current is not None:
        old = evaluate({**current, "id": rule["id"]}, capped, cut)["result"]
        if old is not None:
            o, n = set(old.failing_record_keys or []), set(r.failing_record_keys or [])
            out["delta"] = {"current_failing": old.affected_count, "newly_failing": len(n - o),
                            "newly_passing": len(o - n), "unchanged_failing": len(n & o),
                            "basis": "failing record keys in the evaluated rows"}
    return out
