# S/4HANA Load Dry Run + Transaction-Proven Cost Implementation Plan

> **Migration numbering (controller ruling):** this plan's migrations are 069 (down_revision 068). Execution order: S/4 load dry run, then change-document delta, then learned rules. The monitoring/migration-cockpit branch (migrations 067 and 068) merges first. Run `alembic heads` before writing a migration and adjust if the head moved.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Add a deterministic S/4HANA load dry run. It replays an already-analysed ECC dataset against S/4 load semantics and returns load-ready / load-fail per record, with a reason. These semantics are MATNR 40/ALPHA, CVI to BP, KNKK to UKMBP_CMS, MRP areas, the material ledger, KONV to PRCD_ELEMENTS, NAST output and AFLE amounts. The result feeds wave readiness and exports to xlsx and pdf. (B) Add a "proven cost" panel next to value-at-risk. It shows money already lost or held in the transactions, namely late POs, GR/IR and UoM variances, blocked sales orders and duplicate vendor payments. Each amount is traced back to the master-data defects and the finding check_ids that caused it.

**Architecture:**
- **Part A** adds a new run mode, `s4_dry_run`, to the existing migration pipeline (`api/routes/migration.py` and `workers/tasks/run_migration.py`). It needs no new extraction and no new table:
  - The worker runs the existing `engine.analyze()` (mappings, mandatory fields, key collisions).
  - A new pure module, `api/services/migration/load_sim.py`, then emits additional `Gap`s for S/4-specific load semantics. Each gap carries an append-only `S4L-*` rule id from `sap/dictionaries/migration/s4_load_rules.yaml`, and that file links each rule to the existing `S4R-*` / `S4-CVI-*` check_ids.
  - `fold()` merges the simulation gaps into `ModuleResult`, so the verdict and blocked count match the load.
  - Per-record status is derived from `migration_gap_findings` (blocking severity means load-fail), so no status table is needed.
  - `gap_summary` is keyed by module, so `/insights/readiness` already reads it. That query only gains a preference for dry-run runs.
- **Part B** adds a pure pandas module, `api/services/proven_cost.py`, with four metric functions over `TableFrames`:
  - A post-analysis Celery task, `compute_proven_cost`, which `run_checks` enqueues the same way it enqueues `run_exception_scan`, loads the dataset. It attributes each costed document to failing `finding_records` keys and writes `proven_cost_results`, which is a new table with RLS.
  - `GET /api/v1/insights/proven-cost` serves the panel.
  - The transactional tables come from a new `PROVEN_COST_DATA` trigger in `sap/extraction_plan.py`, which follows the existing `DISCOVERY_DATA` pattern, and from registry entries in `sap/extraction_registry.py`.

**Tech Stack:**
- Python 3.12, FastAPI, async SQLAlchemy `text()`, Celery (sync `Session`), pandas, openpyxl, WeasyPrint/Jinja (`api/services/pdf_reports.render`) and Alembic.
- Next.js 14, TanStack Query/Table, `@/design` and vitest.

## Global Constraints

- Python 3.12, with type hints. No `Any` and no `any`. Use `dict[str, object]`, `TypedDict` or dataclasses instead.
- No customer names in code, fixtures, YAML or comments.
- Rule IDs are append-only. New IDs use the `S4L-` prefix. Never rename or reuse an existing `S4R-*` / `S4-CVI-*` id.
- Every query is tenant-scoped with RLS. In workers, run `SET app.tenant_id = :tid`. In routes, call `_rls(db, tenant)` / `_set_rls(db, tenant.id)`. Every new table gets ENABLE + FORCE RLS and a `tenant_id = current_setting('app.tenant_id')::uuid` policy.
- Alembic: check the current head before creating the file (`ls db/migrations/versions | sort | tail -3` plus `alembic heads`). At the time of writing, origin/main head is `066`. The sibling branches hold `067_dqs_history_system` and `068_migration_waves`, so the new file is most likely `069`. Use head+1 and set `down_revision` to the actual head. The plan writes the migration as `NNN`.
- Frontend uses `@/design` only, with no raw hex. The `lint:tokens` allowlist stays empty.
- SAP access is read-only. Only add read targets (`ExtractionTarget`) and never write to SAP.
- Deterministic only. No LLM calls in the simulation, the cost metrics or the narrative strings.
- Celery tasks are idempotent: delete-then-insert per `version_id`/`run_id`, or `ON CONFLICT`, and they set `soft_time_limit`/`time_limit`.
- Commit trailer, on every commit:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  ```

## File map

| File | Action | Part |
|---|---|---|
| `sap/dictionaries/migration/s4_load_rules.yaml` | create: S4L rule catalogue (id, area, severity, reason, related check_ids) | A |
| `api/services/migration/load_sim.py` | create: pure S/4 load simulation, `simulate()`, `fold()`, `record_status()` | A |
| `api/services/migration/engine.py` | modify: extract `verdict_for()` (reused by `fold`) | A |
| `workers/tasks/run_migration.py` | modify: `s4_dry_run` mode branch | A |
| `api/routes/migration.py` | modify: accept mode; `GET /runs/{id}/records`; `GET /runs/{id}/dry-run/{fmt}` | A |
| `templates/s4_dry_run.html` | create: PDF template (rendered by `pdf_reports.render`) | A |
| `api/routes/insights.py` | modify: readiness prefers dry-run runs; new `GET /proven-cost`; exec adds proven total | A+B |
| `frontend/lib/api/migration.ts`, `frontend/lib/api/insights.ts` | modify: typed wrappers | A+B |
| `frontend/app/(app)/migration/dry-run/page.tsx` | create: dry-run results page | A |
| `frontend/app/(app)/insights/impact/page.tsx` | modify: proven-cost panel beside value-at-risk | B |
| `sap/extraction_registry.py` | modify: EKET, EINA, EINE, MARM, RSEG, VBUK, BSAK, KNKK, KNVK, MARD, T001L, KONV, NAST; EKBE.BUDAT/DMBTR; VBAK.LIFSK/CMGST/NETWR | A+B |
| `sap/extraction_plan.py` | modify: `PROVEN_COST_DATA` + `S4_LOAD_DATA` triggers | A+B |
| `sap/dictionaries/extraction_windows.yaml` | modify: EKET via EKPO; VBUK via VBAK; KONV via VBAK; NAST window | A+B |
| `api/services/proven_cost.py` | create: four pure metric functions + attribution | B |
| `db/migrations/versions/NNN_proven_cost_results.py` | create: table + RLS | B |
| `workers/tasks/compute_proven_cost.py` | create: Celery task | B |
| `workers/tasks/run_checks.py` | modify: enqueue `compute_proven_cost` | B |
| tests: `tests/test_s4_load_sim.py`, `tests/test_s4_dry_run_route.py`, `tests/test_extraction_plan_proven_cost.py`, `tests/test_proven_cost.py`, `tests/test_proven_cost_route.py`, `tests/test_compute_proven_cost_task.py`, frontend `__tests__/` | create | A+B |

---

# Part A: S/4HANA load dry run

### Task 1: S4L rule catalogue

**Files:**
- Create: `sap/dictionaries/migration/s4_load_rules.yaml`
- Create: `tests/test_s4_load_sim.py`

**Interfaces:**
- `load_sim.rules() -> dict[str, S4LRule]`, where `S4LRule` is a frozen dataclass with fields `id`, `area`, `severity`, `reason`, `target` and `related: tuple[str, ...]`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_s4_load_sim.py
from api.services.migration import load_sim
from api.services.s4_readiness import membership


def test_catalogue_ids_are_prefixed_unique_and_linked():
    rules = load_sim.rules()
    assert rules, "catalogue must not be empty"
    assert all(r.id.startswith("S4L-") for r in rules.values())
    assert len(rules) == len({r.id for r in rules.values()})
    for r in rules.values():
        assert r.severity in {"critical", "high", "medium", "low"}
        assert r.reason and r.target
        assert r.area in {"material", "business_partner", "credit_management", "mrp",
                          "material_ledger", "sales", "output_management", "finance"}


def test_related_ids_exist_in_readiness_pack_or_cvi():
    known = set(membership())
    for r in load_sim.rules().values():
        for cid in r.related:
            assert cid in known or cid.startswith("S4-CVI-") or cid.startswith("S4-CRM-"), (r.id, cid)
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pytest tests/test_s4_load_sim.py -q`
Expected: FAIL with `ModuleNotFoundError: api.services.migration.load_sim`.

- [ ] **Step 3: Write the catalogue**

```yaml
# sap/dictionaries/migration/s4_load_rules.yaml
# Append-only. Never renumber or reuse an id. `related` links to existing finding check_ids
# (checks/rules/ecc/s4_readiness.yaml + CVI checks) so a load failure drills to its finding.
rules:
  - {id: S4L-MM-MATNR-LEN,   area: material, severity: critical, target: MARA.MATNR,
     reason: "Material number longer than 40 characters cannot load into MATNR (CHAR40)",
     related: []}
  - {id: S4L-MM-MATNR-ALPHA, area: material, severity: critical, target: MARA.MATNR,
     reason: "Numeric material numbers collide after ALPHA conversion (leading zeros differ, same number)",
     related: []}
  - {id: S4L-MM-MATNR-CHARS, area: material, severity: high, target: MARA.MATNR,
     reason: "Material number contains lower-case or characters rejected by the S/4 conversion exit",
     related: []}
  - {id: S4L-BP-NUM-OVERLAP, area: business_partner, severity: critical, target: BUT000.PARTNER,
     reason: "Vendor and customer numbers overlap with different names; same-number BP assignment would merge two parties",
     related: [S4R-BP-NUM-OVERLAP, S4-CVI-KTOKK-NUM, S4-CVI-KTOKD-NUM]}
  - {id: S4L-BP-GROUPING,    area: business_partner, severity: critical, target: BUT000.BU_GROUP,
     reason: "Account group has no BP grouping mapping (KTOKK/KTOKD to BU_GROUP)",
     related: [S4-CVI-KTOKK-ROLE, S4-CVI-KTOKD-ROLE]}
  - {id: S4L-BP-MANDATORY,   area: business_partner, severity: critical, target: BUT000,
     reason: "Mandatory BP field blank (name 1 or country)",
     related: [S4-CVI-LFA1, S4-CVI-KNA1]}
  - {id: S4L-BP-TAX,         area: business_partner, severity: high, target: DFKKBPTAXNUM.TAXNUM,
     reason: "Tax number duplicated across different business partners",
     related: [S4R-BP-DUP-TAX]}
  - {id: S4L-BP-KNVK-ORPHAN, area: business_partner, severity: high, target: BUT050,
     reason: "Contact person has no parent customer/vendor; BP relationship cannot be created",
     related: [S4R-BP-KNVK-NAME, S4-CVI-KNVK-CUST, S4-CVI-KNVK-VEND]}
  - {id: S4L-CRM-KNKK,       area: credit_management, severity: high, target: UKMBP_CMS_SGM,
     reason: "Credit segment without credit control area or for a customer not migrated",
     related: [S4R-CRM-KNKLI-KKBER, S4-CRM-KKBER]}
  - {id: S4L-MRP-AREA,       area: mrp, severity: high, target: MDLG,
     reason: "Storage location excluded from MRP (DISKZ) needs an MRP area; none can be derived",
     related: [S4R-MRP-MARD-DISKZ, S4R-MRP-T001L-DISKZ]}
  - {id: S4L-ML-BKLAS,       area: material_ledger, severity: critical, target: MBEW.BKLAS,
     reason: "Valuated stock without valuation class; material ledger initialisation fails",
     related: [S4R-ML-BKLAS-BLANK-STOCK]}
  - {id: S4L-ML-PRICE,       area: material_ledger, severity: high, target: MBEW.VPRSV,
     reason: "Price control blank or price zero with stock; actual costing cannot open the period",
     related: [S4R-ML-VPRSV-BLANK-STOCK, S4R-ML-VALUE-NOQTY, S4R-ML-NEG-VALUE]}
  - {id: S4L-SD-KONV-ORPHAN, area: sales, severity: medium, target: PRCD_ELEMENTS,
     reason: "Pricing condition (KONV) without a sales/purchasing document header; not converted to PRCD_ELEMENTS",
     related: []}
  - {id: S4L-FI-AFLE,        area: finance, severity: low, target: PRCD_ELEMENTS.KWERT,
     reason: "Amount uses more than 95% of the legacy CURR 13,2 length; downstream interfaces need AFLE review",
     related: []}
  - {id: S4L-OUT-NAST-OPEN,  area: output_management, severity: medium, target: APOC_D_OR_ROOT,
     reason: "Unprocessed NAST output record; not carried to S/4 output management",
     related: []}
```

- [ ] **Step 4: Write the catalogue loader** (start of `load_sim.py`)

```python
# api/services/migration/load_sim.py
"""S/4HANA load dry run. Pure, deterministic simulation over source TableFrames.
Emits engine.Gap rows (gap_type 's4_load') whose detail starts with the S4L rule id."""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

_FILE = Path(__file__).resolve().parents[3] / "sap" / "dictionaries" / "migration" / "s4_load_rules.yaml"


@dataclass(frozen=True)
class S4LRule:
    id: str
    area: str
    severity: str
    reason: str
    target: str
    related: tuple[str, ...]


@lru_cache(maxsize=1)
def rules() -> dict[str, S4LRule]:
    doc = yaml.safe_load(_FILE.read_text())
    return {r["id"]: S4LRule(r["id"], r["area"], r["severity"], r["reason"], r["target"],
                             tuple(r.get("related") or ())) for r in doc["rules"]}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pytest tests/test_s4_load_sim.py -q`
Expected: 2 passed. If a `related` id is reported missing, remove it from the YAML; do not invent rules.

- [ ] **Step 6: Commit** `feat(migration): S4L load-rule catalogue` (with the trailer).

---

### Task 2: MATNR checks (40-char, ALPHA collision, characters)

**Files:**
- Modify: `api/services/migration/load_sim.py`
- Test: `tests/test_s4_load_sim.py`

**Interfaces:**
- `check_matnr(frames: TableFrames, module: str) -> list[Gap]`
- `_gaps(rule_id, module, table, field, mask, keys, values) -> list[Gap]`, a shared emitter that every later check uses.

- [ ] **Step 1: Write the failing tests**

```python
import pandas as pd
from checks.frames import TableFrames


def _tf(**tables: pd.DataFrame) -> TableFrames:
    return TableFrames(dict(tables))


def _ids(gaps):
    return sorted({g.detail.split(" ", 1)[0] for g in gaps})


def test_matnr_alpha_collision_and_length():
    mara = pd.DataFrame({"MATNR": ["000000000000012345", "12345", "A" * 41, "ok-1", "lower"]})
    gaps = load_sim.check_matnr(_tf(MARA=mara), "material_master")
    by_key = {(g.record_key, g.detail.split(" ", 1)[0]) for g in gaps}
    assert ("MATNR=000000000000012345", "S4L-MM-MATNR-ALPHA") in by_key
    assert ("MATNR=12345", "S4L-MM-MATNR-ALPHA") in by_key
    assert ("MATNR=" + "A" * 41, "S4L-MM-MATNR-LEN") in by_key
    assert ("MATNR=lower", "S4L-MM-MATNR-CHARS") in by_key
    assert not any(k == "MATNR=ok-1" for k, _ in by_key)
    assert all(g.gap_type == "s4_load" and g.target_table == "MARA" for g in gaps)


def test_matnr_absent_table_is_noop():
    assert load_sim.check_matnr(_tf(), "material_master") == []
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pytest tests/test_s4_load_sim.py -q -k matnr`. Expected: `AttributeError: check_matnr`.

- [ ] **Step 3: Implement**

```python
import pandas as pd

from api.services.migration.engine import Gap
from checks.base import record_keys
from checks.frames import TableFrames

_KEYS: dict[str, list[str]] = {
    "MARA": ["MATNR"], "MBEW": ["MATNR", "BWKEY", "BWTAR"], "MARD": ["MATNR", "WERKS", "LGORT"],
    "LFA1": ["LIFNR"], "KNA1": ["KUNNR"], "KNVK": ["PARNR"], "KNKK": ["KUNNR", "KKBER"],
    "KONV": ["KNUMV", "KPOSN", "STUNR", "ZAEHK"], "NAST": ["KAPPL", "OBJKY", "KSCHL", "PARNR"],
}
_ALLOWED = r"^[A-Z0-9\-_/\.\s]*$"


def _frame(frames: TableFrames, table: str) -> pd.DataFrame | None:
    df = frames.frames.get(table)
    return df if df is not None and not df.empty else None


def _gaps(rule_id: str, module: str, table: str, field: str | None, mask: pd.Series,
          df: pd.DataFrame, values: pd.Series | None = None) -> list[Gap]:
    rule = rules()[rule_id]
    if not mask.any():
        return []
    keys = record_keys(df, [k for k in _KEYS[table] if k in df.columns])[mask]
    vals = (values if values is not None else pd.Series([None] * len(df), index=df.index))[mask]
    t_table, _, t_field = rule.target.partition(".")
    return [Gap(module=module, gap_type="s4_load", severity=rule.severity,
                detail=f"{rule_id} {rule.reason}", record_key=k, source_table=table,
                source_field=field, target_table=t_table, target_field=t_field or None,
                source_value=None if v is None or pd.isna(v) else str(v)[:200],
                provenance="s4_load_sim")
            for k, v in zip(keys.tolist(), vals.tolist())]


def check_matnr(frames: TableFrames, module: str) -> list[Gap]:
    df = _frame(frames, "MARA")
    if df is None or "MATNR" not in df.columns:
        return []
    m = df["MATNR"].astype("string").fillna("").str.strip()
    numeric = m.str.fullmatch(r"\d+")
    alpha = m.where(~numeric, m.str.lstrip("0"))
    collide = numeric & alpha.duplicated(keep=False) & numeric.groupby(alpha).transform("sum").gt(1)
    out = _gaps("S4L-MM-MATNR-LEN", module, "MARA", "MATNR", m.str.len() > 40, df, m)
    out += _gaps("S4L-MM-MATNR-ALPHA", module, "MARA", "MATNR", collide, df, m)
    out += _gaps("S4L-MM-MATNR-CHARS", module, "MARA", "MATNR", ~numeric & ~m.str.fullmatch(_ALLOWED), df, m)
    return out
```

- [ ] **Step 4: Run the tests and confirm they pass**: `pytest tests/test_s4_load_sim.py -q`.
- [ ] **Step 5: Commit** `feat(migration): S/4 MATNR load simulation`.

---

### Task 3: CVI / BP checks (number overlap, grouping, mandatory, tax, KNVK)

**Files:**
- Modify: `api/services/migration/load_sim.py`
- Test: `tests/test_s4_load_sim.py`

**Interfaces:**
- `check_cvi(frames: TableFrames, module: str, grouping_map: dict[str, str]) -> list[Gap]`
- `grouping_map` holds the `KTOKK`/`KTOKD` to `BU_GROUP` value maps. The worker passes `load_value_maps(session, module)` merged with the standard `value_map` in `ecc_to_s4hana.yaml` (read through `engine._standard()`, so the YAML is not parsed twice).

- [ ] **Step 1: Write the failing tests**

```python
def test_cvi_overlap_grouping_mandatory_tax_knvk():
    lfa1 = pd.DataFrame({"LIFNR": ["100", "200"], "NAME1": ["Alpha Supply", ""], "LAND1": ["ZA", "ZA"],
                         "KTOKK": ["KRED", "ZXXX"], "STCD1": ["T1", "T9"]})
    kna1 = pd.DataFrame({"KUNNR": ["100", "300"], "NAME1": ["Other Name", "Gamma"], "LAND1": ["ZA", ""],
                         "KTOKD": ["DEBI", "DEBI"], "STCD1": ["T1", "T3"]})
    knvk = pd.DataFrame({"PARNR": ["1", "2"], "KUNNR": ["300", "999"], "LIFNR": ["", ""]})
    gaps = load_sim.check_cvi(_tf(LFA1=lfa1, KNA1=kna1, KNVK=knvk), "business_partner",
                              {"KRED": "BP01", "DEBI": "BP02"})
    got = {(g.record_key, g.detail.split(" ", 1)[0]) for g in gaps}
    assert ("LIFNR=100", "S4L-BP-NUM-OVERLAP") in got and ("KUNNR=100", "S4L-BP-NUM-OVERLAP") in got
    assert ("LIFNR=200", "S4L-BP-GROUPING") in got
    assert ("LIFNR=200", "S4L-BP-MANDATORY") in got and ("KUNNR=300", "S4L-BP-MANDATORY") in got
    assert ("LIFNR=100", "S4L-BP-TAX") in got and ("KUNNR=100", "S4L-BP-TAX") in got
    assert ("PARNR=2", "S4L-BP-KNVK-ORPHAN") in got and ("PARNR=1", "S4L-BP-KNVK-ORPHAN") not in got


def test_cvi_same_number_same_name_is_not_overlap():
    lfa1 = pd.DataFrame({"LIFNR": ["100"], "NAME1": ["Same"], "LAND1": ["ZA"], "KTOKK": ["KRED"]})
    kna1 = pd.DataFrame({"KUNNR": ["100"], "NAME1": ["same "], "LAND1": ["ZA"], "KTOKD": ["DEBI"]})
    gaps = load_sim.check_cvi(_tf(LFA1=lfa1, KNA1=kna1), "business_partner", {"KRED": "B", "DEBI": "B"})
    assert "S4L-BP-NUM-OVERLAP" not in _ids(gaps)
```

- [ ] **Step 2: Run the tests and watch them fail.**

- [ ] **Step 3: Implement**

```python
def _norm(s: pd.Series) -> pd.Series:
    return s.astype("string").fillna("").str.strip()


def check_cvi(frames: TableFrames, module: str, grouping_map: dict[str, str]) -> list[Gap]:
    out: list[Gap] = []
    lfa1, kna1 = _frame(frames, "LFA1"), _frame(frames, "KNA1")
    sides = [(t, df, num, grp) for t, df, num, grp in
             (("LFA1", lfa1, "LIFNR", "KTOKK"), ("KNA1", kna1, "KUNNR", "KTOKD")) if df is not None]
    for table, df, num, grp in sides:
        if grp in df.columns:
            g = _norm(df[grp])
            out += _gaps("S4L-BP-GROUPING", module, table, grp, ~g.isin(list(grouping_map)), df, g)
        blank = pd.Series(False, index=df.index)
        for f in ("NAME1", "LAND1"):
            if f in df.columns:
                blank |= _norm(df[f]).eq("")
        out += _gaps("S4L-BP-MANDATORY", module, table, "NAME1/LAND1", blank, df)
    if lfa1 is not None and kna1 is not None:
        v = lfa1.assign(_n=_norm(lfa1["LIFNR"]).str.lstrip("0"), _m=_norm(lfa1.get("NAME1", "")).str.upper())
        c = kna1.assign(_n=_norm(kna1["KUNNR"]).str.lstrip("0"), _m=_norm(kna1.get("NAME1", "")).str.upper())
        clash = v.merge(c, on="_n", suffixes=("_v", "_c"))
        clash = set(clash.loc[clash["_m_v"] != clash["_m_c"], "_n"])
        out += _gaps("S4L-BP-NUM-OVERLAP", module, "LFA1", "LIFNR", v["_n"].isin(clash), lfa1)
        out += _gaps("S4L-BP-NUM-OVERLAP", module, "KNA1", "KUNNR", c["_n"].isin(clash), kna1)
    tax = [(t, df, num) for t, df, num, _ in sides if "STCD1" in df.columns]
    if tax:
        allp = pd.concat([pd.DataFrame({"tax": _norm(df["STCD1"]), "party": t + ":" + _norm(df[num])})
                          for t, df, num in tax])
        allp = allp[allp["tax"] != ""]
        # ponytail: a vendor and a customer with the same number and tax id are one party (CVI same-number
        # case); only distinct parties that share a tax id are flagged. Upgrade: use match_scores clusters.
        party_id = allp["party"].str.split(":").str[1].str.lstrip("0")
        dup_tax = set(allp.assign(p=party_id).groupby("tax")["p"].nunique().loc[lambda s: s > 1].index)
        for t, df, _ in tax:
            out += _gaps("S4L-BP-TAX", module, t, "STCD1", _norm(df["STCD1"]).isin(dup_tax), df, _norm(df["STCD1"]))
    knvk = _frame(frames, "KNVK")
    if knvk is not None:
        cust = set(_norm(kna1["KUNNR"])) if kna1 is not None else set()
        vend = set(_norm(lfa1["LIFNR"])) if lfa1 is not None else set()
        k = _norm(knvk.get("KUNNR", pd.Series("", index=knvk.index)))
        l = _norm(knvk.get("LIFNR", pd.Series("", index=knvk.index)))
        orphan = ~((k != "") & k.isin(cust)) & ~((l != "") & l.isin(vend))
        out += _gaps("S4L-BP-KNVK-ORPHAN", module, "KNVK", "KUNNR", orphan, knvk)
    return out
```

In the test, `LIFNR=100` and `KUNNR=100` have different names, so they overlap, and they share tax `T1` as two different parties because the names differ. The tax check counts distinct `p`, and `100` is the same `p` on both sides, so the second test asserts only the overlap. Adjust the first test's tax data so that it uses distinct numbers if the implementation counts both as one party: give `KNA1` 300 the tax `T1` and assert `KUNNR=300`. Keep test and code consistent, and make the test the spec.

- [ ] **Step 4: Run the tests, fix the data/assertions as described, and confirm they pass.**
- [ ] **Step 5: Commit** `feat(migration): CVI/BP load simulation`.

---

### Task 4: Credit, MRP area, material ledger checks

**Files:**
- Modify: `api/services/migration/load_sim.py`
- Test: `tests/test_s4_load_sim.py`

**Interfaces:**
- `check_credit(frames, module) -> list[Gap]`
- `check_mrp_area(frames, module) -> list[Gap]`
- `check_material_ledger(frames, module) -> list[Gap]`

- [ ] **Step 1: Write the failing tests**

```python
def test_credit_mrp_ml():
    kna1 = pd.DataFrame({"KUNNR": ["1"]})
    knkk = pd.DataFrame({"KUNNR": ["1", "2", "1"], "KKBER": ["1000", "1000", ""]})
    mard = pd.DataFrame({"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"], "LGORT": ["L1", "L2"], "DISKZ": ["1", ""]})
    t001l = pd.DataFrame({"WERKS": ["P1", "P1"], "LGORT": ["L1", "L2"], "DISKZ": ["", ""]})
    mbew = pd.DataFrame({"MATNR": ["M1", "M2", "M3"], "BWKEY": ["P1"] * 3, "BWTAR": [""] * 3,
                         "LBKUM": [5, 5, 0], "BKLAS": ["", "3000", ""], "VPRSV": ["S", "", ""],
                         "STPRS": [1, 0, 0], "VERPR": [0, 0, 0]})
    f = _tf(KNA1=kna1, KNKK=knkk, MARD=mard, T001L=t001l, MBEW=mbew)
    assert {g.record_key for g in load_sim.check_credit(f, "sd_customer_master")} == {"KUNNR=2|KKBER=1000", "KUNNR=1|KKBER="}
    assert [g.record_key for g in load_sim.check_mrp_area(f, "material_master")] == ["MATNR=M1|WERKS=P1|LGORT=L1"]
    ml = {(g.record_key.split("|")[0], g.detail.split(" ", 1)[0]) for g in load_sim.check_material_ledger(f, "material_master")}
    assert ml == {("MATNR=M1", "S4L-ML-BKLAS"), ("MATNR=M2", "S4L-ML-PRICE")}
```

- [ ] **Step 2: Run the tests and watch them fail.**

- [ ] **Step 3: Implement**

```python
def check_credit(frames: TableFrames, module: str) -> list[Gap]:
    knkk, kna1 = _frame(frames, "KNKK"), _frame(frames, "KNA1")
    if knkk is None:
        return []
    cust = set(_norm(kna1["KUNNR"])) if kna1 is not None else set()
    bad = _norm(knkk["KKBER"]).eq("") | ~_norm(knkk["KUNNR"]).isin(cust)
    return _gaps("S4L-CRM-KNKK", module, "KNKK", "KKBER", bad, knkk, _norm(knkk["KKBER"]))


def check_mrp_area(frames: TableFrames, module: str) -> list[Gap]:
    mard, t001l = _frame(frames, "MARD"), _frame(frames, "T001L")
    if mard is None or "DISKZ" not in mard.columns:
        return []
    # MARD.DISKZ set but the storage location itself is not MRP-excluded: S/4 needs a storage-location
    # MRP area for that material and none exists in T001L/MDLG config, so the MARD setting is lost.
    loc_excl = set()
    if t001l is not None and "DISKZ" in t001l.columns:
        t = t001l[_norm(t001l["DISKZ"]) != ""]
        loc_excl = set(_norm(t["WERKS"]) + "|" + _norm(t["LGORT"]))
    loc = _norm(mard["WERKS"]) + "|" + _norm(mard["LGORT"])
    bad = (_norm(mard["DISKZ"]) != "") & ~loc.isin(loc_excl)
    return _gaps("S4L-MRP-AREA", module, "MARD", "DISKZ", bad, mard, _norm(mard["DISKZ"]))


def check_material_ledger(frames: TableFrames, module: str) -> list[Gap]:
    mbew = _frame(frames, "MBEW")
    if mbew is None:
        return []
    stock = pd.to_numeric(mbew.get("LBKUM", 0), errors="coerce").fillna(0) > 0
    bklas = _norm(mbew["BKLAS"]) if "BKLAS" in mbew.columns else pd.Series("", index=mbew.index)
    vprsv = _norm(mbew["VPRSV"]) if "VPRSV" in mbew.columns else pd.Series("", index=mbew.index)
    price = (pd.to_numeric(mbew.get("STPRS", 0), errors="coerce").fillna(0)
             + pd.to_numeric(mbew.get("VERPR", 0), errors="coerce").fillna(0))
    no_class = stock & bklas.eq("")
    out = _gaps("S4L-ML-BKLAS", module, "MBEW", "BKLAS", no_class, mbew)
    out += _gaps("S4L-ML-PRICE", module, "MBEW", "VPRSV", stock & ~no_class & (vprsv.eq("") | price.le(0)), mbew)
    return out
```

- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** `feat(migration): credit/MRP-area/ML load simulation`.

---

### Task 5: Simplification items (KONV to PRCD_ELEMENTS, AFLE, NAST)

**Files:**
- Modify: `api/services/migration/load_sim.py`
- Test: `tests/test_s4_load_sim.py`

**Interfaces:**
- `check_simplification(frames, module) -> list[Gap]`

- [ ] **Step 1: Write the failing tests**

```python
def test_konv_orphan_afle_nast():
    vbak = pd.DataFrame({"VBELN": ["S1"], "KNUMV": ["K1"]})
    konv = pd.DataFrame({"KNUMV": ["K1", "K9"], "KPOSN": ["10", "10"], "STUNR": ["1", "1"],
                         "ZAEHK": ["1", "1"], "KWERT": [9_999_999_999.0, 5.0]})
    nast = pd.DataFrame({"KAPPL": ["V1", "V1"], "OBJKY": ["S1", "S1"], "KSCHL": ["BA00", "BA00"],
                         "PARNR": ["1", "2"], "VSTAT": ["0", "1"]})
    gaps = load_sim.check_simplification(_tf(VBAK=vbak, KONV=konv, NAST=nast), "sd_sales_orders")
    got = {(g.record_key.split("|")[0], g.detail.split(" ", 1)[0]) for g in gaps}
    assert got == {("KNUMV=K9", "S4L-SD-KONV-ORPHAN"), ("KNUMV=K1", "S4L-FI-AFLE"),
                   ("KAPPL=V1", "S4L-OUT-NAST-OPEN")}
```

- [ ] **Step 2: Run the tests and watch them fail.**

- [ ] **Step 3: Implement**

```python
_AFLE_EDGE = 0.95 * 10 ** 11  # CURR 13,2 holds 11 integer digits


def check_simplification(frames: TableFrames, module: str) -> list[Gap]:
    out: list[Gap] = []
    konv = _frame(frames, "KONV")
    if konv is not None:
        heads = set()
        for t in ("VBAK", "EKKO"):
            h = _frame(frames, t)
            if h is not None and "KNUMV" in h.columns:
                heads |= set(_norm(h["KNUMV"]))
        if heads:  # only judge orphans when at least one header table was extracted
            out += _gaps("S4L-SD-KONV-ORPHAN", module, "KONV", "KNUMV", ~_norm(konv["KNUMV"]).isin(heads), konv)
        if "KWERT" in konv.columns:
            kw = pd.to_numeric(konv["KWERT"], errors="coerce").abs()
            out += _gaps("S4L-FI-AFLE", module, "KONV", "KWERT", kw.ge(_AFLE_EDGE).fillna(False), konv, kw)
    nast = _frame(frames, "NAST")
    if nast is not None and "VSTAT" in nast.columns:
        out += _gaps("S4L-OUT-NAST-OPEN", module, "NAST", "VSTAT", _norm(nast["VSTAT"]).eq("0"), nast)
    return out
```

- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** `feat(migration): KONV/AFLE/NAST simplification load checks`.

---

### Task 6: `simulate()`, `fold()` into ModuleResult, `record_status()`

**Files:**
- Modify: `api/services/migration/engine.py` (extract `verdict_for`)
- Modify: `api/services/migration/load_sim.py`
- Test: `tests/test_s4_load_sim.py`, `tests/test_migration_engine.py` (must stay green)

**Interfaces:**
- `engine.verdict_for(records: int, n_blocked: int, structural_critical: bool) -> tuple[float, str]` returns `(score, verdict)`. It is the exact logic at `engine.py:217-222`, moved out unchanged.
- `load_sim.simulate(frames, module, grouping_map) -> list[Gap]` runs the checks relevant to the module's tables. A check whose table is absent is a no-op.
- `load_sim.fold(res: ModuleResult, sim: list[Gap]) -> ModuleResult` returns a new result in which blocking sim gaps remove keys from `ready_keys` and the counts include `s4_load`.
- `load_sim.record_status(gaps: list[Gap]) -> list[RecordStatus]`, where `RecordStatus` is a TypedDict with `record_key`, `source_table`, `status` (`"load_ready" | "load_fail"`) and `reasons: list[str]`.

- [ ] **Step 1: Write the failing tests**

```python
from api.services.migration.engine import Gap, ModuleResult, verdict_for


def test_verdict_for_matches_engine_rules():
    assert verdict_for(10, 0, False) == (100.0, "go")
    assert verdict_for(100, 5, False) == (95.0, "conditional")
    assert verdict_for(10, 5, False) == (50.0, "no-go")
    assert verdict_for(10, 0, True)[1] == "no-go"
    assert verdict_for(10_000, 1, False) == (99.99, "conditional")


def test_fold_moves_blocked_keys_and_recomputes():
    res = ModuleResult("material_master", 3, 0, 100.0, "go", {"field_mapping": 0},
                       {"MARA": ["MATNR=A", "MATNR=B", "MATNR=C"]})
    sim = [Gap("material_master", "s4_load", "critical", "S4L-MM-MATNR-LEN x", "MATNR=A", "MARA"),
           Gap("material_master", "s4_load", "low", "S4L-FI-AFLE x", "MATNR=B", "MARA")]
    out = load_sim.fold(res, sim)
    assert out.blocked_records == 1 and out.ready_keys["MARA"] == ["MATNR=B", "MATNR=C"]
    assert out.verdict == "no-go" and out.counts["s4_load"] == 2


def test_record_status_reasons():
    g = [Gap("m", "s4_load", "critical", "S4L-MM-MATNR-LEN too long", "MATNR=A", "MARA"),
         Gap("m", "s4_load", "low", "S4L-FI-AFLE edge", "MATNR=B", "MARA")]
    st = {r["record_key"]: r for r in load_sim.record_status(g)}
    assert st["MATNR=A"]["status"] == "load_fail" and st["MATNR=A"]["reasons"] == ["S4L-MM-MATNR-LEN too long"]
    assert st["MATNR=B"]["status"] == "load_ready"
```

- [ ] **Step 2: Run the tests and watch them fail.** Run: `pytest tests/test_s4_load_sim.py tests/test_migration_engine.py -q`.

- [ ] **Step 3: Implement**

In `engine.py`, replace lines 217-222 with a call to the extracted helper:

```python
def verdict_for(records: int, n_blocked: int, structural_critical: bool) -> tuple[float, str]:
    score = round((records - n_blocked) / records * 100, 2) if records else 0.0
    if n_blocked and score == 100.0:
        score = 99.99
    verdict = ("go" if records and n_blocked == 0 and not structural_critical
               else "conditional" if records and not structural_critical and score >= 90.0
               else "no-go")
    return score, verdict
```

and in `analyze()`: `score, verdict = verdict_for(records, n_blocked, structural_critical)`.

In `load_sim.py`:

```python
from dataclasses import replace
from typing import Literal, TypedDict

from api.services.migration.engine import ModuleResult, _BLOCKING, verdict_for


class RecordStatus(TypedDict):
    record_key: str
    source_table: str
    status: Literal["load_ready", "load_fail"]
    reasons: list[str]


def simulate(frames: TableFrames, module: str, grouping_map: dict[str, str]) -> list[Gap]:
    return (check_matnr(frames, module) + check_cvi(frames, module, grouping_map) + check_credit(frames, module)
            + check_mrp_area(frames, module) + check_material_ledger(frames, module)
            + check_simplification(frames, module))


def fold(res: ModuleResult, sim: list[Gap]) -> ModuleResult:
    blocked: dict[str, set[str]] = {}
    for g in sim:
        if g.severity in _BLOCKING and g.record_key and g.source_table:
            blocked.setdefault(g.source_table, set()).add(g.record_key)
    ready = {t: [k for k in ks if k not in blocked.get(t, set())] for t, ks in res.ready_keys.items()}
    n_blocked = res.records - sum(len(v) for v in ready.values())
    score, verdict = verdict_for(res.records, n_blocked, res.verdict == "no-go" and res.blocked_records == 0)
    counts = {**res.counts, "s4_load": res.counts.get("s4_load", 0) + len(sim)}
    return replace(res, blocked_records=n_blocked, score=score, verdict=verdict, counts=counts, ready_keys=ready)


def record_status(gaps: list[Gap]) -> list[RecordStatus]:
    out: dict[tuple[str, str], RecordStatus] = {}
    for g in gaps:
        if not g.record_key:
            continue
        r = out.setdefault((g.source_table or "", g.record_key),
                           RecordStatus(record_key=g.record_key, source_table=g.source_table or "",
                                        status="load_ready", reasons=[]))
        if g.severity in _BLOCKING:
            r["status"] = "load_fail"
            r["reasons"].append(g.detail)
    return sorted(out.values(), key=lambda r: (r["status"] != "load_fail", r["source_table"], r["record_key"]))
```

Sim gaps may land on tables outside `ready_keys`, such as KNVK, KNKK and KONV, which `analyze` did not count. Those gaps still show in `record_status` and the gap list, but do not change `records`. That is deliberate: `records` remains the engine's object count. If `res.verdict == "no-go"` with zero blocked records, the engine found a structural critical, and that condition is preserved by the third argument above.

- [ ] **Step 4: Run** `pytest tests/test_s4_load_sim.py tests/test_migration_engine.py -q`. All pass.
- [ ] **Step 5: Commit** `feat(migration): fold S/4 load simulation into module verdicts`.

---

### Task 7: Extraction coverage for dry-run tables

**Files:**
- Modify: `sap/extraction_registry.py`, `sap/extraction_plan.py`, `sap/dictionaries/extraction_windows.yaml`
- Test: `tests/test_extraction_plan_proven_cost.py`, which Task 11 shares.

**Interfaces:**
- `extraction_plan.S4_LOAD_DATA: dict[str, set[str]]`
- `extraction_plan.S4_LOAD_MODULE = "s4_load_sim"`
- Trigger: any of `business_partner`, `accounts_payable`, `accounts_receivable`, `sd_customer_master`, `material_master`, `sd_sales_orders`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_extraction_plan_proven_cost.py
from sap import extraction_plan as ep
from sap.extraction_registry import get_table_names


def _tables(modules: list[str]) -> set[str]:
    plan = ep.plan_modules(modules, None, None)
    return {t for t in plan}  # adjust to plan_modules' return shape (dict keyed by table, see DISCOVERY test)


def test_s4_load_tables_planned_for_master_modules():
    assert {"KNVK", "KNKK", "MARD", "T001L", "NAST", "KONV"} <= _tables(["sd_customer_master", "material_master"])


def test_registry_has_read_targets():
    names = set(get_table_names("ecc", "s4_load_sim"))
    assert {"KNVK", "KNKK", "MARD", "T001L", "KONV", "NAST"} <= names
```

Before writing `_tables`, read the existing discovery test (`grep -rn DISCOVERY_DATA tests/`) and copy its way of reading `plan_modules`' output.

- [ ] **Step 2: Run the tests and watch them fail.**

- [ ] **Step 3: Implement.** In `sap/extraction_plan.py`, next to `DISCOVERY_DATA`:

```python
S4_LOAD_MODULE = "s4_load_sim"
S4_LOAD_DATA: dict[str, set[str]] = {
    "KNVK": {"PARNR", "KUNNR", "LIFNR", "NAME1"},
    "KNKK": {"KUNNR", "KKBER", "KLIMK", "CTLPC"},
    "MARD": {"MATNR", "WERKS", "LGORT", "DISKZ"},
    "KONV": {"KNUMV", "KPOSN", "STUNR", "ZAEHK", "KSCHL", "KWERT"},
    "NAST": {"KAPPL", "OBJKY", "KSCHL", "PARNR", "PARVW", "VSTAT"},
}
S4_LOAD_CONFIG: dict[str, set[str]] = {"T001L": {"WERKS", "LGORT", "DISKZ"}}
_S4_LOAD_TRIGGER = {"business_partner", "accounts_payable", "accounts_receivable",
                    "sd_customer_master", "material_master", "sd_sales_orders"}
```

Then, in `plan_modules` after the discovery block, add the same loop (`add(t, set(cols), S4_LOAD_MODULE)` / `purpose="config"`). In `sap/extraction_registry.py`, add an `"s4_load_sim"` module to `ECC_EXTRACTIONS` with one `ExtractionTarget` per table above (fields as listed; `T001L` `is_config=True`). In `extraction_windows.yaml` add:

```yaml
KONV:  {via: VBAK}
NAST:  {where: "ERDAT >= '{months_ago:12}'"}
```

Also make sure `MBEW` has `LBKUM, BKLAS, VPRSV, STPRS, VERPR` and that `KNA1`/`LFA1` have `STCD1, KTOKD/KTOKK, LAND1`. Add any missing field to the existing targets.

- [ ] **Step 4: Run** `pytest tests/test_extraction_plan_proven_cost.py tests/ -q -k "extraction_plan or registry or config_loader"`. All pass.
- [ ] **Step 5: Commit** `feat(extraction): read targets for S/4 load dry run`.

---

### Task 8: Worker mode `s4_dry_run`

**Files:**
- Modify: `workers/tasks/run_migration.py`
- Test: `tests/test_s4_dry_run_route.py` (worker portion, unit-level with a fake dataset)

**Interfaces:**
- `run_migration(..., mode="s4_dry_run", dest_system_id=None, target_release="s4hana")`.
- Mode behaviour:
  - It forces the standard target dictionary (`get_dictionary("s4hana")`) and ignores `dest_system_id`.
  - It loads the dataset with `extra=set(S4_LOAD_DATA) | set(S4_LOAD_CONFIG)`.
  - After `analyze`, it calls `sim = load_sim.simulate(frames, module, grouping)` and `res = load_sim.fold(res, sim)`, and inserts `gaps + sim` through the existing `_INSERT`.
  - `summary[module]` gains `"mode": "s4_dry_run"` and `"s4_load": {rule_id: count}`.

- [ ] **Step 1: Write the failing test.** Patch `load_dataset` to return a `TableFrames` with a MARA that has an ALPHA collision, and patch `resolve_source_version` to return `("v1", {"dataset_path": "x/"})`. Then run the task body through `run_migration.run(...)` against `MERIDIAN_TEST_DB_URL`, and skip the test when the URL is unset, the same way as `tests/test_insights_impact_route.py`. Assert that:
  - `migration_gap_findings` has rows with `gap_type='s4_load'`;
  - `gap_summary['material_master']['verdict'] == 'no-go'`;
  - `gap_summary['material_master']['s4_load']['S4L-MM-MATNR-ALPHA'] == 2`.

- [ ] **Step 2: Run the test and watch it fail.**

- [ ] **Step 3: Implement.** In the task body:

```python
dry_run = mode == "s4_dry_run"
...
extra = None
if dry_run:
    from sap.extraction_plan import S4_LOAD_CONFIG, S4_LOAD_DATA
    extra = set(S4_LOAD_DATA) | set(S4_LOAD_CONFIG)
frames, _, _, _ = load_dataset(meta["dataset_path"], source_dict, modules, extra=extra,
                               conversions=conversions_for(...))
if dest_system_id and not dry_run:
    ...  # unchanged
else:
    target_dict = get_dictionary(target_release)
    target_type = target_release
...
gaps, res = analyze(...)
if dry_run:
    from api.services.migration import load_sim
    grouping = {**load_sim.standard_grouping(), **load_value_maps(session, module).get("BU_GROUP", {})}
    sim = load_sim.simulate(frames, module, grouping)
    res = load_sim.fold(res, sim)
    gaps = gaps + sim
...
summary[module] = {..., **({"mode": "s4_dry_run",
                            "s4_load": _count_rules(sim)} if dry_run else {})}
```

Add `standard_grouping()` to `load_sim`. It returns the KTOKK/KTOKD `value_map` from `engine._standard()` for target `BU_GROUP`. Before writing the accessor, read `ecc_to_s4hana.yaml` to find the exact key path; do not duplicate the YAML. Before choosing the key, verify that `load_value_maps` returns `{field: {src: tgt}}`. `_count_rules(sim)` is `Counter(g.detail.split(" ", 1)[0] for g in sim)` cast to a dict. Also store the mode on the run: `UPDATE migration_runs SET mode = :m` already happens at insert time in the route, so verify that the `mode` column exists (`grep -n '"mode"' db/migrations/versions/044_migration_mode.py`).

- [ ] **Step 4: Run the test and confirm it passes.** Also run `pytest tests/test_migration_engine.py -q`.
- [ ] **Step 5: Commit** `feat(migration): s4_dry_run worker mode`.

---

### Task 9: Routes: accept mode, per-record status, xlsx/pdf export

**Files:**
- Modify: `api/routes/migration.py`
- Create: `templates/s4_dry_run.html`
- Test: `tests/test_s4_dry_run_route.py`

**Interfaces:**
- `_VALID_MODES = ("source_to_source", "source_to_destination", "s4_dry_run")`. `s4_dry_run` needs `source_version_id` or `source_system_id`, and rejects `dest_system_id` with a 400.
- `GET /api/v1/migration/runs/{run_id}/records?status=load_fail&module=&limit=200&offset=0` returns `{total, rows: RecordStatus[] + module}`. SQL aggregates `migration_gap_findings` by `(module, object_type, record_key)`:

```sql
SELECT module, object_type AS source_table, record_key,
       CASE WHEN bool_or(severity IN ('critical','high')) THEN 'load_fail' ELSE 'load_ready' END AS status,
       array_agg(detail ORDER BY severity) FILTER (WHERE severity IN ('critical','high')) AS reasons
FROM migration_gap_findings
WHERE run_id = :rid AND tenant_id = :t AND record_key IS NOT NULL
  AND (CAST(:module AS text) IS NULL OR module = :module)
GROUP BY module, object_type, record_key
HAVING (CAST(:status AS text) IS NULL
        OR (CASE WHEN bool_or(severity IN ('critical','high')) THEN 'load_fail' ELSE 'load_ready' END) = :status)
ORDER BY status, module, record_key
LIMIT :limit OFFSET :offset
```

  This lists only records that carry at least one gap. Ready records with no gap come from `gap_summary[module].records - blocked_records`, which the page shows as a count (the engine does not persist the full key list; `ready_keys` is in memory only).
- `GET /api/v1/migration/runs/{run_id}/dry-run/{fmt}`, with `fmt` in `xlsx|pdf`:
  - xlsx uses `export.to_xlsx({"Summary": summary_df, "Load fail": fail_df, "By rule": rule_df})`;
  - pdf uses `pdf_reports.render("s4_dry_run.html", ctx)`;
  - both stream through the existing `_stream`;
  - both return 409 when the run is not `s4_dry_run` or not `analysed`.

- [ ] **Step 1: Write the failing tests.** Use the DB-backed client pattern from `tests/test_insights_impact_route.py`:
  - Insert one `migration_runs` row (`mode='s4_dry_run'`, `status='analysed'`, a `gap_summary` with one module) and three gap rows for tenant 1.
  - Assert that `/records?status=load_fail` returns only the critical record, with `reasons` that start with `S4L-`.
  - Assert that tenant 2 gets 404 for the run (RLS).
  - Assert that `/dry-run/xlsx` returns a body starting with `PK` whose sheet names include "Load fail" (open it with `openpyxl.load_workbook(io.BytesIO(body))`).
  - Assert that `/dry-run/pdf` returns content-type `application/pdf`. Mark the PDF test with `pytest.importorskip("weasyprint")`.
  - Assert that `POST /analyze` with `mode='s4_dry_run'` plus `dest_system_id` returns 400.

- [ ] **Step 2: Run the tests and watch them fail.**

- [ ] **Step 3: Implement** the routes as specified. For the PDF context, pass:

```python
ctx = {"tenant": tenant_name, "run": {"id": run_id, "completed_at": completed_at, "verdict": verdict,
                                      "score": score},
       "modules": [{"module": m, **{k: d.get(k) for k in ("records", "blocked_records", "verdict", "score")}}
                   for m, d in gap_summary.items()],
       "by_rule": rule_rows,  # [{rule_id, area, severity, reason, records}]
       "fails": fail_rows[:500]}
```

  `templates/s4_dry_run.html`:
  - Extend the same base the other report templates use (`grep -n "extends" templates/*.html | head`).
  - Render a module table with `|module`, `|n` and `|st` filters, a by-rule table, and the first 500 failing records with reasons.
  - Use no hex colours and only the existing report CSS classes.

- [ ] **Step 4: Run** `pytest tests/test_s4_dry_run_route.py -q`. All pass, or they skip without a DB.
- [ ] **Step 5: Commit** `feat(migration): dry-run records + xlsx/pdf export`.

---

### Task 10: Readiness prefers the dry run; frontend dry-run page

**Files:**
- Modify: `api/routes/insights.py` (`get_readiness` ORDER BY)
- Modify: `tests/test_insights_readiness_route.py`
- Modify: `frontend/lib/api/migration.ts`
- Create: `frontend/app/(app)/migration/dry-run/page.tsx`, `frontend/app/(app)/migration/dry-run/__tests__/page.test.tsx`

**Interfaces:**
- In `get_readiness`, add the query to `ORDER BY (mode = 's4_dry_run') DESC, completed_at DESC`. A dry run, when present for the version, drives the wave cells, and otherwise the behaviour is unchanged.
- TS additions:

```ts
export type MigrationMode = "source_to_source" | "source_to_destination" | "s4_dry_run";
export interface DryRunRecord { module: string; source_table: string; record_key: string;
  status: "load_ready" | "load_fail"; reasons: string[] }
export interface DryRunRecordsResponse { total: number; rows: DryRunRecord[] }
export async function getDryRunRecords(runId: string, params?: { status?: DryRunRecord["status"];
  module?: string; limit?: number; offset?: number }): Promise<DryRunRecordsResponse>;
export function dryRunExportUrl(runId: string, fmt: "xlsx" | "pdf"): string;
```

- [ ] **Step 1: Write the failing tests.**
  - Python: in the readiness route test, insert two analysed runs for one version. The newer run has `mode='source_to_destination'` and verdict `go`; the older run has `mode='s4_dry_run'` and verdict `no-go`. Assert that the cell verdict is `no_go`.
  - Vitest: mock `getMigrationRun` / `getDryRunRecords`. Assert that the page renders the module verdict badges, a "Load fail" table with the reason text, and two export links that point to `/dry-run/xlsx` and `/dry-run/pdf`.
- [ ] **Step 2: Run the tests and watch them fail:** `pytest tests/test_insights_readiness_route.py -q`; `cd frontend && npx vitest run app/\(app\)/migration/dry-run`.
- [ ] **Step 3: Implement.**
  - The page reads `?run=`, uses `ReportPage`, `DataTable` and the status/badge components from `@/design` (check `frontend/design/index.ts` for exact names), and `queryKeys` (add a `migrationDryRun` key in `frontend/lib/query-keys.ts`).
  - Starting a dry run reuses `startMigration({ mode: "s4_dry_run", source_version_id, modules })` from the existing migration page. Add a "Dry run (S/4 load)" option to that page's mode selector instead of adding a new form.
  - Use no raw hex.
- [ ] **Step 4: Run the gate:** `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run`, plus the pytest commands above.
- [ ] **Step 5: Commit** `feat(insights): dry-run drives readiness; dry-run results page`.

---

# Part B: Cost proven from transactions

### Task 11: Extraction coverage for transactional tables

**Files:**
- Modify: `sap/extraction_registry.py`, `sap/extraction_plan.py`, `sap/dictionaries/extraction_windows.yaml`
- Test: `tests/test_extraction_plan_proven_cost.py`

**Interfaces:**
- `PROVEN_COST_MODULE = "proven_cost"`
- `PROVEN_COST_DATA: dict[str, set[str]]`
- Triggered by any of `mm_purchasing`, `material_master`, `sd_sales_orders`, `sd_customer_master`, `accounts_payable`.

Tables and fields (all read-only):

| Table | Fields | Window |
|---|---|---|
| EKKO | EBELN, LIFNR, BUKRS, BEDAT, WAERS | existing |
| EKPO | EBELN, EBELP, MATNR, WERKS, MENGE, MEINS, BPRME, NETPR, PEINH, NETWR, INFNR | existing |
| EKET | EBELN, EBELP, ETENR, EINDT, MENGE, WEMNG | `via: EKPO` (new) |
| EKBE | add **BUDAT, DMBTR, MENGE, BPMNG, LFBNR** to existing fields | `via: EKPO` (existing) |
| EINA | INFNR, MATNR, LIFNR, MEINS | none (master) |
| EINE | INFNR, EKORG, WERKS, APLFZ, NETPR, PEINH | none |
| MARC | MATNR, WERKS, PLIFZ (existing) | none |
| MARM | MATNR, MEINH, UMREZ, UMREN | none |
| RSEG | BELNR, GJAHR, BUZEI, EBELN, EBELP, MENGE, BSTME, WRBTR | `via: RBKP` (existing) |
| VBAK | add **NETWR, WAERK, LIFSK, FAKSK, KUNNR, VKORG, VTWEG, SPART, ERDAT** | existing |
| VBUK | VBELN, CMGST, LFSTK, GBSTK | `via: VBAK` (new) |
| KNVV | KUNNR, VKORG, VTWEG, SPART, AUFSD, LIFSD (existing) | none |
| BSAK | BUKRS, LIFNR, GJAHR, BELNR, BUZEI, XBLNR, WRBTR, WAERS, BLDAT, AUGDT, SHKZG, BLART | existing (`AUGDT >= 12m`) |

- [ ] **Step 1: Add the failing tests** to `tests/test_extraction_plan_proven_cost.py`:

```python
def test_proven_cost_tables_planned():
    t = _tables(["mm_purchasing", "sd_sales_orders", "accounts_payable"])
    assert {"EKET", "EKBE", "EINA", "EINE", "MARM", "RSEG", "VBUK", "BSAK"} <= t


def test_proven_cost_registry_and_ekbe_budat():
    names = set(get_table_names("ecc", "proven_cost"))
    assert {"EKET", "EINA", "EINE", "MARM", "RSEG", "VBUK", "BSAK"} <= names
    from sap.extraction_plan import PROVEN_COST_DATA
    assert {"BUDAT", "DMBTR"} <= PROVEN_COST_DATA["EKBE"]
    assert {"LIFSK", "NETWR"} <= PROVEN_COST_DATA["VBAK"]
```

- [ ] **Step 2: Run the tests and watch them fail.**
- [ ] **Step 3: Implement.** Mirror the `DISCOVERY_DATA` block in `plan_modules`, and add a `"proven_cost"` module to `ECC_EXTRACTIONS`. Add these windows:

```yaml
EKET:  {via: EKPO}
VBUK:  {via: VBAK}
```

  If `VBAK` has no window yet, add `VBAK: {where: "ERDAT >= '{months_ago:12}'"}` (check first with `grep -n '^VBAK' sap/dictionaries/extraction_windows.yaml`). Do not widen any existing window.
- [ ] **Step 4: Run** `pytest tests/test_extraction_plan_proven_cost.py -q` and the existing extraction-plan tests.
- [ ] **Step 5: Commit** `feat(extraction): read targets for transaction-proven cost`.

---

### Task 12: Proven-cost core types and late-PO metric

**Files:**
- Create: `api/services/proven_cost.py`
- Create: `tests/test_proven_cost.py`

**Interfaces:**

```python
class CostItem(TypedDict):
    doc_key: str        # e.g. "EBELN=4500000001|EBELP=00010"
    master_key: str     # defect anchor, e.g. "MATNR=M1|WERKS=P1"
    amount: float       # document currency amount proven (never estimated)
    detail: str         # deterministic one-liner, e.g. "12 days late; PLIFZ=0; no EINE"

@dataclass(frozen=True)
class MetricResult:
    metric: str               # late_po | grir_uom_variance | blocked_sales | duplicate_payment
    amount: float
    currency: str | None      # single currency when uniform, else None (amounts summed per currency below)
    by_currency: dict[str, float]
    documents: int
    items: list[CostItem]     # capped at 1000 by the caller, sorted by amount desc

def late_pos(frames: TableFrames, today: date) -> MetricResult
```

Late-PO definition: a PO schedule line where the first GR (`EKBE.VGABE == '1'`, minimum `BUDAT` per `EBELN/EBELP`) is after `EKET.EINDT`, or where there is no GR and `EINDT < today`. The line counts only when its material has a defective lead time: `MARC.PLIFZ` is null or 0 for the `MATNR/WERKS`, or there is no `EINE` for the `EINA(MATNR, LIFNR)`, or there is no `EINA` at all. The amount is `EKPO.NETWR` for the line, which is the purchase value delivered late. No rate is invented.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_proven_cost.py
from datetime import date

import pandas as pd

from api.services import proven_cost as pc
from checks.frames import TableFrames


def _tf(**t: pd.DataFrame) -> TableFrames:
    return TableFrames(dict(t))


def _po_frames() -> TableFrames:
    ekko = pd.DataFrame({"EBELN": ["P1", "P2", "P3"], "LIFNR": ["V1"] * 3, "WAERS": ["ZAR"] * 3})
    ekpo = pd.DataFrame({"EBELN": ["P1", "P2", "P3"], "EBELP": ["10"] * 3, "MATNR": ["M1", "M2", "M3"],
                         "WERKS": ["W"] * 3, "NETWR": [1000.0, 500.0, 70.0]})
    eket = pd.DataFrame({"EBELN": ["P1", "P2", "P3"], "EBELP": ["10"] * 3, "ETENR": ["1"] * 3,
                         "EINDT": ["20260101", "20260101", "20260101"]})
    ekbe = pd.DataFrame({"EBELN": ["P1", "P2"], "EBELP": ["10", "10"], "VGABE": ["1", "1"],
                         "BUDAT": ["20260115", "20251230"]})
    marc = pd.DataFrame({"MATNR": ["M1", "M2", "M3"], "WERKS": ["W"] * 3, "PLIFZ": [0, 5, 5]})
    eina = pd.DataFrame({"INFNR": ["I1", "I2", "I3"], "MATNR": ["M1", "M2", "M3"], "LIFNR": ["V1"] * 3})
    eine = pd.DataFrame({"INFNR": ["I1", "I2"], "APLFZ": [3, 3]})
    return _tf(EKKO=ekko, EKPO=ekpo, EKET=eket, EKBE=ekbe, MARC=marc, EINA=eina, EINE=eine)


def test_late_po_requires_master_defect():
    r = pc.late_pos(_po_frames(), today=date(2026, 3, 1))
    keys = {i["doc_key"] for i in r.items}
    # P1 late + PLIFZ=0; P2 on time; P3 never received, overdue, EINE missing
    assert keys == {"EBELN=P1|EBELP=10", "EBELN=P3|EBELP=10"}
    assert r.amount == 1070.0 and r.by_currency == {"ZAR": 1070.0} and r.documents == 2
    p1 = next(i for i in r.items if i["doc_key"].startswith("EBELN=P1"))
    assert p1["master_key"] == "MATNR=M1|WERKS=W" and "14 days late" in p1["detail"] and "PLIFZ" in p1["detail"]


def test_late_po_missing_tables_returns_zero():
    r = pc.late_pos(_tf(), today=date(2026, 3, 1))
    assert r.amount == 0 and r.items == []
```

- [ ] **Step 2: Run the tests and watch them fail:** `pytest tests/test_proven_cost.py -q`.

- [ ] **Step 3: Implement**

```python
# api/services/proven_cost.py
"""Cost proven from transactions. Pure pandas, deterministic, no estimation rates:
every amount is a document value already in the extract. Each costed document is
anchored to a master-data key so attribution (finding_records) can name the check_ids."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import TypedDict

import pandas as pd

from checks.frames import TableFrames


class CostItem(TypedDict):
    doc_key: str
    master_key: str
    amount: float
    detail: str


@dataclass(frozen=True)
class MetricResult:
    metric: str
    amount: float = 0.0
    currency: str | None = None
    by_currency: dict[str, float] = field(default_factory=dict)
    documents: int = 0
    items: list[CostItem] = field(default_factory=list)


def _s(df: pd.DataFrame, col: str) -> pd.Series:
    return (df[col] if col in df.columns else pd.Series("", index=df.index)).astype("string").fillna("").str.strip()


def _num(df: pd.DataFrame, col: str) -> pd.Series:
    return pd.to_numeric(df[col], errors="coerce").fillna(0.0) if col in df.columns else pd.Series(0.0, index=df.index)


def _date(df: pd.DataFrame, col: str) -> pd.Series:
    return pd.to_datetime(_s(df, col).where(lambda s: ~s.isin(["", "00000000"])), format="%Y%m%d", errors="coerce")


def _get(frames: TableFrames, *names: str) -> list[pd.DataFrame] | None:
    out = [frames.frames.get(n) for n in names]
    return None if any(d is None or d.empty for d in out) else out


def _result(metric: str, rows: pd.DataFrame) -> MetricResult:
    """rows: doc_key, master_key, amount, currency, detail."""
    if rows.empty:
        return MetricResult(metric)
    by_cur = rows.groupby("currency")["amount"].sum().round(2).to_dict()
    cur = next(iter(by_cur)) if len(by_cur) == 1 else None
    items = [CostItem(doc_key=r.doc_key, master_key=r.master_key, amount=round(float(r.amount), 2), detail=r.detail)
             for r in rows.sort_values("amount", ascending=False).itertuples()]
    return MetricResult(metric, round(float(rows["amount"].sum()), 2), cur, by_cur,
                        int(rows["doc_key"].nunique()), items)


def late_pos(frames: TableFrames, today: date) -> MetricResult:
    got = _get(frames, "EKKO", "EKPO", "EKET")
    if got is None:
        return MetricResult("late_po")
    ekko, ekpo, eket = got
    sched = eket.assign(EBELN=_s(eket, "EBELN"), EBELP=_s(eket, "EBELP"), eindt=_date(eket, "EINDT"))
    due = sched.groupby(["EBELN", "EBELP"], as_index=False)["eindt"].min()
    ekbe = frames.frames.get("EKBE")
    if ekbe is not None and not ekbe.empty:
        gr = ekbe[_s(ekbe, "VGABE") == "1"].assign(EBELN=lambda d: _s(d, "EBELN"), EBELP=lambda d: _s(d, "EBELP"),
                                                   budat=lambda d: _date(d, "BUDAT"))
        first = gr.groupby(["EBELN", "EBELP"], as_index=False)["budat"].min()
        due = due.merge(first, on=["EBELN", "EBELP"], how="left")
    else:
        due["budat"] = pd.NaT
    ref = due["budat"].fillna(pd.Timestamp(today))
    due["days"] = (ref - due["eindt"]).dt.days
    late = due[due["days"] > 0]
    po = ekpo.assign(EBELN=_s(ekpo, "EBELN"), EBELP=_s(ekpo, "EBELP"), MATNR=_s(ekpo, "MATNR"),
                     WERKS=_s(ekpo, "WERKS"), amount=_num(ekpo, "NETWR"))
    hdr = ekko.assign(EBELN=_s(ekko, "EBELN"), LIFNR=_s(ekko, "LIFNR"), currency=_s(ekko, "WAERS"))
    df = late.merge(po, on=["EBELN", "EBELP"]).merge(hdr[["EBELN", "LIFNR", "currency"]], on="EBELN")
    df = df[df["MATNR"] != ""]
    marc = frames.frames.get("MARC")
    plifz_bad = pd.Series(True, index=df.index)
    if marc is not None and not marc.empty:
        m = marc.assign(MATNR=_s(marc, "MATNR"), WERKS=_s(marc, "WERKS"), plifz=_num(marc, "PLIFZ"))
        ok = set((m.loc[m["plifz"] > 0, "MATNR"] + "|" + m.loc[m["plifz"] > 0, "WERKS"]))
        plifz_bad = ~(df["MATNR"] + "|" + df["WERKS"]).isin(ok)
    eina, eine = frames.frames.get("EINA"), frames.frames.get("EINE")
    has_info = set()
    if eina is not None and eine is not None and not eina.empty:
        a = eina.assign(INFNR=_s(eina, "INFNR"), MATNR=_s(eina, "MATNR"), LIFNR=_s(eina, "LIFNR"))
        a = a[a["INFNR"].isin(set(_s(eine, "INFNR")))]
        has_info = set(a["MATNR"] + "|" + a["LIFNR"])
    no_eine = ~(df["MATNR"] + "|" + df["LIFNR"]).isin(has_info)
    df = df[plifz_bad | no_eine].assign(_p=plifz_bad, _e=no_eine)
    rows = pd.DataFrame({
        "doc_key": "EBELN=" + df["EBELN"] + "|EBELP=" + df["EBELP"],
        "master_key": "MATNR=" + df["MATNR"] + "|WERKS=" + df["WERKS"],
        "amount": df["amount"], "currency": df["currency"],
        "detail": df["days"].astype(int).astype(str) + " days late"
                  + df["_p"].map({True: "; PLIFZ blank/0", False: ""})
                  + df["_e"].map({True: "; no EINE info record", False: ""}),
    })
    return _result("late_po", rows)
```

The test data has P1 GR on 20260115 against EINDT 20260101, which is 14 days, so the assertion text is "14 days late".

- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** `feat(cost): late-PO proven-cost metric`.

---

### Task 13: GR/IR and UoM variance metric

**Files:**
- Modify: `api/services/proven_cost.py`
- Test: `tests/test_proven_cost.py`

**Interfaces:**
- `grir_uom_variance(frames: TableFrames) -> MetricResult`

Definition, per PO line:
- `gr_value` is Σ `EKBE.DMBTR` for `VGABE='1'`, signed by `SHKZG` (`H` is negative). `ir_value` is Σ `RSEG.WRBTR` for the line.
- The variance amount is `abs(gr_value - ir_value)`.
- A line counts only when the variance is above 0.01 and the material has a UoM defect:
  - the order unit `EKPO.MEINS` or `BPRME` differs from the base unit, and there is no `MARM` row for `(MATNR, MEINH=unit)`; or
  - `MARM.UMREZ` or `UMREN` is ≤ 0.
- The master key is `MATNR=…`.

- [ ] **Step 1: Write the failing test**

```python
def test_grir_variance_only_with_marm_defect():
    ekko = pd.DataFrame({"EBELN": ["P1", "P2"], "WAERS": ["ZAR", "ZAR"], "LIFNR": ["V", "V"]})
    ekpo = pd.DataFrame({"EBELN": ["P1", "P2"], "EBELP": ["10", "10"], "MATNR": ["M1", "M2"],
                         "WERKS": ["W", "W"], "MEINS": ["BOX", "BOX"], "BPRME": ["BOX", "BOX"], "NETWR": [0, 0]})
    mara = pd.DataFrame({"MATNR": ["M1", "M2"], "MEINS": ["EA", "EA"]})
    marm = pd.DataFrame({"MATNR": ["M2"], "MEINH": ["BOX"], "UMREZ": [12], "UMREN": [1]})
    ekbe = pd.DataFrame({"EBELN": ["P1", "P2"], "EBELP": ["10", "10"], "VGABE": ["1", "1"],
                         "DMBTR": [100.0, 100.0], "SHKZG": ["S", "S"]})
    rseg = pd.DataFrame({"EBELN": ["P1", "P2"], "EBELP": ["10", "10"], "WRBTR": [1200.0, 130.0]})
    r = pc.grir_uom_variance(_tf(EKKO=ekko, EKPO=ekpo, MARA=mara, MARM=marm, EKBE=ekbe, RSEG=rseg))
    assert [i["doc_key"] for i in r.items] == ["EBELN=P1|EBELP=10"]
    assert r.amount == 1100.0 and "no MARM BOX" in r.items[0]["detail"]
```

- [ ] **Step 2: Run the test and watch it fail.**

- [ ] **Step 3: Implement**

```python
def grir_uom_variance(frames: TableFrames) -> MetricResult:
    got = _get(frames, "EKKO", "EKPO", "EKBE", "RSEG", "MARA")
    if got is None:
        return MetricResult("grir_uom_variance")
    ekko, ekpo, ekbe, rseg, mara = got
    k = ["EBELN", "EBELP"]
    gr = ekbe[_s(ekbe, "VGABE") == "1"]
    gr = gr.assign(EBELN=_s(gr, "EBELN"), EBELP=_s(gr, "EBELP"),
                   v=_num(gr, "DMBTR") * _s(gr, "SHKZG").map({"H": -1.0}).fillna(1.0))
    ir = rseg.assign(EBELN=_s(rseg, "EBELN"), EBELP=_s(rseg, "EBELP"), v=_num(rseg, "WRBTR"))
    bal = (gr.groupby(k)["v"].sum().rename("gr").to_frame()
           .join(ir.groupby(k)["v"].sum().rename("ir"), how="outer").fillna(0.0).reset_index())
    bal["amount"] = (bal["gr"] - bal["ir"]).abs()
    bal = bal[bal["amount"] > 0.01]
    po = ekpo.assign(EBELN=_s(ekpo, "EBELN"), EBELP=_s(ekpo, "EBELP"), MATNR=_s(ekpo, "MATNR"),
                     unit=_s(ekpo, "BPRME").where(_s(ekpo, "BPRME") != "", _s(ekpo, "MEINS")))
    base = dict(zip(_s(mara, "MATNR"), _s(mara, "MEINS")))
    marm = frames.frames.get("MARM")
    conv: dict[str, tuple[float, float]] = {}
    if marm is not None and not marm.empty:
        conv = dict(zip(_s(marm, "MATNR") + "|" + _s(marm, "MEINH"), zip(_num(marm, "UMREZ"), _num(marm, "UMREN"))))
    df = bal.merge(po[k + ["MATNR", "unit"]], on=k).merge(
        ekko.assign(EBELN=_s(ekko, "EBELN"), currency=_s(ekko, "WAERS"))[["EBELN", "currency"]], on="EBELN")

    def defect(r: pd.Series) -> str:
        if r["unit"] == "" or r["unit"] == base.get(r["MATNR"], r["unit"]):
            return ""
        c = conv.get(f"{r['MATNR']}|{r['unit']}")
        if c is None:
            return f"no MARM {r['unit']}"
        return "" if c[0] > 0 and c[1] > 0 else f"MARM {r['unit']} UMREZ/UMREN <= 0"

    df["why"] = df.apply(defect, axis=1) if not df.empty else pd.Series(dtype="string")
    df = df[df["why"] != ""]
    rows = pd.DataFrame({
        "doc_key": "EBELN=" + df["EBELN"] + "|EBELP=" + df["EBELP"], "master_key": "MATNR=" + df["MATNR"],
        "amount": df["amount"], "currency": df["currency"],
        "detail": "GR " + df["gr"].round(2).astype(str) + " vs IR " + df["ir"].round(2).astype(str) + "; " + df["why"],
    })
    return _result("grir_uom_variance", rows)
```

  The `apply` is row-wise, so a comment is needed: `# ponytail: row-wise apply over variance lines only (already filtered); vectorise if >1e6 lines.`

- [ ] **Step 4: Run the test and confirm it passes.**
- [ ] **Step 5: Commit** `feat(cost): GR/IR UoM-variance proven-cost metric`.

---

### Task 14: Blocked sales orders metric

**Files:**
- Modify: `api/services/proven_cost.py`
- Test: `tests/test_proven_cost.py`

**Interfaces:**
- `blocked_sales(frames: TableFrames) -> MetricResult`

Definition:
- An order is blocked when any of these holds:
  - `VBUK.CMGST` is in `{'B','C'}` (credit not released). Fall back to `VBAK.CMGST` when VBUK is absent, which is the S/4-shaped extract.
  - `VBAK.LIFSK` is non-blank (delivery block).
  - `VBAK.FAKSK` is non-blank (billing block).
- It counts only when the sold-to has a master defect:
  - `KNVV.AUFSD`/`LIFSD` is set for the order's sales area (the block is inherited from the master);
  - there is no KNVV for the sales area; or
  - the KNA1 central block `AUFSD`/`LIFSD` is set.
- The amount is `VBAK.NETWR`, with currency `WAERK`. This is revenue held.

- [ ] **Step 1: Write the failing test**

```python
def test_blocked_sales_needs_customer_defect():
    vbak = pd.DataFrame({"VBELN": ["S1", "S2", "S3"], "KUNNR": ["C1", "C2", "C3"], "VKORG": ["O"] * 3,
                         "VTWEG": ["D"] * 3, "SPART": ["X"] * 3, "NETWR": [900.0, 50.0, 10.0],
                         "WAERK": ["ZAR"] * 3, "LIFSK": ["01", "", "01"], "FAKSK": ["", "", ""]})
    vbuk = pd.DataFrame({"VBELN": ["S1", "S2", "S3"], "CMGST": ["", "B", ""]})
    knvv = pd.DataFrame({"KUNNR": ["C1", "C3"], "VKORG": ["O", "O"], "VTWEG": ["D", "D"], "SPART": ["X", "X"],
                         "AUFSD": ["", ""], "LIFSD": ["01", ""]})
    kna1 = pd.DataFrame({"KUNNR": ["C1", "C2", "C3"], "AUFSD": ["", "", ""], "LIFSD": ["", "", ""]})
    r = pc.blocked_sales(_tf(VBAK=vbak, VBUK=vbuk, KNVV=knvv, KNA1=kna1))
    assert {i["doc_key"] for i in r.items} == {"VBELN=S1", "VBELN=S2"}  # S2: no KNVV; S3: master clean
    assert r.amount == 950.0
```

- [ ] **Step 2: Run the test and watch it fail.**

- [ ] **Step 3: Implement**

```python
def blocked_sales(frames: TableFrames) -> MetricResult:
    got = _get(frames, "VBAK")
    if got is None:
        return MetricResult("blocked_sales")
    (vbak,) = got
    area = ["KUNNR", "VKORG", "VTWEG", "SPART"]
    so = vbak.assign(**{c: _s(vbak, c) for c in ["VBELN", *area, "LIFSK", "FAKSK", "CMGST"]},
                     amount=_num(vbak, "NETWR"), currency=_s(vbak, "WAERK"))
    vbuk = frames.frames.get("VBUK")
    if vbuk is not None and not vbuk.empty:
        so = so.drop(columns="CMGST").merge(vbuk.assign(VBELN=_s(vbuk, "VBELN"), CMGST=_s(vbuk, "CMGST"))[["VBELN", "CMGST"]],
                                            on="VBELN", how="left")
        so["CMGST"] = so["CMGST"].fillna("")
    credit, deliv, bill = so["CMGST"].isin(["B", "C"]), so["LIFSK"] != "", so["FAKSK"] != ""
    so = so[credit | deliv | bill].assign(_c=credit, _d=deliv, _b=bill)
    knvv = frames.frames.get("KNVV")
    kv = (knvv.assign(**{c: _s(knvv, c) for c in [*area, "AUFSD", "LIFSD"]})[[*area, "AUFSD", "LIFSD"]]
          if knvv is not None and not knvv.empty else pd.DataFrame(columns=[*area, "AUFSD", "LIFSD"]))
    so = so.merge(kv, on=area, how="left", indicator=True)
    kna1 = frames.frames.get("KNA1")
    central = set()
    if kna1 is not None and not kna1.empty:
        central = set(_s(kna1, "KUNNR")[(_s(kna1, "AUFSD") != "") | (_s(kna1, "LIFSD") != "")])
    no_area = so["_merge"] == "left_only"
    area_block = (so["AUFSD"].fillna("") != "") | (so["LIFSD"].fillna("") != "")
    cen = so["KUNNR"].isin(central)
    so = so[no_area | area_block | cen]
    why = (so["_c"].map({True: "credit block; ", False: ""}) + so["_d"].map({True: "delivery block; ", False: ""})
           + so["_b"].map({True: "billing block; ", False: ""})
           + no_area[so.index].map({True: "no KNVV for sales area", False: ""})
           + area_block[so.index].map({True: "KNVV order/delivery block", False: ""})
           + cen[so.index].map({True: " KNA1 central block", False: ""}))
    rows = pd.DataFrame({"doc_key": "VBELN=" + so["VBELN"],
                         "master_key": "KUNNR=" + so["KUNNR"] + "|VKORG=" + so["VKORG"] + "|VTWEG=" + so["VTWEG"]
                                       + "|SPART=" + so["SPART"],
                         "amount": so["amount"], "currency": so["currency"], "detail": why.str.strip()})
    return _result("blocked_sales", rows)
```

- [ ] **Step 4: Run the test and confirm it passes.**
- [ ] **Step 5: Commit** `feat(cost): blocked-sales proven-cost metric`.

---

### Task 15: Duplicate vendor payments metric

**Files:**
- Modify: `api/services/proven_cost.py`
- Test: `tests/test_proven_cost.py`

**Interfaces:**
- `vendor_clusters(pairs: list[tuple[str, str]]) -> dict[str, str]` maps a normalised LIFNR (leading zeros stripped, `LIFNR=` prefix removed) to its cluster root. It is a union-find.
- `duplicate_payments(frames: TableFrames, clusters: dict[str, str]) -> MetricResult`

The worker reads `pairs` (Task 17):

```sql
SELECT candidate_a_key, candidate_b_key FROM match_scores
WHERE tenant_id = :t AND domain IN ('vendor','business_partner') AND auto_action <> 'rejected'
  AND total_score >= :floor
```

`:floor` is `merge_explain.REVIEW_FLOOR`. Before finalising the filter, verify the domain names and `auto_action` values in `api/services/match_engine.py`.

Definition:
- Use BSAK payment rows (`SHKZG='S'`, debit to the vendor, which is the payment or clearing side), grouped by `(cluster, BUKRS, WAERS, abs(WRBTR), normalised XBLNR)`.
- When `XBLNR` is blank, group on `BLDAT` instead.
- A group with more than one `BELNR` across **two or more distinct LIFNR**, or with repeated BELNR for the same reference within the cluster, is a duplicate payment.
- The proven amount is `WRBTR × (count − 1)`, which is the overpayment.
- The master key is `LIFNR=<every LIFNR in the cluster>`, joined with `,`. Attribution matches each LIFNR separately.

- [ ] **Step 1: Write the failing tests**

```python
def test_vendor_clusters_union_find():
    c = pc.vendor_clusters([("LIFNR=0000000100", "200"), ("200", "300"), ("400", "500")])
    assert c["100"] == c["200"] == c["300"] and c["400"] == c["500"] and c["100"] != c["400"]


def test_duplicate_payment_across_cluster():
    bsak = pd.DataFrame({"BUKRS": ["1"] * 4, "LIFNR": ["100", "200", "100", "300"],
                         "BELNR": ["B1", "B2", "B3", "B4"], "XBLNR": ["INV-9", "inv 9", "INV-1", "INV-9"],
                         "WRBTR": [5000.0, 5000.0, 10.0, 5000.0], "WAERS": ["ZAR"] * 4,
                         "SHKZG": ["S"] * 4, "BLDAT": ["20260101"] * 4})
    r = pc.duplicate_payments(_tf(BSAK=bsak), pc.vendor_clusters([("100", "200")]))
    assert r.amount == 5000.0 and r.documents == 1
    assert r.items[0]["master_key"] == "LIFNR=100,200"  # 300 is not in the cluster, so excluded
```

- [ ] **Step 2: Run the tests and watch them fail.**

- [ ] **Step 3: Implement**

```python
def _lifnr(k: str) -> str:
    return k.split("=", 1)[-1].strip().lstrip("0")


def vendor_clusters(pairs: list[tuple[str, str]]) -> dict[str, str]:
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in pairs:
        ra, rb = find(_lifnr(a)), find(_lifnr(b))
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)
    return {k: find(k) for k in parent}


def duplicate_payments(frames: TableFrames, clusters: dict[str, str]) -> MetricResult:
    got = _get(frames, "BSAK")
    if got is None or not clusters:
        return MetricResult("duplicate_payment")
    (bsak,) = got
    p = bsak[_s(bsak, "SHKZG") == "S"]
    p = p.assign(lif=_s(p, "LIFNR").str.lstrip("0"), BELNR=_s(p, "BELNR"), BUKRS=_s(p, "BUKRS"),
                 currency=_s(p, "WAERS"), amt=_num(p, "WRBTR").abs(),
                 ref=_s(p, "XBLNR").str.upper().str.replace(r"[^A-Z0-9]", "", regex=True))
    p = p[p["lif"].isin(clusters)]
    p = p.assign(cluster=p["lif"].map(clusters), ref=p["ref"].where(p["ref"] != "", "BLDAT:" + _s(p, "BLDAT")))
    g = p.groupby(["cluster", "BUKRS", "currency", "amt", "ref"]).agg(
        docs=("BELNR", "nunique"), lifs=("lif", lambda s: ",".join(sorted(set(s)))), belnr=("BELNR", lambda s: ",".join(sorted(set(s))))
    ).reset_index()
    g = g[g["docs"] > 1]
    rows = pd.DataFrame({"doc_key": "BUKRS=" + g["BUKRS"] + "|BELNR=" + g["belnr"],
                         "master_key": "LIFNR=" + g["lifs"], "amount": g["amt"] * (g["docs"] - 1),
                         "currency": g["currency"],
                         "detail": g["docs"].astype(str) + " payments of " + g["amt"].round(2).astype(str)
                                   + " ref " + g["ref"]})
    return _result("duplicate_payment", rows)
```

  ponytail: the reference is normalised by stripping non-alphanumerics, so "INV-9" equals "inv 9". Add fuzzy reference matching only if stewards report misses.

- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** `feat(cost): duplicate-vendor-payment proven-cost metric`.

---

### Task 16: Attribution to finding check_ids, and `compute()`

**Files:**
- Modify: `api/services/proven_cost.py`
- Test: `tests/test_proven_cost.py`

**Interfaces:**
- `attribute(items: list[CostItem], failing: dict[str, set[str]]) -> dict[str, list[str]]`
  - `failing` maps a check_id to the set of record keys from `finding_records` for this version.
  - The result maps each `doc_key` to its check_ids, sorted.
  - An item matches a failing key when every `field=value` pair in the failing key's parsed form (`api.services.lineage.parse_record_key`) that is also present in the item's master key agrees, and at least one field overlaps. For a multi-LIFNR master key, any LIFNR may match.
- `compute(frames, today, clusters, failing) -> list[MetricRow]`, where `MetricRow` is a TypedDict with `metric`, `amount`, `currency`, `by_currency`, `documents`, `check_ids: list[str]` and `items: list[CostItem & {"check_ids": list[str]}]`, capped at 1000.

- [ ] **Step 1: Write the failing test**

```python
def test_attribute_matches_on_overlapping_fields():
    items = [pc.CostItem(doc_key="EBELN=P1|EBELP=10", master_key="MATNR=M1|WERKS=W", amount=1, detail=""),
             pc.CostItem(doc_key="BUKRS=1|BELNR=B1,B2", master_key="LIFNR=100,200", amount=1, detail="")]
    failing = {"MM140": {"MATNR=M1|WERKS=W"}, "MM001": {"MATNR=M1"}, "MM002": {"MATNR=M2"},
               "S4-CVI-LFA1": {"LIFNR=0000000200"}, "X": {"BUKRS=1"}}
    out = pc.attribute(items, failing)
    assert out["EBELN=P1|EBELP=10"] == ["MM001", "MM140"]
    assert out["BUKRS=1|BELNR=B1,B2"] == ["S4-CVI-LFA1"]


def test_compute_runs_all_four_metrics():
    rows = pc.compute(_po_frames(), date(2026, 3, 1), {}, {"MM140": {"MATNR=M1|WERKS=W"}})
    assert [r["metric"] for r in rows] == ["late_po", "grir_uom_variance", "blocked_sales", "duplicate_payment"]
    assert rows[0]["check_ids"] == ["MM140"] and rows[0]["items"][0]["check_ids"] in (["MM140"], [])
```

- [ ] **Step 2: Run the tests and watch them fail.**

- [ ] **Step 3: Implement**

```python
from api.services.lineage import parse_record_key


def _master_variants(master_key: str) -> list[dict[str, str]]:
    base = dict(p.split("=", 1) for p in master_key.split("|") if "=" in p)
    multi = {k: v.split(",") for k, v in base.items() if "," in v}
    if not multi:
        return [base]
    (k, vals), = multi.items()  # only LIFNR lists today
    return [{**base, k: v} for v in vals]


def _z(v: str) -> str:
    return v.strip().lstrip("0") or "0"


def attribute(items: list[CostItem], failing: dict[str, set[str]]) -> dict[str, list[str]]:
    parsed = [(cid, p) for cid, keys in failing.items() for k in keys if (p := parse_record_key(k))]
    out: dict[str, list[str]] = {}
    for it in items:
        hits: set[str] = set()
        for mv in _master_variants(it["master_key"]):
            for cid, fk in parsed:
                shared = set(fk) & set(mv)
                if shared and all(_z(fk[f]) == _z(mv[f]) for f in shared):
                    hits.add(cid)
        out[it["doc_key"]] = sorted(hits)
    return out


class MetricRow(TypedDict):
    metric: str
    amount: float
    currency: str | None
    by_currency: dict[str, float]
    documents: int
    check_ids: list[str]
    items: list[dict[str, object]]


def compute(frames: TableFrames, today: date, clusters: dict[str, str],
            failing: dict[str, set[str]]) -> list[MetricRow]:
    results = [late_pos(frames, today), grir_uom_variance(frames), blocked_sales(frames),
               duplicate_payments(frames, clusters)]
    rows: list[MetricRow] = []
    for r in results:
        items = r.items[:1000]
        att = attribute(items, failing)
        rows.append(MetricRow(metric=r.metric, amount=r.amount, currency=r.currency, by_currency=r.by_currency,
                              documents=r.documents,
                              check_ids=sorted({c for v in att.values() for c in v}),
                              items=[{**i, "check_ids": att[i["doc_key"]]} for i in items]))
    return rows
```

  ponytail: attribution is O(items × failing keys), and items are capped at 1000. If `finding_records` exceeds about 1e5 rows per version, index `failing` by field value instead.

  The test `failing` key `"X": {"BUKRS=1"}` has no field shared with the master key, so it never matches. That is intended: attribution is to master defects, not document fields.

- [ ] **Step 4: Run** `pytest tests/test_proven_cost.py -q`. All pass.
- [ ] **Step 5: Commit** `feat(cost): attribute proven cost to finding check_ids`.

---

### Task 17: Migration `NNN_proven_cost_results` + Celery task + enqueue

**Files:**
- Create: `db/migrations/versions/NNN_proven_cost_results.py`
- Create: `workers/tasks/compute_proven_cost.py`
- Modify: `workers/tasks/run_checks.py` (enqueue beside `run_exception_scan`) and `workers/celery_app.py` (include/route, if tasks are listed explicitly; check with `grep -n run_exception_scan workers/celery_app.py`)
- Test: `tests/test_compute_proven_cost_task.py`

**Interfaces:**
- Table `proven_cost_results`:
  - Columns: `id uuid pk default gen_random_uuid()`, `tenant_id uuid fk tenants not null`, `version_id uuid fk analysis_versions on delete cascade not null`, `metric text not null`, `amount numeric not null`, `currency text null`, `by_currency jsonb not null default '{}'`, `documents int not null`, `check_ids text[] not null default '{}'`, `items jsonb not null default '[]'`, `computed_at timestamptz default now()`.
  - Unique constraint on `(version_id, metric)`.
  - Index on `(tenant_id, version_id)`.
  - RLS through the `_rls()` helper copied from `066_analysis_run_steps.py`.
- Task `workers.tasks.compute_proven_cost.compute_proven_cost(version_id: str, tenant_id: str, parquet_path: str)` with `soft_time_limit=600, time_limit=660`. It upserts with `ON CONFLICT (version_id, metric) DO UPDATE`.

- [ ] **Step 1: Write the failing test.** Use DB-backed setup that skips without `MERIDIAN_TEST_DB_URL`:
  - Insert a tenant, an `analysis_versions` row and `finding_records` (`MM140`, `MATNR=M1|WERKS=W`).
  - Patch `workers.dataset.load_dataset` to return `_po_frames()` (import it from `tests.test_proven_cost`).
  - Call `compute_proven_cost.run(version_id, tenant_id, "x/")` twice, to prove idempotency.
  - Assert exactly four rows for the version, that `late_po.amount == 1070` and that `check_ids == ['MM140']`.
  - Assert that tenant 2, under `SET app.tenant_id`, sees zero rows.

- [ ] **Step 2: Run the test and watch it fail.**

- [ ] **Step 3: Implement the migration**

```python
"""proven cost results

Revision ID: NNN
Revises: <current head>
Create Date: 2026-10-10

Per-version, per-metric money already lost/held in transactions (late POs, GR/IR UoM
variance, blocked sales, duplicate vendor payments), attributed to finding check_ids.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "NNN"
down_revision: Union[str, None] = "<current head>"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.create_table(
        "proven_cost_results",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("analysis_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("metric", sa.Text(), nullable=False),
        sa.Column("amount", sa.Numeric(), nullable=False),
        sa.Column("currency", sa.Text(), nullable=True),
        sa.Column("by_currency", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("documents", sa.Integer(), nullable=False),
        sa.Column("check_ids", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("items", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("computed_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("version_id", "metric", name="uq_proven_cost_version_metric"),
    )
    op.create_index("ix_proven_cost_tenant_version", "proven_cost_results", ["tenant_id", "version_id"])
    _rls("proven_cost_results")


def downgrade() -> None:
    op.drop_table("proven_cost_results")
```

  If the repo grants app-role privileges per table in migrations, copy that line from 066 as well (`grep -n GRANT db/migrations/versions/066_analysis_run_steps.py`).

- [ ] **Step 4: Implement the task**

```python
# workers/tasks/compute_proven_cost.py
"""Post-analysis: money proven lost/held in transactions, attributed to findings. Deterministic."""
import json
import logging
from datetime import date

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker")

_UPSERT = text("""
    INSERT INTO proven_cost_results (tenant_id, version_id, metric, amount, currency, by_currency,
                                     documents, check_ids, items)
    VALUES (:t, :v, :metric, :amount, :currency, CAST(:by_currency AS jsonb), :documents, :check_ids,
            CAST(:items AS jsonb))
    ON CONFLICT (version_id, metric) DO UPDATE SET amount = EXCLUDED.amount, currency = EXCLUDED.currency,
        by_currency = EXCLUDED.by_currency, documents = EXCLUDED.documents, check_ids = EXCLUDED.check_ids,
        items = EXCLUDED.items, computed_at = now()
""")


@celery_app.task(bind=True, name="workers.tasks.compute_proven_cost.compute_proven_cost",
                 soft_time_limit=600, time_limit=660, acks_late=True)
def compute_proven_cost(self, version_id: str, tenant_id: str, parquet_path: str) -> dict[str, int]:
    from api.routes.merge_explain import REVIEW_FLOOR
    from api.services import proven_cost as pc
    from api.services.source_design import dictionary_for
    from sap.extraction_plan import PROVEN_COST_DATA
    from workers.dataset import load_dataset

    with Session(get_sync_engine()) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        try:
            system_id = session.execute(text("SELECT system_id FROM analysis_versions WHERE id = :v"),
                                        {"v": version_id}).scalar()
            frames, _, _, _ = load_dataset(parquet_path, dictionary_for(session, system_id), None,
                                           extra=set(PROVEN_COST_DATA))
            failing: dict[str, set[str]] = {}
            for cid, key in session.execute(text(
                    "SELECT check_id, record_key FROM finding_records WHERE version_id = :v AND tenant_id = :t"),
                    {"v": version_id, "t": tenant_id}):
                failing.setdefault(cid, set()).add(key)
            pairs = [(a, b) for a, b in session.execute(text("""
                SELECT candidate_a_key, candidate_b_key FROM match_scores
                WHERE tenant_id = :t AND domain IN ('vendor', 'business_partner')
                  AND auto_action <> 'rejected' AND total_score >= :floor"""),
                {"t": tenant_id, "floor": REVIEW_FLOOR})]
            rows = pc.compute(frames, date.today(), pc.vendor_clusters(pairs), failing)
            session.execute(_UPSERT, [{
                "t": tenant_id, "v": version_id, "metric": r["metric"], "amount": r["amount"],
                "currency": r["currency"], "by_currency": json.dumps(r["by_currency"]),
                "documents": r["documents"], "check_ids": r["check_ids"], "items": json.dumps(r["items"]),
            } for r in rows])
            session.commit()
            return {r["metric"]: r["documents"] for r in rows}
        except SoftTimeLimitExceeded:
            session.rollback()
            logger.warning(f"compute_proven_cost {version_id}: time limit")
            return {}
```

  Verify that the `analysis_versions` column holding the system id is named `system_id` (`grep -n system_id db/migrations/versions/0*.py | head`), and verify `load_dataset(modules=None)` semantics. If `None` does not mean "all", pass `list(PROVEN_COST_DATA)`-derived modules exactly as `run_checks` does.

  `date.today()` makes "late without GR" depend on the run date. That is the only time input, and it is stored implicitly by `computed_at`. Re-running the same version on another day can therefore change `late_po`, which is acceptable because the cost is still accruing.

- [ ] **Step 5: Enqueue** it in `run_checks.py`, directly after the `run_exception_scan` block:

```python
        try:
            from workers.tasks.compute_proven_cost import compute_proven_cost
            compute_proven_cost.delay(version_id, tenant_id, parquet_path)
        except Exception as e:
            logger.warning(f"Failed to enqueue compute_proven_cost (non-fatal): {e}")
```

- [ ] **Step 6: Run** `alembic upgrade head` on the test DB, then `pytest tests/test_compute_proven_cost_task.py -q`.
- [ ] **Step 7: Commit** `feat(cost): persist proven cost per analysis version`.

---

### Task 18: `GET /api/v1/insights/proven-cost` + exec narrative

**Files:**
- Modify: `api/routes/insights.py`
- Test: `tests/test_proven_cost_route.py`, `tests/test_insights_exec_route.py`

**Interfaces:**
- `GET /api/v1/insights/proven-cost?version_id=` returns:
  ```
  {version_id, currency, total, rows: [{metric, label, amount, currency, by_currency, documents,
  check_ids, items}], value_at_risk_total}
  ```
- Labels are deterministic: `late_po` is "Late POs (lead-time / info-record defects)", `grir_uom_variance` is "GR/IR variance (UoM defects)", `blocked_sales` is "Sales orders blocked (customer master)" and `duplicate_payment` is "Duplicate vendor payments".
- `currency` is `tenants.cost_model.currency`, falling back to `checks.cost.defaults()["currency"]`. `total` sums only rows whose `currency` equals that currency. Other currencies are reported in `by_currency` and are never converted.
- `value_at_risk_total` is `sum(row.value_at_risk)` from `get_impact` for the same version, so the panel shows both side by side.
- In `get_exec`, add `proven_cost_total` and append to the narrative: `f"{total:,.2f} {currency} proven lost or held in transactions."`.

- [ ] **Step 1: Write the failing tests**, modelled on `tests/test_insights_impact_route.py`:
  - Seed two tenants. Give tenant 1 `proven_cost_results` rows in ZAR plus one USD row, and set `cost_model.currency` to `ZAR`.
  - Assert that `total` excludes USD, that the rows are ordered by the fixed metric order and that `check_ids` round-trips.
  - Assert that tenant 2 sees `rows == []`.
  - Assert that there is no version, so the latest version with rows is used, the same as in `get_impact`.
  - Assert that the exec narrative contains "proven lost or held".

- [ ] **Step 2: Run the tests and watch them fail.**

- [ ] **Step 3: Implement**

```python
_METRIC_LABEL = {
    "late_po": "Late POs (lead-time / info-record defects)",
    "grir_uom_variance": "GR/IR variance (UoM defects)",
    "blocked_sales": "Sales orders blocked (customer master)",
    "duplicate_payment": "Duplicate vendor payments",
}


@router.get("/proven-cost", dependencies=[Depends(require_permission("view"))])
async def get_proven_cost(
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _rls(db, tenant)
    if version_id is None:
        version_id = (await db.execute(text("""
            SELECT av.id FROM analysis_versions av
            WHERE av.tenant_id = :t AND EXISTS (SELECT 1 FROM proven_cost_results p
                                                WHERE p.version_id = av.id AND p.tenant_id = :t)
            ORDER BY av.run_at DESC LIMIT 1"""), {"t": str(tenant.id)})).scalar()
        if version_id is None:
            return {"version_id": None, "currency": None, "total": 0.0, "rows": [], "value_at_risk_total": 0.0}
    from checks.cost import defaults
    cost_model = (await db.execute(text("SELECT cost_model FROM tenants WHERE id = :t"),
                                   {"t": str(tenant.id)})).scalar() or {}
    currency = cost_model.get("currency") or defaults().get("currency")
    res = await db.execute(text("""
        SELECT metric, amount, currency, by_currency, documents, check_ids, items
        FROM proven_cost_results WHERE version_id = :v AND tenant_id = :t"""),
        {"v": str(version_id), "t": str(tenant.id)})
    by_metric = {r.metric: r for r in res.fetchall()}
    rows = [{"metric": m, "label": label, "amount": float(r.amount), "currency": r.currency,
             "by_currency": r.by_currency, "documents": r.documents, "check_ids": list(r.check_ids),
             "items": r.items}
            for m, label in _METRIC_LABEL.items() if (r := by_metric.get(m))]
    total = round(sum(float((r["by_currency"] or {}).get(currency, 0.0)) for r in rows), 2)
    impact = await get_impact(version_id, db, tenant)
    return {"version_id": str(version_id), "currency": currency, "total": total, "rows": rows,
            "value_at_risk_total": round(sum(r["value_at_risk"] for r in impact["rows"]), 2)}
```

  Verify the `checks.cost.defaults()` return shape (`grep -n "def defaults" -A8 checks/cost.py`); the currency is `ZAR` in `checks/cost_model.yaml`. In `get_exec`, call `get_proven_cost(version_id, db, tenant)` and extend the response and narrative as specified.

- [ ] **Step 4: Run** `pytest tests/test_proven_cost_route.py tests/test_insights_exec_route.py tests/test_insights_impact_route.py -q`.
- [ ] **Step 5: Commit** `feat(insights): proven-cost endpoint beside value-at-risk`.

---

### Task 19: Frontend proven-cost panel on the impact page

**Files:**
- Modify: `frontend/lib/api/insights.ts`
- Modify: `frontend/lib/query-keys.ts` (only if `queryKeys.insights(name, run)` does not already cover it, which it likely does)
- Modify: `frontend/app/(app)/insights/impact/page.tsx`
- Modify: `frontend/app/(app)/insights/impact/__tests__/page.test.tsx`
- Modify: `ExecResponse` (add `proven_cost_total?: number`)

**Interfaces:**

```ts
export type ProvenCostMetric = "late_po" | "grir_uom_variance" | "blocked_sales" | "duplicate_payment";
export interface ProvenCostItem { doc_key: string; master_key: string; amount: number; detail: string;
  check_ids: string[] }
export interface ProvenCostRow { metric: ProvenCostMetric; label: string; amount: number;
  currency: string | null; by_currency: Record<string, number>; documents: number;
  check_ids: string[]; items: ProvenCostItem[] }
export interface ProvenCostResponse { version_id: string | null; currency: string | null; total: number;
  rows: ProvenCostRow[]; value_at_risk_total: number }
export async function getProvenCost(params?: { version_id?: string }): Promise<ProvenCostResponse> {
  const { data } = await apiClient.get<ProvenCostResponse>("/api/v1/insights/proven-cost", { params });
  return data;
}
```

- [ ] **Step 1: Write the failing vitest.**
  - Mock `getImpact` (existing) and `getProvenCost`, with one row `{metric: "late_po", amount: 1070, check_ids: ["MM140"], …}`, `total: 1070` and `value_at_risk_total: 5000`.
  - Assert that both headline figures render ("Proven cost" and "Value at risk").
  - Assert that the row label is present and that a `DrillLink` to the check `MM140` exists, reusing the pattern the page already uses with `filters={{ causing_rules: ... }}`.
  - Assert that the empty state shows when `rows` is empty.

- [ ] **Step 2: Run the test and watch it fail:** `cd frontend && npx vitest run app/\(app\)/insights/impact`.

- [ ] **Step 3: Implement.**
  - Add a second `useQuery({ queryKey: queryKeys.insights("proven-cost", run), queryFn: () => getProvenCost({ version_id: run }) })`.
  - Render a two-stat header using the stat/KPI component from `@/design` (check the exports in `frontend/design/index.ts`; do not create a new component), placing proven total and value-at-risk side by side.
  - Render a `DataTable<ProvenCostRow>` with these columns:
    - Metric, as the label;
    - Documents;
    - Proven amount, `amount.toLocaleString()` plus the currency;
    - Linked checks, as `DrillLink` chips for `check_ids`.
  - The expanded row lists the top items (`doc_key`, `detail`, `amount`) through the table's existing expand/sub-row support, if `DataTable` has it; otherwise use a plain nested `DataTable`.
  - Use no raw hex and design tokens only.

- [ ] **Step 4: Run the gate:** `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run`.
- [ ] **Step 5: Commit** `feat(insights): proven-cost panel next to value-at-risk`.

---

### Task 20: Full verification

- [ ] **Step 1: Backend.** Run `pytest tests/test_s4_load_sim.py tests/test_s4_dry_run_route.py tests/test_extraction_plan_proven_cost.py tests/test_proven_cost.py tests/test_proven_cost_route.py tests/test_compute_proven_cost_task.py tests/test_migration_engine.py tests/test_insights_readiness_route.py tests/test_insights_impact_route.py tests/test_insights_exec_route.py -q`, then the full `pytest -q`. Expected: no new failures against the origin/main baseline.
- [ ] **Step 2: Migrations.** Run `alembic upgrade head && alembic downgrade -1 && alembic upgrade head` on the test DB. Confirm a single head with `alembic heads`.
- [ ] **Step 3: Frontend.** `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run`, and confirm the `lint:tokens` allowlist is still empty.
- [ ] **Step 4: Constraint sweep.**
  - `grep -rnE "\bAny\b|: any\b|as any" api/services/migration/load_sim.py api/services/proven_cost.py workers/tasks/compute_proven_cost.py frontend/lib/api/insights.ts frontend/lib/api/migration.ts` returns nothing.
  - `grep -rn "#[0-9a-fA-F]\{3,6\}" frontend/app/\(app\)/insights/impact frontend/app/\(app\)/migration/dry-run` returns nothing.
  - `git diff origin/main -- checks/rules sap/dictionaries/migration/s4_load_rules.yaml` shows only additions to rule ids.
- [ ] **Step 5: Manual smoke.** On a tenant with an analysed ECC version:
  - POST `/api/v1/migration/analyze` `{mode: "s4_dry_run", source_version_id, modules: ["material_master","business_partner"]}`.
  - Wait for `analysed`.
  - Open `/migration/dry-run?run=<id>`, download the xlsx and pdf, and confirm that `/insights/readiness` reflects the dry-run verdicts.
  - Re-run an analysis and confirm that `/insights/impact` shows the proven-cost panel with linked check ids.
- [ ] **Step 6: Commit** any fixups (with the trailer). Do not open a PR unless asked; batch these with the other market-leader work.
