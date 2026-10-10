# Learned House Rules and Safe Fix-Back Implementation Plan

> **Migration numbering (controller ruling):** this plan's migrations are 071 and 072 (down_revisions 070 and 071); read 067 below as 071, 068 as 072. Execution order: S/4 load dry run, then change-document delta, then learned rules. The monitoring/migration-cockpit branch (migrations 067 and 068) merges first. Run `alembic heads` before writing a migration and adjust if the head moved.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Mine each tenant's own extract for implicit rules that hold for at least 95% of records: functional dependencies, conditional value sets, field formats and per-group numeric ranges. Propose them for human approval and turn the approved ones into real rules with new append-only `LR-` ids. (B) Turn approved fixes (stewardship batches, approved cleaning items, simulation output) into downloadable SAP correction packages. The packages are Migration Cockpit-style xlsx templates, MM17/XD99/XK99 mass-maintenance files and an MDG change-request payload file. Each package has a four-eyes approval, an audit row, a sha256 record and a before/after diff. Meridian never writes to SAP.

**Architecture:**

*Part A.* A new pure module `checks/house_rules.py` extends the existing profiler (`checks/profiling.py`), reusing `shape_of`, `_shapes`, `_is_code` and `is_sensitive`.
- It sums contingency tables chunk by chunk over pyarrow row batches. `workers/dataset.iter_parquet_chunks` supplies the batches, so no random sampling and no whole-table load.
- It fits the frozen parameters (value sets, regex, ranges) on a deterministic head, the first 200 000 rows. It then counts support and violations over every row.
- A new Celery task, `workers/tasks/mining/house_rules.py`, runs under the existing mining orchestrator as include `"house_rules"`. It upserts proposals into a new RLS table `learned_rule_proposals` (migration 067) and notifies reviewers through the existing `rule_proposal_task._notify_reviewers`.
- New routes in `api/routes/learned_rules.py` list, approve and reject proposals. Approval writes an `active` row into the existing `rule_versions` lifecycle under a new `LR-NNNNNN` id. From the next run, the runner executes it through `lifecycle.authored_rules`.
- Learned dependencies and value sets run on `dependency_check`, extended with a frozen `allowed` mapping. Formats run on `regex_check`. Ranges run on a new `group_range_check`.
- `workers/tasks/mining/relationship.py` loses its `random.sample`.

*Part B.* The existing remediation batch flow (`api/services/remediation.py`, `api/routes/remediation.py`) already has maker (`apply`), checker (`approve`, never the creator) and export (`export`, approved batches only).
- It gains two new batch sources: approved `cleaning_queue` rows and a stored simulation's record fixes.
- A new pure module, `api/services/sap_packages.py`, adds three export formats:
  - `ltmc_xlsx`, built on the existing `cockpit_sheets`;
  - `mass_maintenance_zip`, for MM17/XD99/XK99;
  - `mdg_cr_json`.
- Every export writes a row to a new RLS table `export_packages` (migration 068) with the sha256, alongside the existing `remediation_events` "exported" row.
- A `GET /batches/{id}/diff` endpoint returns the before/after diff.
- The frontend extends the existing Fix › Batches drawer and adds a Rules › Learned page.

**Tech Stack:**
- Backend: Python 3.12, pandas, numpy, pyarrow, FastAPI, SQLAlchemy (async routes, sync workers), Alembic, Celery, openpyxl, pytest.
- Frontend: Next.js and React with TanStack Query and Table, `@/design`, and vitest with Testing Library.

## Global Constraints

Copy these into every task's mental checklist. They are not negotiable.

- Python 3.12, with type hints. No `Any` / `any` in new code (Python or TypeScript).
- No customer names in code, tests, fixtures, comments or commit messages.
- Rule IDs are append-only. A learned rule gets a fresh `LR-NNNNNN` id. Never reuse, renumber or delete an id. Retire through the lifecycle instead.
- Every query is tenant-scoped with RLS:
  - Sync sessions run `SET app.tenant_id = :tid` first.
  - Async routes call the module's `_set_rls` / `_rls` helper first.
  - New tables get ENABLE + FORCE RLS and the standard `tenant_id = current_setting('app.tenant_id')::uuid` policy.
- Alembic: check the current head and number from it. On origin/main the head is `066`, so the new migrations are `067` and `068`. Other in-flight branches also claim `067`/`068`, so before writing a migration run `ls db/migrations/versions | sort | tail -3` on the branch. If 067 or 068 is taken, renumber (filename, `revision`, `down_revision`) to the next free numbers.
- Frontend uses `@/design` only, with no raw hex. The `lint:tokens` allowlist stays empty.
- SAP access is read-only; Meridian never writes to SAP. Every package is a downloaded file. No RFC, BAPI, OData or MDG API call is added. `api/routes/writeback.py` is neither used nor extended.
- Determinism: the same input gives the same output. No unseeded randomness, ties break on the smallest value, and outputs are sorted.
- Celery tasks set `soft_time_limit` and `time_limit`, use `workers.db.get_sync_engine()` and are idempotent.
- Spreadsheet safety: every xlsx cell whose openpyxl `data_type` is `"f"` is forced to `"s"` (the existing remediation export guard), so a value like `=A1` is never a formula.
- Never run `npm run build`. The frontend gate, run from `frontend/`: `npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run`.
- Do not commit unless the executing workflow says to. Commit messages end with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
```

## File map

| File | Status | Responsibility |
|---|---|---|
| `workers/dataset.py` | modify | `iter_parquet_chunks`: row batches of one parquet object in file order |
| `checks/house_rules.py` | create | Pure miners: contingency, value set or dependency, format, range, `mine_frame` |
| `checks/types/dependency_check.py` | modify | Optional frozen `allowed` mapping |
| `checks/types/group_range_check.py` | create | Numeric field inside its group's learned range |
| `checks/runner.py` | modify | Register `group_range_check` |
| `workers/tasks/mining/relationship.py` | modify | Deterministic pair cap (no `random.sample`) |
| `db/migrations/versions/067_learned_rule_proposals.py` | create | Proposals table and RLS |
| `db/schema.py` | modify | `LearnedRuleProposal`, `ExportPackage` models |
| `workers/tasks/mining/house_rules.py` | create | Celery task: stream, mine, upsert, notify |
| `workers/tasks/mining/orchestrator.py` | modify | `"house_rules"` include |
| `workers/tasks/rule_proposal_task.py` | modify | `_notify_reviewers` gains roles, title, body and link kwargs |
| `api/routes/learned_rules.py` | create | List, mine, approve (to `LR-` id) and reject |
| `api/main.py` | modify | Register the router |
| `frontend/lib/api/learnedRules.ts` | create | Client and types |
| `frontend/lib/query-keys.ts` | modify | `learnedRules`, `remediationDiff`, `remediationPackages` keys |
| `frontend/app/(app)/rules/learned/page.tsx` | create | Review page |
| `frontend/app/(app)/rules/page.tsx` | modify | Link to the Learned page |
| `api/services/remediation.py` | modify | `store_batch`, `items_from_cleaning`, `items_from_simulation`, `batch_diff` |
| `api/services/fix_simulation.py` | modify | Record fixes carry `current_value` |
| `workers/tasks/run_simulation.py` | modify | Store `record_fixes` in the result doc |
| `api/services/sap_packages.py` | create | LTMC workbook, mass-maintenance zip, MDG CR payload, xlsx guard |
| `db/migrations/versions/068_export_packages.py` | create | `export_packages` table, `proposal_source` check widened |
| `api/routes/remediation.py` | modify | New sources, formats, sha256 record, diff, packages list |
| `frontend/lib/api/remediation.ts` | modify | New formats, diff, packages, from-cleaning |
| `frontend/app/(app)/fix/batches-tab.tsx` | modify | Format picker options, before/after diff, package hashes |
| `tests/test_house_rules.py` | create | Miner unit tests |
| `tests/test_dataset_chunks.py` | create | Chunk reader |
| `tests/test_group_range_check.py` | create | New check plus frozen dependency |
| `tests/test_relationship_determinism.py` | create | Pair cap |
| `tests/test_house_rules_task.py` | create | Task units (bundle parent join, upsert params) |
| `tests/test_learned_rules_pg.py` | create | Migration, RLS, approval to `LR-` id (real Postgres) |
| `tests/test_sap_packages.py` | create | Package builders |
| `tests/test_remediation.py` | modify | New sources, diff |
| `tests/test_export_packages_pg.py` | create | Export route records sha256, four-eyes (real Postgres) |

---

# Part A — Learned house rules

## Algorithms (normative; the tasks implement exactly this)

All thresholds are module constants in `checks/house_rules.py`.

| Constant | Value | Meaning |
|---|---|---|
| `MIN_CONFIDENCE` | 0.95 | A rule must hold for at least 95% of in-scope rows. Rules at exactly 1.0 are skipped (nothing to flag; the profiler does the same). |
| `MIN_GROUP_ROWS` | 200 | A determinant value (group) needs at least 200 rows… |
| `MIN_GROUP_SHARE` | 0.005 | …and at least 0.5% of all rows to be frozen into a rule |
| `MAX_SET` | 5 | A value set may hold at most 5 values per group. Any wider group means B is not governed by A, and the pair is dropped. |
| `CARD_MIN`, `CARD_MAX` | 2, 200 | Cardinality cap for a determinant or code candidate (on the head) and for a determinant over all chunks |
| `MAX_DISTINCT_SHARE` | 0.20 | Distinct values at most 20% of filled rows (otherwise it is an identifier, not a code) |
| `MAX_CANDIDATES` | 30 | Code candidate columns per frame, and numeric columns per frame, sorted by name |
| `MAX_PER_KIND` | 50 | Proposals kept per frame per kind, ranked by (support desc, confidence desc, names) |
| `FORMAT_MIN_ROWS` | 1000 | Filled rows needed before a format is proposed |
| `RANGE_Q` | (0.025, 0.975) | Range quantiles, `numpy.quantile(method="nearest")` |
| `RANGE_PAD` | 0.10 | Range widened by 10% of its span on both sides |
| `FIT_ROWS` | 200 000 | Deterministic head (`checks.profiling.MAX_PROFILE_ROWS`) used to choose candidates and fit ranges |
| `CHUNK_ROWS` | 250 000 | pyarrow batch size |

1. **Candidates (head).**
   - A code column passes all of these:
     - `_is_code(dictionary, col)`;
     - not `is_sensitive`;
     - filled distinct count in [2, 200] and at most 20% of filled rows.
   - A numeric column has DDIC type in {CURR, QUAN, DEC, FLTP, INT1, INT2, INT4, INT8} and is not sensitive.
   - A text column has DDIC type CHAR and is not sensitive.
   - Each list is sorted by name and capped.
2. **Dependency or value set (all rows).**
   - For every ordered pair (A, B) of distinct code candidates, sum `value_counts()` of (A, B) over rows with A filled, chunk by chunk, into a `Counter`. Blank B counts as the value `""`.
   - Once A shows more than 200 distinct values, the pair is dropped.
   - Per A value with n_a rows, where n_a is at least max(200, 0.005 × rows):
     - Sort the B values by (count desc, value asc).
     - Take the shortest prefix S whose cumulative count is at least 0.95 × n_a.
     - If |S| > 5, drop the pair.
   - confidence = Σ prefix counts ÷ Σ n_a over the frozen groups. The pair is kept when it is at least 0.95 and below 1.0, and the frozen groups do not all share one identical S (if they do, A adds no information).
   - The kind is `dependency` when every S has one value, otherwise `value_set`.
   - The rule body is `dependency_check` with `allowed: {a: sorted(S)}`.
3. **Format (all rows).**
   - Sum `_shapes()` counts per text column over all chunks.
   - The dominant shape, by (count desc, shape asc), needs at least 1000 filled rows, a share of at least 0.95 and below 1.0, and a length below `SHAPE_CAP`; a capped shape is truncated and cannot be anchored.
   - The regex is run-length encoded and anchored: `A`→`[^\W\d_]`, `9`→`\d`, other characters `re.escape`d. For example `AA-9999` becomes `^[^\W\d_]{2}\-\d{4}$`.
   - The body is `regex_check`.
4. **Range (fit on head, count on all rows).**
   - Take each pair (code candidate G, numeric N). Per G value with at least 200 numeric rows in the head, compute lo and hi by `quantile(RANGE_Q, method="nearest")` and pad each side by 10% of the span. A zero-span group is skipped.
   - Over all chunks, rows with a fitted G value and numeric N are in scope; a violation is a row outside [lo, hi].
   - Keep the pair when confidence is at least 0.95 and below 1.0.
   - The body is `group_range_check` with `ranges: {g: [lo, hi]}`.
5. **Sample keys.**
   - For every kept proposal, evaluate its body on the head with the real check class and take the first 5 failing `record_keys` in head order.
   - Full violation counts come from all rows.
6. **Cross-table pairs.**
   - Flat uploads already hold every module table in one frame, so pairs such as `MARA.MTART → MARC.BESKZ` are mined directly.
   - For extraction bundles, each child table's chunks are left-joined to a lookup of its parent's code columns. The lookup holds at most 10 columns, comes from `sap/dictionaries/joins.yaml` edges, and is held as `category`.
   - The proposal's `grain` is the dependent field's table.

---

### Task 1: Chunked parquet reader

**Files:**
- Modify: `workers/dataset.py`
- Test: `tests/test_dataset_chunks.py`

**Interfaces:**
- Produces: `iter_parquet_chunks(path: str, keep: Callable[[str], bool] | None = None, chunk_rows: int = CHUNK_ROWS) -> Iterator[pd.DataFrame]` and `bundle_object(path: str, table: str) -> str`.
- Consumes: the existing `_client`, `_read` and `parquet_name`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_dataset_chunks.py
"""iter_parquet_chunks: file-order row batches, projected, never a whole-table load."""
import io

import pandas as pd

from workers import dataset


def _bytes(df: pd.DataFrame, row_group_size: int) -> bytes:
    buf = io.BytesIO()
    df.to_parquet(buf, row_group_size=row_group_size)
    return buf.getvalue()


def test_chunks_cover_every_row_in_order_and_project(monkeypatch):
    df = pd.DataFrame({"MARA.MATNR": [f"{i:04d}" for i in range(10)], "MARA.MTART": ["ROH"] * 10,
                       "MARC.WERKS": ["1000"] * 10})
    data = _bytes(df, 4)
    monkeypatch.setattr(dataset, "_client", lambda: None)
    monkeypatch.setattr(dataset, "_read", lambda client, bucket, name: data)
    chunks = list(dataset.iter_parquet_chunks("u/flat.parquet", keep=lambda c: c.startswith("MARA."), chunk_rows=3))
    assert all(len(c) <= 3 for c in chunks)
    out = pd.concat(chunks, ignore_index=True)
    assert list(out.columns) == ["MARA.MATNR", "MARA.MTART"]
    assert out["MARA.MATNR"].tolist() == df["MARA.MATNR"].tolist()


def test_bundle_object_name():
    assert dataset.bundle_object("t/v/", "/SCWM/AQUA") == "t/v/%2FSCWM%2FAQUA.parquet"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_dataset_chunks.py -q`
Expected: FAIL with `AttributeError: module 'workers.dataset' has no attribute 'iter_parquet_chunks'`

- [ ] **Step 3: Implement**

Add to `workers/dataset.py`, below `parquet_name`:

```python
CHUNK_ROWS = 250_000


def bundle_object(path: str, table: str) -> str:
    """Object name of one table inside an extraction bundle prefix."""
    return path + parquet_name(table)


def iter_parquet_chunks(path: str, keep: Optional[Callable[[str], bool]] = None,
                        chunk_rows: int = CHUNK_ROWS) -> Iterator[pd.DataFrame]:
    """Row batches of one parquet object in file order, projected to the columns ``keep``
    accepts. Only one decoded batch is in pandas at a time.

    ponytail: the compressed object is read into memory once; switch to a ranged
    MinIO file object if single parquet objects outgrow worker RAM."""
    import pyarrow.parquet as pq

    bucket = os.getenv("MINIO_BUCKET_UPLOADS", "meridian-uploads")
    pf = pq.ParquetFile(io.BytesIO(_read(_client(), bucket, path)))
    cols = [c for c in pf.schema_arrow.names if keep is None or keep(c)]
    if not cols:
        return
    for batch in pf.iter_batches(batch_size=chunk_rows, columns=cols):
        yield batch.to_pandas()
```

Add `from typing import Callable, Iterator` to the existing `typing` import.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_dataset_chunks.py -q`
Expected: PASS (2 passed)

---

### Task 2: Frozen dependency mapping and `group_range_check`

**Files:**
- Modify: `checks/types/dependency_check.py`
- Create: `checks/types/group_range_check.py`
- Modify: `checks/runner.py` (import and `REGISTRY` entry)
- Test: `tests/test_group_range_check.py`

**Interfaces:**
- Produces: the `dependency_check` rule key `allowed: dict[str, list[str]]`. When present, only determinant values in `allowed` are in scope, and a row fails when its dependent value is not in the list. The new `group_range_check` takes the rule keys `group_by: str`, `field: str` and `ranges: dict[str, list[float]]`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_group_range_check.py
import pandas as pd

from checks.runner import REGISTRY
from checks.types.dependency_check import DependencyCheck
from checks.types.group_range_check import GroupRangeCheck


def test_frozen_allowed_mapping_ignores_current_majority():
    df = pd.DataFrame({"MARA.MTART": ["ROH", "ROH", "ROH", "FERT", "HAWA", None],
                       "MARC.BESKZ": ["E", "E", "F", "X", "Q", "E"]})
    rule = {"id": "LR-000001", "check_class": "dependency_check", "determinant": "MARA.MTART",
            "field": "MARC.BESKZ", "allowed": {"ROH": ["F"], "FERT": ["E", "X"]}}
    ev = DependencyCheck(rule).evaluate(df)
    assert ev.populated.tolist() == [True, True, True, True, False, False]   # HAWA not frozen, blank out
    assert ev.failing.tolist() == [True, True, False, False, False, False]  # majority E no longer wins


def test_dependency_without_allowed_is_unchanged():
    df = pd.DataFrame({"A.X": ["1", "1", "1"], "A.Y": ["a", "a", "b"]})
    ev = DependencyCheck({"id": "HR-1", "determinant": "A.X", "field": "A.Y"}).evaluate(df)
    assert ev.failing.tolist() == [False, False, True]


def test_group_range_flags_outside_and_skips_unknown_groups():
    df = pd.DataFrame({"MARA.MTART": ["ROH", "ROH", "FERT", "HAWA", "ROH"],
                       "MARA.BRGEW": ["5", "50", "150", "1", "abc"]})
    rule = {"id": "LR-000002", "check_class": "group_range_check", "group_by": "MARA.MTART",
            "field": "MARA.BRGEW", "ranges": {"ROH": [0.1, 10.9], "FERT": [90.0, 210.0]}}
    ev = GroupRangeCheck(rule).evaluate(df)
    assert ev.populated.tolist() == [True, True, True, False, False]
    assert ev.failing.tolist() == [False, True, False, False, False]
    assert REGISTRY["group_range_check"] is GroupRangeCheck
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_group_range_check.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'checks.types.group_range_check'`

- [ ] **Step 3: Implement**

In `checks/types/dependency_check.py`:
- Append to the docstring: "A learned rule (``LR-``) carries ``allowed``: the mapping frozen when a person approved it. Only its determinant values are in scope."
- Replace `evaluate` with:

```python
    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        a = df[self.rule["determinant"]].astype("string").str.strip()
        b = df[self.rule["field"]].astype("string").str.strip().fillna("")
        populated = ~is_blank(df[self.rule["determinant"]])
        allowed: dict[str, list[str]] | None = self.rule.get("allowed")
        if allowed:
            pairs = {f"{k}\x1f{v}" for k, vs in allowed.items() for v in vs}
            scope = populated & a.isin(list(allowed))
            failing = scope & ~(a.fillna("") + "\x1f" + b).isin(pairs)
            return Evaluation(scope, failing, {"determinant": self.rule["determinant"], "groups": len(allowed),
                                               "frozen": True})
        # ponytail: expected mapping follows the data's majority each run; learned rules freeze it in ``allowed``
        expected = b[populated].groupby(a[populated]).agg(lambda s: s.value_counts().index[0])
        failing = populated & b.ne(a.map(expected).fillna(""))
        return Evaluation(populated, failing, {"determinant": self.rule["determinant"],
                                               "groups": int(expected.size)})
```

Create `checks/types/group_range_check.py`:

```python
"""A numeric field must stay inside the range its group learned from the data
(house rule ``range``): e.g. raw-material gross weight between 0.1 and 10.9.
Rows whose group has no learned range, or whose value is not numeric, are out
of scope (other rules own them)."""

import pandas as pd

from checks.base import BaseCheck, Evaluation


class GroupRangeCheck(BaseCheck):
    check_class = "group_range_check"
    default_dimension = "validity"

    def columns(self) -> list[str]:
        return [self.rule["group_by"], self.rule["field"]]

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        ranges: dict[str, list[float]] = self.rule["ranges"]
        g = df[self.rule["group_by"]].astype("string").str.strip().fillna("")
        # ponytail: SAP trailing-minus values ("100-") read as non-numeric and stay out of scope
        x = pd.to_numeric(df[self.rule["field"]].astype("string").str.strip(), errors="coerce")
        lo = g.map({k: v[0] for k, v in ranges.items()})
        hi = g.map({k: v[1] for k, v in ranges.items()})
        scope = lo.notna() & x.notna()
        failing = scope & ((x < lo) | (x > hi))
        return Evaluation(scope, failing.fillna(False).astype(bool),
                          {"group_by": self.rule["group_by"], "groups": len(ranges)},
                          invalid_values_field=self.rule["field"])
```

In `checks/runner.py`, add `from checks.types.group_range_check import GroupRangeCheck` next to the other type imports, and add `"group_range_check": GroupRangeCheck,` to `REGISTRY`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_group_range_check.py tests/test_dependency_check.py -q`
Expected: PASS

---

### Task 3: Contingency accumulator and dependency / value-set miner

**Files:**
- Create: `checks/house_rules.py`
- Test: `tests/test_house_rules.py`

**Interfaces:**
- Produces:
  - `Proposal` (frozen dataclass): `kind`, `field`, `determinant`, `body`, `confidence`, `support_rows`, `violations`, `sample_keys`, plus the `fingerprint` and `table` properties;
  - `norm(series) -> pd.Series`;
  - `PairCounts` (with `add(chunk)`, `.counts`, `.rows`);
  - `value_set_rule(counts, rows, det, dep) -> Proposal | None`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_house_rules.py
"""Learned house rules: deterministic, chunk-invariant miners."""
from collections import Counter

import numpy as np
import pandas as pd

from checks import house_rules as hr


def test_value_set_rule_dependency_with_violators():
    # ROH: 990 F + 10 E → S={F}; FERT: 600 E + 400 X → S={E, X} covers 100%.
    counts = Counter({("ROH", "F"): 990, ("ROH", "E"): 10, ("FERT", "E"): 600, ("FERT", "X"): 400})
    p = hr.value_set_rule(counts, rows=2000, det="MARA.MTART", dep="MARC.BESKZ")
    assert p is not None and p.kind == "value_set"
    assert p.body["allowed"] == {"FERT": ["E", "X"], "ROH": ["F"]}
    assert p.violations == 10 and p.support_rows == 2000
    assert abs(p.confidence - 0.995) < 1e-9


def test_single_value_groups_are_a_dependency():
    counts = Counter({("ROH", "F"): 990, ("ROH", "E"): 10, ("FERT", "E"): 1000})
    p = hr.value_set_rule(counts, rows=2000, det="MARA.MTART", dep="MARC.BESKZ")
    assert p is not None and p.kind == "dependency" and p.body["check_class"] == "dependency_check"


def test_rejections():
    perfect = Counter({("ROH", "F"): 1000, ("FERT", "E"): 1000})
    assert hr.value_set_rule(perfect, 2000, "A.X", "A.Y") is None                      # nothing to flag
    same = Counter({("ROH", "F"): 990, ("ROH", "E"): 10, ("FERT", "F"): 995, ("FERT", "E"): 5})
    assert hr.value_set_rule(same, 2000, "A.X", "A.Y") is None                         # A adds nothing
    wide = Counter({("ROH", str(i)): 100 for i in range(10)} | {("FERT", "E"): 990, ("FERT", "Q"): 10})
    assert hr.value_set_rule(wide, 2000, "A.X", "A.Y") is None                         # |S| > 5
    small = Counter({("ROH", "F"): 150, ("ROH", "E"): 5})
    assert hr.value_set_rule(small, 155, "A.X", "A.Y") is None                         # < MIN_GROUP_ROWS


def test_pair_counts_are_chunk_invariant_and_cap_cardinality():
    i = np.arange(3000)
    df = pd.DataFrame({"T.A": np.where(i % 2 == 0, "ROH", "FERT"), "T.B": np.where(i % 3 == 0, "x", "y"),
                       "T.ID": [str(v) for v in i]})
    whole, parts = hr.PairCounts([("T.A", "T.B"), ("T.ID", "T.B")]), hr.PairCounts([("T.A", "T.B"), ("T.ID", "T.B")])
    whole.add(df)
    for s in range(0, 3000, 700):
        parts.add(df.iloc[s:s + 700])
    assert whole.counts == parts.counts and whole.rows == parts.rows == 3000
    assert ("T.ID", "T.B") not in whole.counts  # 3000 distinct determinants > CARD_MAX
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_house_rules.py -q`
Expected: FAIL with `ImportError: cannot import name 'house_rules' from 'checks'`

- [ ] **Step 3: Implement**

```python
# checks/house_rules.py
"""Learned house rules: implicit rules a tenant's own data follows for at least 95%
of records, mined deterministically chunk by chunk, proposed for human approval.

Kinds
  dependency  A decides B: every frequent A value maps to one B value.
  value_set   A limits B: every frequent A value maps to at most 5 B values.
  format      B's dominant shape (letter A, digit 9) as an anchored regex.
  range       numeric B per group A: [p2.5, p97.5] widened by 10% of the span.

Determinism: no sampling. Counts are summed over every chunk in file order;
fitted parameters come from the first FIT_ROWS rows; ties break on the
smallest value; outputs are sorted. See the plan
docs/superpowers/plans/2026-10-10-learned-rules-and-fix-back.md "Algorithms".
"""
from __future__ import annotations

import hashlib
from collections import Counter
from dataclasses import dataclass
from typing import Literal

import pandas as pd

from checks.base import is_blank

MIN_CONFIDENCE = 0.95
MIN_GROUP_ROWS = 200
MIN_GROUP_SHARE = 0.005
MAX_SET = 5
CARD_MIN, CARD_MAX = 2, 200
MAX_DISTINCT_SHARE = 0.20
MAX_CANDIDATES = 30
MAX_PER_KIND = 50
FORMAT_MIN_ROWS = 1000
RANGE_Q = (0.025, 0.975)
RANGE_PAD = 0.10
SAMPLE_KEYS = 5

Kind = Literal["dependency", "value_set", "format", "range"]
type Json = str | int | float | bool | None | list[Json] | dict[str, Json]


@dataclass(frozen=True)
class Proposal:
    kind: Kind
    field: str
    determinant: str | None
    body: dict[str, Json]
    confidence: float
    support_rows: int
    violations: int
    sample_keys: tuple[str, ...] = ()

    @property
    def table(self) -> str:
        return self.field.split(".", 1)[0]

    @property
    def fingerprint(self) -> str:
        """Identity of the learned rule across runs: same kind, columns → same proposal row."""
        return hashlib.sha1(f"{self.kind}|{self.determinant or ''}|{self.field}".encode()).hexdigest()[:16]


def norm(s: pd.Series) -> pd.Series:
    """Stripped text; blanks (None, NaN, whitespace) as ''."""
    t = s.astype("string").str.strip().fillna("")
    return t.where(~is_blank(s), "")


class PairCounts:
    """(A value, B value) -> rows for ordered column pairs, summed over chunks (rows with A filled).
    A pair whose determinant passes CARD_MAX distinct values is dropped for good."""

    def __init__(self, pairs: list[tuple[str, str]]) -> None:
        self.counts: dict[tuple[str, str], Counter[tuple[str, str]]] = {p: Counter() for p in pairs}
        self.rows = 0

    def add(self, chunk: pd.DataFrame) -> None:
        self.rows += len(chunk)
        cols = sorted({c for p in self.counts for c in p})
        cache = {c: norm(chunk[c]) for c in cols if c in chunk}
        for p in list(self.counts):
            if p[0] not in cache or p[1] not in cache:
                continue
            a, b = cache[p[0]], cache[p[1]]
            filled = a != ""
            vc = pd.DataFrame({"a": a[filled], "b": b[filled]}).value_counts(sort=False)
            self.counts[p].update({(str(k[0]), str(k[1])): int(n) for k, n in vc.items()})
            if len({k[0] for k in self.counts[p]}) > CARD_MAX:
                del self.counts[p]


def _message(kind: Kind, field: str, determinant: str | None) -> str:
    return {
        "dependency": f"{field} does not follow {determinant} the way the rest of your data does",
        "value_set": f"{field} holds a value not normally used with this {determinant}",
        "format": f"{field} does not match the format almost every other record uses",
        "range": f"{field} is outside the usual range for this {determinant}",
    }[kind]


def value_set_rule(counts: Counter[tuple[str, str]], rows: int, det: str, dep: str) -> Proposal | None:
    """Shortest set of B values covering at least 95% of each frequent A value's rows."""
    by_a: dict[str, list[tuple[str, int]]] = {}
    for (a, b), n in counts.items():
        by_a.setdefault(a, []).append((b, n))
    floor = max(MIN_GROUP_ROWS, MIN_GROUP_SHARE * rows)
    allowed: dict[str, list[str]] = {}
    inside = total = 0
    for a in sorted(by_a):
        bs = sorted(by_a[a], key=lambda x: (-x[1], x[0]))
        n_a = sum(n for _, n in bs)
        if n_a < floor:
            continue
        cum, keep = 0, []
        for b, n in bs:
            keep.append(b)
            cum += n
            if cum >= MIN_CONFIDENCE * n_a:
                break
        if len(keep) > MAX_SET:
            return None
        allowed[a] = sorted(keep)
        inside, total = inside + cum, total + n_a
    if not allowed or len({tuple(v) for v in allowed.values()}) == 1:
        return None
    conf = inside / total
    if conf < MIN_CONFIDENCE or conf >= 1.0:
        return None
    kind: Kind = "dependency" if all(len(v) == 1 for v in allowed.values()) else "value_set"
    body: dict[str, Json] = {"check_class": "dependency_check", "determinant": det, "field": dep,
                             "allowed": {k: list(v) for k, v in allowed.items()},
                             "grain": dep.split(".", 1)[0], "dimension": "consistency",
                             "message": _message(kind, dep, det)}
    return Proposal(kind, dep, det, body, conf, total, total - inside)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_house_rules.py -q`
Expected: PASS (4 passed)

---

### Task 4: Format miner

**Files:**
- Modify: `checks/house_rules.py`
- Test: `tests/test_house_rules.py` (append)

**Interfaces:**
- Produces:
  - `shape_regex(shape: str) -> str`;
  - `ShapeCounts(cols)`, with `add(chunk)` and `.counts: dict[str, Counter[str]]`;
  - `format_rule(shapes: Counter[str], field: str) -> Proposal | None`.

- [ ] **Step 1: Write the failing tests**

```python
def test_shape_regex_is_anchored_and_run_length_encoded():
    import re
    rx = hr.shape_regex("AA-9999")
    assert rx == r"^[^\W\d_]{2}\-\d{4}$"
    assert re.match(rx, "MG-0042") and not re.match(rx, "MG-42") and not re.match(rx, "MG-00421")


def test_format_rule_from_chunks():
    vals = pd.Series([f"MG-{i % 50:04d}" for i in range(2000)])
    vals[::50] = "misc"                                  # 2% off-format
    sc = hr.ShapeCounts(["MARA.MATKL"])
    for s in range(0, 2000, 300):
        sc.add(pd.DataFrame({"MARA.MATKL": vals.iloc[s:s + 300]}))
    p = hr.format_rule(sc.counts["MARA.MATKL"], "MARA.MATKL")
    assert p is not None and p.kind == "format" and p.violations == 40
    assert p.body == {"check_class": "regex_check", "field": "MARA.MATKL", "pattern": r"^[^\W\d_]{2}\-\d{4}$",
                      "dimension": "validity", "message": p.body["message"]}


def test_format_rule_needs_rows_and_dominance():
    assert hr.format_rule(Counter({"AA": 990, "99": 9}), "T.F") is None             # < FORMAT_MIN_ROWS
    assert hr.format_rule(Counter({"AA": 900, "99": 200}), "T.F") is None           # < 95%
    assert hr.format_rule(Counter({"A" * 20: 2000, "9": 10}), "T.F") is None        # capped shape
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_house_rules.py -q -k "shape or format"`
Expected: FAIL with `AttributeError: module 'checks.house_rules' has no attribute 'shape_regex'`

- [ ] **Step 3: Implement**

Append to `checks/house_rules.py` and add imports `import re`, `from itertools import groupby` and `from checks.profiling import SHAPE_CAP, _shapes`:

```python
_TOKEN = {"A": r"[^\W\d_]", "9": r"\d"}


def shape_regex(shape: str) -> str:
    """'AA-9999' → '^[^\\W\\d_]{2}\\-\\d{4}$' (letters, digits, literal rest)."""
    out = []
    for ch, run in ((k, len(list(g))) for k, g in groupby(shape)):
        tok = _TOKEN.get(ch, re.escape(ch))
        out.append(tok if run == 1 else f"{tok}{{{run}}}")
    return "^" + "".join(out) + "$"


class ShapeCounts:
    """Shape -> filled rows per text column, summed over chunks."""

    def __init__(self, cols: list[str]) -> None:
        self.counts: dict[str, Counter[str]] = {c: Counter() for c in cols}

    def add(self, chunk: pd.DataFrame) -> None:
        for c, ctr in self.counts.items():
            if c in chunk:
                v = norm(chunk[c])
                ctr.update({str(k): int(n) for k, n in _shapes(v[v != ""]).value_counts(sort=False).items()})


def format_rule(shapes: Counter[str], field: str) -> Proposal | None:
    filled = sum(shapes.values())
    if filled < FORMAT_MIN_ROWS:
        return None
    shape, n = min(shapes.items(), key=lambda x: (-x[1], x[0]))
    conf = n / filled
    if conf < MIN_CONFIDENCE or conf >= 1.0 or len(shape) >= SHAPE_CAP:
        return None
    body: dict[str, Json] = {"check_class": "regex_check", "field": field, "pattern": shape_regex(shape),
                             "dimension": "validity", "message": _message("format", field, None)}
    return Proposal("format", field, None, body, conf, filled, filled - n)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_house_rules.py -q`
Expected: PASS

---

### Task 5: Range miner

**Files:**
- Modify: `checks/house_rules.py`
- Test: `tests/test_house_rules.py` (append)

**Interfaces:**
- Produces:
  - `fit_ranges(head, group, num) -> dict[str, list[float]]`;
  - `RangeCounts(fitted)`, with `add(chunk)` and `.scope` / `.violations: dict[tuple[str, str], int]`;
  - `range_rule(group, num, ranges, scope, violations) -> Proposal | None`.

- [ ] **Step 1: Write the failing tests**

```python
def _weights(n: int = 4000) -> pd.DataFrame:
    i = np.arange(n)
    mtart = np.where(i % 2 == 0, "ROH", "FERT")
    w = np.where(mtart == "ROH", 1 + (i % 10), 100 + (i % 100)).astype(float)
    w[::211] = 99999.0
    return pd.DataFrame({"MARA.MTART": mtart, "MARA.BRGEW": w.astype(str)})


def test_fit_ranges_nearest_quantiles_padded():
    r = hr.fit_ranges(_weights(), "MARA.MTART", "MARA.BRGEW")
    lo, hi = r["ROH"]
    assert lo < 1.0 and 10.0 < hi < 99999.0
    assert r == hr.fit_ranges(_weights(), "MARA.MTART", "MARA.BRGEW")   # deterministic


def test_range_rule_counts_violations_over_chunks():
    df = _weights()
    fitted = {("MARA.MTART", "MARA.BRGEW"): hr.fit_ranges(df, "MARA.MTART", "MARA.BRGEW")}
    rc = hr.RangeCounts(fitted)
    for s in range(0, len(df), 900):
        rc.add(df.iloc[s:s + 900])
    key = ("MARA.MTART", "MARA.BRGEW")
    assert rc.violations[key] == 19                                       # every 211th row
    p = hr.range_rule(*key, fitted[key], rc.scope[key], rc.violations[key])
    assert p is not None and p.kind == "range" and p.body["check_class"] == "group_range_check"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_house_rules.py -q -k range`
Expected: FAIL with `AttributeError: ... has no attribute 'fit_ranges'`

- [ ] **Step 3: Implement**

Append (and add `import numpy as np`):

```python
def _numbers(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s.astype("string").str.strip(), errors="coerce")


def fit_ranges(head: pd.DataFrame, group: str, num: str) -> dict[str, list[float]]:
    """Per group with at least MIN_GROUP_ROWS numeric rows: nearest-rank p2.5/p97.5, padded by 10% of the span."""
    g, x = norm(head[group]), _numbers(head[num])
    ok = (g != "") & x.notna()
    out: dict[str, list[float]] = {}
    for key, vals in x[ok].groupby(g[ok], sort=True):
        if len(vals) < MIN_GROUP_ROWS:
            continue
        lo, hi = (float(v) for v in np.quantile(vals.to_numpy(), RANGE_Q, method="nearest"))
        span = hi - lo
        if span > 0:
            out[str(key)] = [lo - RANGE_PAD * span, hi + RANGE_PAD * span]
    return out


class RangeCounts:
    """In-scope rows and violations per (group, numeric) pair with fitted ranges, summed over chunks."""

    def __init__(self, fitted: dict[tuple[str, str], dict[str, list[float]]]) -> None:
        self.fitted = fitted
        self.scope: dict[tuple[str, str], int] = {k: 0 for k in fitted}
        self.violations: dict[tuple[str, str], int] = {k: 0 for k in fitted}

    def add(self, chunk: pd.DataFrame) -> None:
        for (g, n), ranges in self.fitted.items():
            if g not in chunk or n not in chunk:
                continue
            grp, x = norm(chunk[g]), _numbers(chunk[n])
            lo = grp.map({k: v[0] for k, v in ranges.items()})
            hi = grp.map({k: v[1] for k, v in ranges.items()})
            scope = lo.notna() & x.notna()
            self.scope[(g, n)] += int(scope.sum())
            self.violations[(g, n)] += int((scope & ((x < lo) | (x > hi))).sum())


def range_rule(group: str, num: str, ranges: dict[str, list[float]], scope: int, violations: int) -> Proposal | None:
    if not ranges or scope == 0:
        return None
    conf = (scope - violations) / scope
    if conf < MIN_CONFIDENCE or conf >= 1.0:
        return None
    body: dict[str, Json] = {"check_class": "group_range_check", "group_by": group, "field": num,
                             "ranges": {k: [round(v[0], 6), round(v[1], 6)] for k, v in sorted(ranges.items())},
                             "grain": num.split(".", 1)[0], "dimension": "validity",
                             "message": _message("range", num, group)}
    return Proposal("range", num, group, body, conf, scope, violations)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_house_rules.py -q`
Expected: PASS

---

### Task 6: `mine_frame`: candidates, single pass, caps, sample keys

**Files:**
- Modify: `checks/house_rules.py`
- Test: `tests/test_house_rules.py` (append)

**Interfaces:**
- Produces:
  - `candidates(head, dictionary) -> tuple[list[str], list[str], list[str]]`, giving codes, numerics and texts;
  - `mine_frame(chunks: Iterable[pd.DataFrame], dictionary: Dictionary | None, key_cols: list[str]) -> list[Proposal]`.
- Consumes: `_is_code`, `is_sensitive` and `MAX_PROFILE_ROWS` from `checks.profiling`, `record_keys` from `checks.base`, and `REGISTRY` from `checks.runner` (imported inside the function to avoid an import cycle).

- [ ] **Step 1: Write the failing tests**

```python
from sap.ddic import get_dictionary


def _materials(n: int = 5000) -> pd.DataFrame:
    i = np.arange(n)
    mtart = np.where(i % 2 == 0, "ROH", "FERT")
    beskz = np.where(mtart == "ROH", "F", "E").astype(object)
    beskz[::97] = "X"                                  # ~1% break MTART → BESKZ
    matkl = np.array([f"MG-{v % 50:04d}" for v in i], dtype=object)
    matkl[::50] = "misc"
    w = np.where(mtart == "ROH", 1 + (i % 10), 100 + (i % 100)).astype(float)
    w[::211] = 99999.0
    return pd.DataFrame({"MARA.MATNR": [f"{v:018d}" for v in i], "MARA.MTART": mtart, "MARC.BESKZ": beskz,
                         "MARA.MATKL": matkl, "MARA.BRGEW": w.astype(str)})


def test_mine_frame_finds_every_kind_with_sample_keys():
    df = _materials()
    props = hr.mine_frame([df], get_dictionary("s4hana"), ["MARA.MATNR"])
    kinds = {(p.kind, p.determinant, p.field) for p in props}
    assert ("dependency", "MARA.MTART", "MARC.BESKZ") in kinds
    assert ("range", "MARA.MTART", "MARA.BRGEW") in kinds
    dep = next(p for p in props if p.field == "MARC.BESKZ" and p.determinant == "MARA.MTART")
    assert dep.body["allowed"] == {"FERT": ["E"], "ROH": ["F"]}
    assert dep.sample_keys and all(k.startswith("MATNR=") for k in dep.sample_keys)


def test_mine_frame_is_chunk_invariant(monkeypatch):
    monkeypatch.setattr(hr, "FIT_ROWS", 2000)
    df = _materials()
    a = hr.mine_frame([df], get_dictionary("s4hana"), ["MARA.MATNR"])
    b = hr.mine_frame((df.iloc[s:s + 700] for s in range(0, len(df), 700)), get_dictionary("s4hana"), ["MARA.MATNR"])
    assert a == b


def test_mine_frame_skips_sensitive_and_identifier_columns():
    df = _materials()
    df["LFA1.STCD1"] = np.where(np.arange(len(df)) % 2 == 0, "A", "B")   # tax number: sensitive
    props = hr.mine_frame([df], get_dictionary("s4hana"), ["MARA.MATNR"])
    assert all("STCD1" not in (p.determinant or "") + p.field for p in props)
    assert all(p.determinant != "MARA.MATNR" for p in props)
```

`a == b` relies on the frozen dataclass equality; `sample_keys` is a tuple. If `is_sensitive` does not flag `STCD1` (check `checks/profiling.py:_sensitive_name`), switch the fixture to a field that it does flag.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_house_rules.py -q -k mine_frame`
Expected: FAIL with `AttributeError: ... has no attribute 'mine_frame'`

- [ ] **Step 3: Implement**

Append (and add `from itertools import chain`, `from typing import Iterable`, `from checks.base import record_keys`, `from checks.profiling import MAX_PROFILE_ROWS, _is_code, is_sensitive` and `from sap.ddic import Dictionary`):

```python
FIT_ROWS = MAX_PROFILE_ROWS
NUMERIC_TYPES = {"CURR", "QUAN", "DEC", "FLTP", "INT1", "INT2", "INT4", "INT8"}


def _ddic(dictionary: Dictionary | None, col: str) -> tuple[str | None, bool]:
    """(DDIC type, sensitive) of a TABLE.FIELD column."""
    table, _, name = col.partition(".")
    f = dictionary.field(table, name) if dictionary is not None else None
    return (f.type if f else None), is_sensitive(table, name, f.data_element if f else None)


def candidates(head: pd.DataFrame, dictionary: Dictionary | None) -> tuple[list[str], list[str], list[str]]:
    """(code, numeric, text) columns, each sorted by name and capped."""
    codes, nums, texts = [], [], []
    for col in sorted(c for c in head.columns if "." in c):
        typ, sensitive = _ddic(dictionary, col)
        if sensitive:
            continue
        if typ in NUMERIC_TYPES:
            nums.append(col)
            continue
        if typ == "CHAR":
            texts.append(col)
        if _is_code(dictionary, col):
            s = norm(head[col])
            filled = s[s != ""]
            k = filled.nunique()
            if CARD_MIN <= k <= CARD_MAX and k <= MAX_DISTINCT_SHARE * len(filled):
                codes.append(col)
    return codes[:MAX_CANDIDATES], nums[:MAX_CANDIDATES], texts


def _rank(props: list[Proposal]) -> list[Proposal]:
    out: list[Proposal] = []
    for kind in ("dependency", "value_set", "format", "range"):
        mine = sorted((p for p in props if p.kind == kind),
                      key=lambda p: (-p.support_rows, -p.confidence, p.determinant or "", p.field))
        out += mine[:MAX_PER_KIND]
    return out


def _with_samples(p: Proposal, head: pd.DataFrame, key_cols: list[str]) -> Proposal:
    from dataclasses import replace

    from checks.runner import REGISTRY

    ev = REGISTRY[str(p.body["check_class"])]({**p.body, "id": "LR-PREVIEW"}).evaluate(head)
    keys = record_keys(head, [k for k in key_cols if k in head])[ev.failing.to_numpy(dtype=bool)]
    return replace(p, sample_keys=tuple(keys.head(SAMPLE_KEYS).tolist()))


def mine_frame(chunks: Iterable[pd.DataFrame], dictionary: Dictionary | None, key_cols: list[str]) -> list[Proposal]:
    """Every learned rule of one frame (a flat upload, or one bundle table with its parent's codes).
    Candidates and ranges come from the first FIT_ROWS rows; counts from every row."""
    it = iter(chunks)
    buffered: list[pd.DataFrame] = []
    seen = 0
    for chunk in it:
        buffered.append(chunk)
        seen += len(chunk)
        if seen >= FIT_ROWS:
            break
    if not buffered:
        return []
    head = pd.concat(buffered, ignore_index=True).iloc[:FIT_ROWS]
    codes, nums, texts = candidates(head, dictionary)
    pairs = PairCounts([(a, b) for a in codes for b in codes if a != b])
    shapes = ShapeCounts(texts)
    fitted = {(g, n): r for g in codes for n in nums if (r := fit_ranges(head, g, n))}
    ranges = RangeCounts(fitted)
    for chunk in chain(buffered, it):
        pairs.add(chunk)
        shapes.add(chunk)
        ranges.add(chunk)
    props = [p for (a, b), c in sorted(pairs.counts.items()) if (p := value_set_rule(c, pairs.rows, a, b))]
    props += [p for col, c in sorted(shapes.counts.items()) if (p := format_rule(c, col))]
    props += [p for (g, n), r in sorted(fitted.items())
              if (p := range_rule(g, n, r, ranges.scope[(g, n)], ranges.violations[(g, n)]))]
    return [_with_samples(p, head, key_cols) for p in _rank(props)]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_house_rules.py -q`
Expected: PASS. If the dictionary types `MARA.MATKL` as non-CHAR or `MARA.BRGEW` as non-QUAN, adjust the fixture columns to fields the s4hana dictionary types as expected (`python -c "from sap.ddic import get_dictionary as g; d=g('s4hana'); print(d.field('MARA','BRGEW'))"`). Never loosen the algorithm to fit a fixture.

---

### Task 7: Deterministic relationship pair cap

**Files:**
- Modify: `workers/tasks/mining/relationship.py` (lines around `random.sample`)
- Test: `tests/test_relationship_determinism.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_relationship_determinism.py
import random

import pandas as pd

from workers.tasks.mining import relationship


def test_pair_cap_does_not_depend_on_random_state():
    df = pd.DataFrame({f"T.ID{i}": [str(j % (i + 2)) for j in range(60)] for i in range(12)}
                      | {f"T.C{i}": [str(j % 3) for j in range(60)] for i in range(25)})
    random.seed(1)
    a = relationship._detect_relationships(df, "m", max_pairs=7)
    random.seed(2)
    b = relationship._detect_relationships(df, "m", max_pairs=7)
    assert a == b
```

If `_is_key_field` does not treat `T.ID*` as key columns, rename the fixture columns to whatever `_is_key_field` / `_is_foreign_key` accept (read both functions first), so that more than 7 pairs exist.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_relationship_determinism.py -q`
Expected: FAIL (`assert a == b`)

- [ ] **Step 3: Implement**

Replace:

```python
    if len(pairs_to_check) > max_pairs:
        # Sample pairs
        import random
        pairs_to_check = random.sample(pairs_to_check, max_pairs)
```

with:

```python
    if len(pairs_to_check) > max_pairs:
        pairs_to_check = sorted(pairs_to_check)[:max_pairs]  # deterministic: same data, same pairs
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/test_relationship_determinism.py -q`
Expected: PASS

---

### Task 8: Migration 067 `learned_rule_proposals`

**Files:**
- Create: `db/migrations/versions/067_learned_rule_proposals.py`
- Modify: `db/schema.py` (add the `LearnedRuleProposal` model next to `FieldDependency`)
- Test: `tests/test_learned_rules_pg.py`

- [ ] **Step 1: Write the failing test** (real Postgres; skipped without `MERIDIAN_TEST_DB_URL`)

Copy the `app_engine` fixture verbatim from `tests/test_field_profiles_pg.py`, using role `meridian_learned_app`. That fixture upgrades to head, creates a NOBYPASSRLS role and yields an engine connected as that role, and has a tenant helper; reuse its tenant-insert helper as the file does.

```python
# tests/test_learned_rules_pg.py
"""Learned rule proposals (migration 067): RLS, one row per fingerprint, approval to an LR- id."""
from __future__ import annotations

import json
import os
import uuid

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

# … app_engine + _tenant fixtures copied from tests/test_field_profiles_pg.py (role meridian_learned_app) …

_INSERT = text("""
    INSERT INTO learned_rule_proposals (tenant_id, module, kind, table_name, determinant, field, fingerprint,
                                        body, confidence, support_rows, violations, sample_keys)
    VALUES (:tid, 'material_master', 'dependency', 'MARC', 'MARA.MTART', 'MARC.BESKZ', 'fp1',
            CAST(:body AS jsonb), 0.99, 1000, 10, '[]')
""")


def test_rls_isolates_tenants_and_fingerprint_is_unique(app_engine, _tenant):
    t1, t2 = _tenant(), _tenant()
    body = json.dumps({"check_class": "dependency_check"})
    with app_engine.begin() as c:
        c.execute(text("SET app.tenant_id = :t"), {"t": t1})
        c.execute(_INSERT, {"tid": t1, "body": body})
    with app_engine.begin() as c:
        c.execute(text("SET app.tenant_id = :t"), {"t": t2})
        assert c.execute(text("SELECT count(*) FROM learned_rule_proposals")).scalar() == 0
    with pytest.raises(Exception, match="uq_learned_rule_proposals_fp"):
        with app_engine.begin() as c:
            c.execute(text("SET app.tenant_id = :t"), {"t": t1})
            c.execute(_INSERT, {"tid": t1, "body": body})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://… pytest tests/test_learned_rules_pg.py -q`
Expected: FAIL with `relation "learned_rule_proposals" does not exist`

- [ ] **Step 3: Implement**

```python
# db/migrations/versions/067_learned_rule_proposals.py
"""learned rule proposals

Revision ID: 067
Revises: 066
Create Date: 2026-10-10

House rules the tenant's own data follows (checks/house_rules.py), awaiting a
person's decision. One row per (tenant, module, fingerprint) for ever: re-mining
refreshes a pending row's statistics; approved and rejected rows are never
re-proposed. Approval writes an active rule_versions row under a new LR- id.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "067"
down_revision: Union[str, None] = "066"
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
        "learned_rule_proposals",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("analysis_versions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("table_name", sa.Text(), nullable=False),
        sa.Column("determinant", sa.Text(), nullable=True),
        sa.Column("field", sa.Text(), nullable=False),
        sa.Column("fingerprint", sa.Text(), nullable=False),
        sa.Column("body", postgresql.JSONB(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("support_rows", sa.BigInteger(), nullable=False),
        sa.Column("violations", sa.BigInteger(), nullable=False),
        sa.Column("sample_keys", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("rule_id", sa.Text(), nullable=True),
        sa.Column("decided_by", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "module", "fingerprint", name="uq_learned_rule_proposals_fp"),
        sa.CheckConstraint("kind IN ('dependency', 'value_set', 'format', 'range')", name="ck_learned_rule_kind"),
        sa.CheckConstraint("status IN ('pending', 'approved', 'rejected')", name="ck_learned_rule_status"),
    )
    op.create_index("ix_learned_rule_proposals_status", "learned_rule_proposals", ["tenant_id", "status"])
    _rls("learned_rule_proposals")


def downgrade() -> None:
    op.drop_table("learned_rule_proposals")
```

Add the matching `LearnedRuleProposal` model to `db/schema.py`, mirroring the `FieldDependency` style: same columns, `__table_args__` with the unique constraint name.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `MERIDIAN_TEST_DB_URL=postgresql://… pytest tests/test_learned_rules_pg.py -q && alembic heads`
Expected: PASS, and `alembic heads` shows a single head, `067`.

---

### Task 9: `run_house_rules` Celery task and orchestrator wiring

**Files:**
- Create: `workers/tasks/mining/house_rules.py`
- Modify: `workers/tasks/mining/orchestrator.py` (import, `include` default and docstring, dispatch)
- Modify: `workers/tasks/rule_proposal_task.py` (`_notify_reviewers` kwargs)
- Test: `tests/test_house_rules_task.py`

**Interfaces:**
- Produces: `run_house_rules(version_id, tenant_id, module, parquet_path) -> dict`, `frames_for(path, tables, dictionary) -> Iterator[tuple[str, Iterator[pd.DataFrame], list[str]]]` and `upsert_rows(proposals, module, version_id, tenant_id) -> list[dict]`.
- Consumes: `iter_parquet_chunks`, `bundle_object`, `mine_frame`, `checks.frames._graph`, `checks.frames.tables_of`, `checks.runner.get_required_columns`, `api.services.source_design.dictionary_for` and `_notify_reviewers`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_house_rules_task.py
import pandas as pd

from checks.house_rules import Proposal
from sap.ddic import get_dictionary
from workers.tasks.mining import house_rules as task


def test_bundle_child_chunks_carry_parent_codes(monkeypatch):
    mara = pd.DataFrame({"MATNR": ["1", "2"], "MTART": ["ROH", "FERT"], "MAKTX": ["a", "b"]})
    marc = pd.DataFrame({"MATNR": ["1", "1", "2"], "WERKS": ["1000", "2000", "1000"], "BESKZ": ["F", "F", "E"]})
    objects = {"b/MARA.parquet": mara, "b/MARC.parquet": marc}

    def fake_chunks(path, keep=None, chunk_rows=0):
        df = objects[path]
        yield df[[c for c in df.columns if keep is None or keep(c)]]

    monkeypatch.setattr(task, "iter_parquet_chunks", fake_chunks)
    frames = {name: (list(chunks), keys) for name, chunks, keys in
              task.frames_for("b/", ["MARA", "MARC"], get_dictionary("s4hana"))}
    marc_chunk = frames["MARC"][0][0]
    assert marc_chunk["MARA.MTART"].astype(str).tolist() == ["ROH", "ROH", "FERT"]
    assert "MARA.MAKTX" not in marc_chunk                   # free text never joined
    assert frames["MARC"][1] == ["MARC.MATNR", "MARC.WERKS"]


def test_upsert_rows_are_json_ready():
    p = Proposal("dependency", "MARC.BESKZ", "MARA.MTART", {"check_class": "dependency_check"}, 0.99, 1000, 10,
                 ("MATNR=1",))
    (row,) = task.upsert_rows([p], "material_master", "v1", "t1")
    assert row["fingerprint"] == p.fingerprint and row["table_name"] == "MARC"
    assert row["sample_keys"] == '["MATNR=1"]' and row["body"] == '{"check_class": "dependency_check"}'
```

If `dictionary.keys("MARC")` includes `MANDT`, the expected key list drops it, as `frames_for` filters `MANDT`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_house_rules_task.py -q`
Expected: FAIL with `ImportError: cannot import name 'house_rules' from 'workers.tasks.mining'`

- [ ] **Step 3: Implement**

```python
# workers/tasks/mining/house_rules.py
"""Mine learned house rules for one module of an analysed version and store them as
pending proposals (learned_rule_proposals). Idempotent: one row per fingerprint;
re-mining refreshes pending rows and never touches approved or rejected ones.
Reads the stored extract only — never SAP."""
from __future__ import annotations

import json
import logging
from typing import Iterator

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from checks.house_rules import Proposal, mine_frame
from sap.ddic import Dictionary
from workers.celery_app import celery_app
from workers.dataset import bundle_object, iter_parquet_chunks
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.mining.house_rules")
PARENT_CODES = 10


def _keys(dictionary: Dictionary, table: str) -> list[str]:
    return [f"{table}.{k}" for k in dictionary.keys(table) if k != "MANDT"]


def _qualified(df: pd.DataFrame, table: str) -> pd.DataFrame:
    return df.rename(columns=lambda c: c if "." in c else f"{table}.{c}")


def _parent_lookup(path: str, parent: str, on: tuple[tuple[str, str], ...],
                   dictionary: Dictionary) -> pd.DataFrame:
    """Parent join keys + up to PARENT_CODES code columns (category dtype), one row per parent key."""
    from checks.house_rules import candidates

    keys = {p for _, p in on}
    head = next(iter_parquet_chunks(bundle_object(path, parent)), None)
    if head is None:
        return pd.DataFrame()
    codes = [c for c in candidates(_qualified(head, parent), dictionary)[0]
             if c.split(".", 1)[1] not in keys][:PARENT_CODES]
    want = keys | {c.split(".", 1)[1] for c in codes}
    # ponytail: holds parent keys + ≤10 category columns in memory; partition by key hash if parents pass ~20M rows
    parts = [_qualified(c, parent) for c in iter_parquet_chunks(bundle_object(path, parent), keep=lambda c: c in want)]
    df = pd.concat(parts, ignore_index=True).drop_duplicates([f"{parent}.{k}" for k in sorted(keys)])
    return df.astype({c: "category" for c in codes})


def frames_for(path: str, tables: list[str], dictionary: Dictionary
               ) -> Iterator[tuple[str, Iterator[pd.DataFrame], list[str]]]:
    """(frame name, chunk iterator, key columns). A flat upload is one frame holding every module
    table; a bundle is one frame per table, its chunks left-joined to the parent's code columns."""
    from checks.frames import _graph

    if not path.endswith("/"):
        wanted = set(tables)
        yield ("flat", iter_parquet_chunks(path, keep=lambda c: c.split(".", 1)[0] in wanted),
               [k for t in tables for k in _keys(dictionary, t)])
        return
    edges, _ = _graph()
    for table in tables:
        edge = next((e for e in edges if e.child == table and e.parent in tables), None)
        lookup = _parent_lookup(path, edge.parent, edge.on, dictionary) if edge else None

        def chunks(table: str = table, edge=edge, lookup: pd.DataFrame | None = lookup) -> Iterator[pd.DataFrame]:
            for c in iter_parquet_chunks(bundle_object(path, table)):
                c = _qualified(c, table)
                if lookup is not None and not lookup.empty:
                    c = c.merge(lookup, how="left", left_on=[f"{table}.{cf}" for cf, _ in edge.on],
                                right_on=[f"{edge.parent}.{pf}" for _, pf in edge.on])
                    c = c.drop(columns=[f"{edge.parent}.{pf}" for _, pf in edge.on])
                yield c

        yield table, chunks(), _keys(dictionary, table)


def upsert_rows(props: list[Proposal], module: str, version_id: str, tenant_id: str) -> list[dict]:
    return [{"tid": tenant_id, "vid": version_id, "m": module, "kind": p.kind, "tbl": p.table,
             "det": p.determinant, "field": p.field, "fp": p.fingerprint, "body": json.dumps(p.body, sort_keys=True),
             "conf": p.confidence, "rows": p.support_rows, "viol": p.violations,
             "keys": json.dumps(list(p.sample_keys))} for p in props]


_UPSERT = text("""
    INSERT INTO learned_rule_proposals (tenant_id, version_id, module, kind, table_name, determinant, field,
                                        fingerprint, body, confidence, support_rows, violations, sample_keys)
    VALUES (:tid, :vid, :m, :kind, :tbl, :det, :field, :fp, CAST(:body AS jsonb), :conf, :rows, :viol,
            CAST(:keys AS jsonb))
    ON CONFLICT ON CONSTRAINT uq_learned_rule_proposals_fp DO UPDATE
       SET version_id = EXCLUDED.version_id, body = EXCLUDED.body, confidence = EXCLUDED.confidence,
           support_rows = EXCLUDED.support_rows, violations = EXCLUDED.violations,
           sample_keys = EXCLUDED.sample_keys, updated_at = now()
     WHERE learned_rule_proposals.status = 'pending'
    RETURNING (xmax = 0) AS inserted
""")


@celery_app.task(bind=True, name="workers.tasks.mining.house_rules.run_house_rules",
                 soft_time_limit=3300, time_limit=3600)
def run_house_rules(self, version_id: str, tenant_id: str, module: str, parquet_path: str) -> dict:
    from api.services.source_design import dictionary_for
    from checks.frames import tables_of
    from checks.runner import get_required_columns
    from workers.tasks.rule_proposal_task import _notify_reviewers

    engine = get_sync_engine()
    with Session(engine) as s:
        s.execute(text("SET app.tenant_id = :tid"), {"tid": tenant_id})
        meta = s.execute(text("SELECT metadata FROM analysis_versions WHERE id = :v"),
                         {"v": version_id}).scalar() or {}
        dictionary = dictionary_for(s, meta.get("system_id"))
    try:
        tables = sorted(tables_of(get_required_columns(module)))
    except FileNotFoundError:
        return {"module": module, "proposals": 0, "reason": "no_rules"}
    props: list[Proposal] = []
    for name, chunks, keys in frames_for(parquet_path, tables, dictionary):
        found = mine_frame(chunks, dictionary, keys)
        logger.info("house rules %s/%s: %d proposals", module, name, len(found))
        props += found
    with Session(engine) as s:
        s.execute(text("SET app.tenant_id = :tid"), {"tid": tenant_id})
        new = sum(1 for row in upsert_rows(props, module, version_id, tenant_id)
                  if s.execute(_UPSERT, row).scalar())
        if new:
            _notify_reviewers(s, tenant_id, module, new, roles=("admin", "manager", "approver"),
                              title=f"{new} new learned house rules",
                              body=f"Module: {module}. Your data follows these rules for at least 95% of records. "
                                   "Approve or reject them under Rules › Learned.",
                              link="/rules/learned")
        s.commit()
    return {"module": module, "proposals": len(props), "new": new}
```

`RETURNING (xmax = 0)` is true for an insert and false for an update. A row skipped by the `WHERE status = 'pending'` guard returns no row (`scalar()` is `None`), which counts as not new.

In `workers/tasks/rule_proposal_task.py`, change the signature and use the kwargs, keeping today's values as defaults so existing callers are unchanged:

```python
def _notify_reviewers(session: Session, tenant_id: str, domain: str, count: int, *,
                      roles: tuple[str, ...] = ("admin", "steward", "ai_reviewer"),
                      title: str | None = None, body: str | None = None,
                      link: str = "/settings?tab=ai-rules") -> None:
```

Replace the SQL with `"... AND role = ANY(:roles) AND is_active = true"`, passing `{"tid": tenant_id, "roles": list(roles)}`. Pass `title=title or f"{count} new AI-proposed match rules"`, `body=body or f"Domain: {domain}. …"` (today's string) and `link=link`.

In `workers/tasks/mining/orchestrator.py`:
- import `from workers.tasks.mining.house_rules import run_house_rules`;
- change the default to `include or ["dedup", "anomaly", "relationship", "house_rules"]`;
- add `"house_rules"` to the docstring set;
- dispatch with:

```python
        if "house_rules" in include_set:
            tasks.append(run_house_rules.s(version_id, tenant_id, module_id, parquet_path))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_house_rules_task.py tests/test_house_rules.py -q && pytest tests -q -k "proposal or mining"`
Expected: PASS

---

### Task 10: Learned-rules API: list, mine, approve to an `LR-` id, reject

**Files:**
- Create: `api/routes/learned_rules.py`
- Modify: `api/main.py` (`from api.routes.learned_rules import router as learned_rules_router`, then `app.include_router(learned_rules_router)` next to `rules_router`)
- Test: `tests/test_learned_rules_pg.py` (append)

**Interfaces:**
- `GET /api/v1/learned-rules?status=pending&module=&kind=` (view) returns `{"items": [...]}`.
- `POST /api/v1/learned-rules/mine {version_id}` (manage_rules) returns 202 `{"queued": true}`.
- `POST /api/v1/learned-rules/{id}/approve {severity, note}` (approve) returns `{"rule_id": "LR-000001", ...}`.
- `POST /api/v1/learned-rules/{id}/reject {note}` (manage_rules) returns `{"status": "rejected"}`.
- Approval inserts a `rule_versions` row: version 1, state `active`, `created_by='house-rule-miner'`, `approved_by` = the approver. The maker is the miner and the checker is a person with `approve`. The id is `LR-` plus a six-digit number, max + 1 over `rule_versions` and `learned_rule_proposals`, taken under a per-tenant advisory lock. Nothing is ever deleted, so ids never repeat.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_learned_rules_pg.py`; uses `next_rule_id` and `approve_sync`, the sync core the route calls through `db.run_sync`, so it is testable without HTTP)

```python
def test_approve_creates_active_versions_with_append_only_ids(app_engine, _tenant):
    from sqlalchemy.orm import Session

    from api.routes.learned_rules import approve_sync
    from checks.lifecycle import load_active_versions

    t = _tenant()
    body = json.dumps({"check_class": "dependency_check", "determinant": "MARA.MTART", "field": "MARC.BESKZ",
                       "allowed": {"ROH": ["F"]}, "grain": "MARC", "dimension": "consistency",
                       "message": "MARC.BESKZ does not follow MARA.MTART"})
    with Session(app_engine) as s:
        s.execute(text("SET app.tenant_id = :t"), {"t": t})
        ids = []
        for fp in ("fp-a", "fp-b"):
            pid = s.execute(text(
                "INSERT INTO learned_rule_proposals (tenant_id, module, kind, table_name, determinant, field, "
                "fingerprint, body, confidence, support_rows, violations) VALUES (:t, 'material_master', "
                "'dependency', 'MARC', 'MARA.MTART', 'MARC.BESKZ', :fp, CAST(:b AS jsonb), 0.99, 1000, 10) "
                "RETURNING id"), {"t": t, "fp": fp, "b": body}).scalar()
            ids.append(approve_sync(s, t, str(pid), "high", None, "checker@example.test")["rule_id"])
        s.commit()
        assert ids == ["LR-000001", "LR-000002"]
        active = load_active_versions(s)
        assert active["LR-000001"]["module"] == "material_master" and active["LR-000001"]["severity"] == "high"
        with pytest.raises(LookupError):
            approve_sync(s, t, str(pid), "high", None, "checker@example.test")   # already decided
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://… pytest tests/test_learned_rules_pg.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'api.routes.learned_rules'`

- [ ] **Step 3: Implement**

```python
# api/routes/learned_rules.py
"""Learned house rules (checks/house_rules.py): review queue. The miner is the maker;
a person with ``approve`` is the checker. Approval writes an active rule_versions row
under a new append-only LR- id, run from the next analysis (checks/lifecycle.authored_rules)."""
from __future__ import annotations

import json
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import current_user_label, require_permission
from checks import lifecycle

router = APIRouter(prefix="/api/v1", tags=["learned-rules"])
MINER = "house-rule-miner"


class Approve(BaseModel):
    severity: Literal["critical", "high", "medium", "low"] = "medium"
    note: Optional[str] = Field(None, max_length=2000)


class Reject(BaseModel):
    note: Optional[str] = Field(None, max_length=2000)


class Mine(BaseModel):
    version_id: uuid.UUID


def next_rule_id(s: Session, tenant_id: str) -> str:
    """Next LR- id for the tenant. Serialised by an advisory lock; ids are never reused."""
    s.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"{tenant_id}:learned-rule-id"})
    n = s.execute(text("""
        SELECT COALESCE(max(substring(rule_id FROM 4)::int), 0) FROM (
            SELECT rule_id FROM rule_versions WHERE rule_id ~ '^LR-[0-9]{6}$'
            UNION ALL SELECT rule_id FROM learned_rule_proposals WHERE rule_id ~ '^LR-[0-9]{6}$') ids
    """)).scalar()
    return f"LR-{int(n) + 1:06d}"


def approve_sync(s: Session, tenant_id: str, pid: str, severity: str, note: Optional[str], me: str) -> dict:
    s.execute(text("SET app.tenant_id = :t"), {"t": tenant_id})
    p = s.execute(text("SELECT module, body, status FROM learned_rule_proposals WHERE id = :id FOR UPDATE"),
                  {"id": pid}).one_or_none()
    if p is None or p.status != "pending":
        raise LookupError("not pending")
    rid = next_rule_id(s, tenant_id)
    body = {**p.body, "module": p.module, "severity": severity}
    if err := lifecycle.validate_body(rid, body):
        raise ValueError(err)
    s.execute(text("""
        INSERT INTO rule_versions (tenant_id, rule_id, version, body, state, note, created_by, approved_by, approved_at)
        VALUES (:t, :r, 1, CAST(:b AS jsonb), 'active', :n, :maker, :me, now())
    """), {"t": tenant_id, "r": rid, "b": json.dumps(body), "n": note or f"Learned from data (proposal {pid})",
           "maker": MINER, "me": me})
    s.execute(text("UPDATE learned_rule_proposals SET status = 'approved', rule_id = :r, decided_by = :me, "
                   "decided_at = now(), updated_at = now() WHERE id = :id"), {"r": rid, "me": me, "id": pid})
    return {"id": pid, "status": "approved", "rule_id": rid}


@router.get("/learned-rules", dependencies=[Depends(require_permission("view"))])
async def list_learned(status: Literal["pending", "approved", "rejected"] = Query("pending"),
                       module: Optional[str] = None, kind: Optional[str] = None,
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await db.execute(text("SET app.tenant_id = :t"), {"t": str(tenant.id)})
    rows = (await db.execute(text("""
        SELECT id, version_id, module, kind, table_name, determinant, field, body, confidence, support_rows,
               violations, sample_keys, status, rule_id, decided_by, decided_at, updated_at
          FROM learned_rule_proposals
         WHERE status = :s AND (CAST(:m AS text) IS NULL OR module = :m) AND (CAST(:k AS text) IS NULL OR kind = :k)
         ORDER BY support_rows DESC, confidence DESC, field LIMIT 1000
    """), {"s": status, "m": module, "k": kind})).mappings().all()
    return {"items": [{**r, "id": str(r["id"]), "version_id": r["version_id"] and str(r["version_id"])} for r in rows]}


@router.post("/learned-rules/mine", status_code=202, dependencies=[Depends(require_permission("manage_rules"))])
async def mine(body: Mine, tenant: Tenant = Depends(get_tenant)):
    from workers.tasks.mining.orchestrator import run_mining_for_version
    run_mining_for_version.delay(str(tenant.id), str(body.version_id), include=["house_rules"])
    return {"queued": True}


@router.post("/learned-rules/{pid}/approve", dependencies=[Depends(require_permission("approve"))])
async def approve(pid: uuid.UUID, body: Approve, db: AsyncSession = Depends(get_db),
                  tenant: Tenant = Depends(get_tenant)):
    me = current_user_label()
    try:
        out = await db.run_sync(lambda s: approve_sync(s, str(tenant.id), str(pid), body.severity, body.note, me))
    except LookupError:
        raise HTTPException(status_code=409, detail="This proposal was already decided or does not exist.")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    await db.commit()
    return out


@router.post("/learned-rules/{pid}/reject", dependencies=[Depends(require_permission("manage_rules"))])
async def reject(pid: uuid.UUID, body: Reject, db: AsyncSession = Depends(get_db),
                 tenant: Tenant = Depends(get_tenant)):
    await db.execute(text("SET app.tenant_id = :t"), {"t": str(tenant.id)})
    n = (await db.execute(text("""
        UPDATE learned_rule_proposals SET status = 'rejected', decided_by = :me, decided_at = now(), updated_at = now()
         WHERE id = :id AND status = 'pending'
    """), {"id": pid, "me": current_user_label()})).rowcount
    if not n:
        raise HTTPException(status_code=409, detail="This proposal was already decided or does not exist.")
    await db.commit()
    return {"id": str(pid), "status": "rejected"}
```

Check `run_mining_for_version`'s Celery signature: `run_mining_for_version(tenant_id, version_id, modules=None, include=None)`. If it is not a Celery task, call it through the task name it is registered under.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `MERIDIAN_TEST_DB_URL=postgresql://… pytest tests/test_learned_rules_pg.py -q && pytest tests/test_rbac_matrix.py -q`
Expected: PASS. Add the new routes to the RBAC matrix if that test enumerates routes.

---

### Task 11: Rules › Learned page

**Files:**
- Create: `frontend/lib/api/learnedRules.ts`
- Modify: `frontend/lib/query-keys.ts` (add `learnedRules: (f: Record<string, unknown>) => ["learned-rules", normalizeFilters(f)] as const`)
- Create: `frontend/app/(app)/rules/learned/page.tsx`
- Create: `frontend/app/(app)/rules/learned/__tests__/page.test.tsx`
- Modify: `frontend/app/(app)/rules/page.tsx` (add `<Link href="/rules/learned">Learned from your data</Link>` next to the existing header actions)

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/app/(app)/rules/learned/__tests__/page.test.tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/learnedRules";
import type { LearnedRule } from "@/lib/api/learnedRules";
import LearnedRulesPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const RULE: LearnedRule = {
  id: "p1", version_id: "v1", module: "material_master", kind: "dependency", table_name: "MARC",
  determinant: "MARA.MTART", field: "MARC.BESKZ", confidence: 0.991, support_rows: 120000, violations: 1080,
  sample_keys: ["MATNR=000000000000000042"], status: "pending", rule_id: null, decided_by: null, decided_at: null,
  updated_at: "2026-10-10T00:00:00Z",
  body: { check_class: "dependency_check", allowed: { ROH: ["F"] }, message: "MARC.BESKZ does not follow MARA.MTART" },
};

describe("learned rules page", () => {
  it("lists a proposal and approves it", async () => {
    vi.spyOn(api, "getLearnedRules").mockResolvedValue({ items: [RULE] });
    const approve = vi.spyOn(api, "approveLearnedRule").mockResolvedValue({ id: "p1", status: "approved", rule_id: "LR-000001" });
    renderWithQuery(<LearnedRulesPage />);
    expect(await screen.findByText("MARC.BESKZ")).toBeInTheDocument();
    expect(screen.getByText("99.1%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith("p1", "medium"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run "app/(app)/rules/learned"`
Expected: FAIL (`Cannot find module '../page'`)

- [ ] **Step 3: Implement**

```ts
// frontend/lib/api/learnedRules.ts
import apiClient from "./client";

export type LearnedKind = "dependency" | "value_set" | "format" | "range";
export type LearnedStatus = "pending" | "approved" | "rejected";
export type Severity = "critical" | "high" | "medium" | "low";
type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export interface LearnedRule {
  id: string; version_id: string | null; module: string; kind: LearnedKind; table_name: string;
  determinant: string | null; field: string; body: { [k: string]: JsonValue }; confidence: number;
  support_rows: number; violations: number; sample_keys: string[]; status: LearnedStatus;
  rule_id: string | null; decided_by: string | null; decided_at: string | null; updated_at: string;
}

export const KIND_LABEL: Record<LearnedKind, string> = {
  dependency: "Decided by another field", value_set: "Limited value set", format: "Format", range: "Numeric range",
};

export async function getLearnedRules(status: LearnedStatus, kind?: LearnedKind): Promise<{ items: LearnedRule[] }> {
  const { data } = await apiClient.get<{ items: LearnedRule[] }>("/api/v1/learned-rules", { params: { status, kind } });
  return data;
}

export async function approveLearnedRule(id: string, severity: Severity): Promise<{ id: string; status: "approved"; rule_id: string }> {
  const { data } = await apiClient.post<{ id: string; status: "approved"; rule_id: string }>(`/api/v1/learned-rules/${id}/approve`, { severity });
  return data;
}

export async function rejectLearnedRule(id: string): Promise<{ id: string; status: "rejected" }> {
  const { data } = await apiClient.post<{ id: string; status: "rejected" }>(`/api/v1/learned-rules/${id}/reject`, {});
  return data;
}
```

```tsx
// frontend/app/(app)/rules/learned/page.tsx
"use client";

/** Rules › Learned: house rules the tenant's own data follows for ≥ 95% of records
 * (checks/house_rules.py). The miner proposes; a person with `approve` turns a
 * proposal into an active rule with a new LR- id; `manage_rules` can reject. */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, ExplorerPage, Field, Mono, Pill, Select } from "@/design";
import { useRole } from "@/hooks/use-role";
import { approveLearnedRule, getLearnedRules, KIND_LABEL, rejectLearnedRule,
  type LearnedKind, type LearnedRule, type LearnedStatus, type Severity } from "@/lib/api/learnedRules";
import { queryKeys } from "@/lib/query-keys";

const STATUS_OPTIONS = [{ value: "pending", label: "Awaiting review" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }];
const KIND_OPTIONS = [{ value: "all", label: "All kinds" }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))];
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function LearnedRulesPage() {
  const qc = useQueryClient();
  const { can } = useRole();
  const [status, setStatus] = useState<LearnedStatus>("pending");
  const [kind, setKind] = useState<"all" | LearnedKind>("all");
  const [severity] = useState<Severity>("medium");
  const q = useQuery({
    queryKey: queryKeys.learnedRules({ status, kind }),
    queryFn: () => getLearnedRules(status, kind === "all" ? undefined : kind),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["learned-rules"] });
  const approve = useMutation({
    mutationFn: (id: string) => approveLearnedRule(id, severity),
    onSuccess: (d) => { toast.success(`Rule ${d.rule_id} is active from the next run`); refresh(); },
    onError: () => toast.error("Could not approve this rule"),
  });
  const reject = useMutation({
    mutationFn: rejectLearnedRule,
    onSuccess: () => { toast.success("Proposal rejected"); refresh(); },
    onError: () => toast.error("Could not reject this rule"),
  });

  const columns = useMemo<ColumnDef<LearnedRule>[]>(() => [
    { id: "kind", header: "Kind", cell: ({ row }) => <Pill tone="neutral">{KIND_LABEL[row.original.kind]}</Pill> },
    { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field}</Mono> },
    { id: "det", header: "Decided by", cell: ({ row }) => (row.original.determinant ? <Mono>{row.original.determinant}</Mono> : "—") },
    { id: "conf", header: "Holds for", cell: ({ row }) => pct(row.original.confidence) },
    { id: "viol", header: "Breaks it", cell: ({ row }) => row.original.violations.toLocaleString() },
    { id: "keys", header: "Examples", cell: ({ row }) => <Mono>{row.original.sample_keys.slice(0, 2).join(", ") || "—"}</Mono> },
    {
      id: "act", header: "",
      cell: ({ row }) => row.original.status === "pending" ? (
        <span className="flex gap-2">
          {can("approve") ? <Button onClick={() => approve.mutate(row.original.id)} disabled={approve.isPending}>Approve</Button> : null}
          {can("manage_rules") ? <Button variant="secondary" onClick={() => reject.mutate(row.original.id)} disabled={reject.isPending}>Reject</Button> : null}
        </span>
      ) : <Mono>{row.original.rule_id ?? row.original.status}</Mono>,
    },
  ], [approve, reject, can]);

  const items = q.data?.items ?? [];
  return (
    <ExplorerPage
      filterBar={
        <div className="flex items-end gap-3">
          <Field label="Status"><Select value={status} onValueChange={(v) => setStatus(v as LearnedStatus)} options={STATUS_OPTIONS} /></Field>
          <Field label="Kind"><Select value={kind} onValueChange={(v) => setKind(v as "all" | LearnedKind)} options={KIND_OPTIONS} /></Field>
        </div>
      }
      state={q.isLoading ? "loading" : q.isError ? "error" : items.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No learned rules here yet. They appear after the next analysis." }}
      table={<DataTable columns={columns} data={items} getRowId={(r) => r.id} />}
    />
  );
}
```

Check the `Button` `variant` prop name in `frontend/design` before use. If `Select` needs a typed options import (`SelectOption`), import it from `@/design` as `batches-tab.tsx` does. Only `@/design` tokens; no hex.

- [ ] **Step 4: Run the gate**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run "app/(app)/rules"`
Expected: PASS

---

# Part B — Fix back into SAP, safely (files only)

## Package formats (normative)

| Format id | File | Purpose | Built from |
|---|---|---|---|
| `cockpit_xlsx`, `cockpit_csv`, `mass_change_csv` | existing | unchanged | existing |
| `ltmc_xlsx` | `.xlsx` | Load cleansed values in the **S/4 migration** (Migration Cockpit file staging). There is one sheet per migration-object structure, technical field names in the header row and DDIC descriptions in row 2. | `remediation.cockpit_sheets` regrouped by `LTMC_OBJECTS` |
| `mass_maintenance_zip` | `.zip` | Fix **in place** in the source system with MM17 (material), XD99 (customer) or XK99 (vendor). Per (transaction, table, field, new value): one tab-delimited key list to paste into the transaction's multiple selection, plus `changes.tsv` with every old and new value. | `remediation._exportable` items |
| `mdg_cr_json` | `.json` | An MDG change-request payload **file** for the customer's MDG import (data model MM or BP). The CR type is supplied by the user, because it is MDG configuration. No API call is made. | items grouped by entity and key |

Every package is produced only for a batch whose status is `approved` or `exported`. The batch creator (maker, `apply`) cannot approve it (checker, `approve`); the existing guard enforces this. Each export:
- writes an `export_packages` row (format, filename, sha256, bytes, item count, who and when);
- writes the existing `remediation_events` "exported" rows;
- returns the sha256 in `X-Content-SHA256`.

`GET /batches/{id}/diff` shows the exact before/after per record and field.

**SAP template naming must be verified, not guessed.** `LTMC_OBJECTS` below is the single place that names migration objects, sheets and template field names. Before Task 13 is done:
1. Download the Migration Cockpit file templates for Product, Customer and Supplier from an S/4HANA system of the target release ("Migrate Your Data" app → Download Template).
2. Check each sheet name and that each listed table's fields appear under the same technical name.
3. Record template column names that differ from the DDIC field name (newer releases rename some, e.g. the product number) in `FIELD_ALIASES`.

The package mirrors sheet names and column order so a steward can paste rows into the downloaded template. It does not replace that template's own header block.

---

### Task 12: Batch sources: approved cleaning items and simulation output

**Files:**
- Modify: `api/services/remediation.py` (extract `store_batch`; add `ANCHOR`, `items_from_cleaning`, `items_from_simulation`)
- Modify: `api/services/fix_simulation.py` (`rule_record_fixes` adds `"current_value": cur`)
- Modify: `workers/tasks/run_simulation.py` (store `record_fixes` in the doc)
- Modify: `api/routes/remediation.py` (`POST /batches/from-cleaning`, `POST /batches/from-simulation`)
- Test: `tests/test_remediation.py` (append), `tests/test_fix_simulation.py` (append one assert)

**Interfaces:**
- `store_batch(session, tenant_id, name, filter_json, items, user_id, user_label) -> dict` is exactly today's insert block. `draft_batch` now ends in `return store_batch(...)`.
- `items_from_cleaning(rows: list[dict]) -> list[dict]` and `items_from_simulation(fixes: list[dict]) -> list[dict]` return items in the `build_items` shape, with `scope` and `proposal_source` set to `cleaning` / `simulation`.
- `check_id` is `"{rule}:{TABLE.FIELD}"` for cleaning items, because `uq_remediation_items` is (batch, check, record), and one cleaning row can change several fields.

- [ ] **Step 1: Write the failing tests**

```python
def test_items_from_cleaning_one_item_per_changed_field():
    rows = [{"object_type": "material", "rule_id": "CL1", "record_key": "000000000000000042",
             "record_data_before": {"MATKL": "misc", "MTART": "ROH", "MAKTX": "Bolt"},
             "record_data_after": {"MATKL": "MG-0001", "MTART": "ROH", "MARC.EKGRP": "001"}}]
    items = remediation.items_from_cleaning(rows)
    assert [(i["field"], i["current_value"], i["proposed_value"]) for i in items] == [
        ("MARA.MATKL", "misc", "MG-0001"), ("MARC.EKGRP", None, "001")]
    assert items[0]["record_key"] == "MATNR=000000000000000042"
    assert items[0]["check_id"] == "CL1:MARA.MATKL" and items[0]["proposal_source"] == "cleaning"


def test_items_from_cleaning_skips_unknown_object_without_qualified_fields():
    rows = [{"object_type": "unknown", "rule_id": None, "record_key": "1",
             "record_data_before": {}, "record_data_after": {"X": "1"}}]
    assert remediation.items_from_cleaning(rows) == []


def test_items_from_simulation():
    fixes = [{"check_id": "AP_T", "module": "accounts_payable", "field": "LFA1.LAND1",
              "record_key": "LIFNR=0000100002", "current_value": None, "new_value": "DE"}]
    (i,) = remediation.items_from_simulation(fixes)
    assert (i["scope"], i["proposal_source"], i["proposed_value"], i["grain"]) == ("simulation", "simulation", "DE", "LFA1")
```

In `tests/test_fix_simulation.py`, extend the existing `rule_record_fixes` test with `assert "current_value" in fixes[0]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_remediation.py tests/test_fix_simulation.py -q`
Expected: FAIL with `AttributeError: module 'api.services.remediation' has no attribute 'items_from_cleaning'`

- [ ] **Step 3: Implement**

Before writing `ANCHOR`, list the object types the cleaning engine writes:

```
grep -rn "object_type" workers/tasks/run_cleaning.py api/services/cleaning_engine.py | head
```

Every type it emits for material, customer or vendor must appear in `ANCHOR`.

```python
# api/services/remediation.py
# object type → (anchor table, its business key) for cleaning rows whose record_key is a bare number
ANCHOR: dict[str, tuple[str, str]] = {
    "material": ("MARA", "MATNR"), "material_master": ("MARA", "MATNR"),
    "customer": ("KNA1", "KUNNR"), "customer_master": ("KNA1", "KUNNR"), "sd_customer_master": ("KNA1", "KUNNR"),
    "vendor": ("LFA1", "LIFNR"), "vendor_master": ("LFA1", "LIFNR"), "accounts_payable": ("LFA1", "LIFNR"),
}


def _item(scope: str, module: str, check_id: str, record_key: str, field: str,
          current: Optional[str], proposed: str) -> dict:
    return {"issue_id": None, "scope": scope, "module": module, "check_id": check_id, "record_key": record_key,
            "grain": field.split(".", 1)[0], "field": field, "current_value": current,
            "proposed_value": proposed, "proposal_source": scope, "confidence": None}


def items_from_cleaning(rows: list[dict]) -> list[dict]:
    """Approved cleaning_queue rows → one item per field whose value changes."""
    out = []
    for r in rows:
        table, key = ANCHOR.get(r["object_type"], (None, None))
        before, after = r.get("record_data_before") or {}, r.get("record_data_after") or {}
        rk = r["record_key"] if "=" in r["record_key"] or key is None else f"{key}={r['record_key']}"
        for f in sorted(after):
            old, new = before.get(f), after.get(f)
            if new is None or str(new) == str(old if old is not None else ""):
                continue
            field = f if "." in f else (f"{table}.{f}" if table else None)
            if field is None:
                continue
            out.append(_item("cleaning", r["object_type"], f"{r.get('rule_id') or 'CLEANING'}:{field}", rk, field,
                             None if old is None else str(old), str(new)))
    return out


def items_from_simulation(fixes: list[dict]) -> list[dict]:
    """Record fixes a simulation applied ([{check_id, module, field, record_key, current_value, new_value}])."""
    return [_item("simulation", f["module"], f["check_id"], f["record_key"], f["field"], f.get("current_value"),
                  str(f["new_value"])) for f in fixes if f.get("field") and f.get("new_value") is not None]
```

Move the block from `batch_id = uuid.uuid4()` to the end of `draft_batch` into:

```python
def store_batch(session, tenant_id: str, name: str, filter_json: str, items: list[dict],
                user_id: Optional[str], user_label: Optional[str]) -> dict:
    """Insert a draft batch + its items + 'created' events. Caller has set app.tenant_id."""
    import json
    import uuid
    # … the moved INSERT/return block, unchanged …
```

`draft_batch` ends with `return store_batch(session, tenant_id, name, filter_json, items, user_id, user_label)`.

In `api/services/fix_simulation.py` `rule_record_fixes`, change the append to `out.append({"field": field, "record_key": str(key), "new_value": new, "current_value": cur})`.

In `workers/tasks/run_simulation.py`:
- Where `groups[f"rule:{cid}"]` is built, tag each fix with `[{**x, "check_id": cid, "module": rule.get("module", "")} for x in fixes]`.
- Before returning `doc`, add `doc["record_fixes"] = [x for g in groups.values() if "check_id" in (g.get("record_fixes") or [{}])[0] for x in g["record_fixes"]][:50_000]`. Batch-group fixes already live in a batch, so they are excluded.
- Value-map fixes are not record-level and are not packaged. ponytail: a steward drafts a batch for those.

In `api/routes/remediation.py`, add (keep `MAX_ITEMS`):

```python
class FromCleaning(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_ITEMS)


class FromSimulation(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    simulation_id: str = Field(min_length=1, max_length=100)


@router.post("/batches/from-cleaning")
async def create_batch_from_cleaning(body: FromCleaning, request: Request, db: AsyncSession = Depends(get_db),
                                     tenant: Tenant = Depends(get_tenant),
                                     _perm: str = Depends(require_permission("apply"))):
    """Draft batch from approved cleaning items. Still needs a second person's approval before export."""
    await _rls(db, tenant)
    rows = (await db.execute(text("""
        SELECT object_type, rule_id, record_key, record_data_before, record_data_after FROM cleaning_queue
         WHERE tenant_id = :tid AND id = ANY(:ids) AND status = 'approved'
    """), {"tid": str(tenant.id), "ids": [str(i) for i in body.ids]})).mappings().all()
    items = remediation.items_from_cleaning([dict(r) for r in rows])
    if not items:
        raise HTTPException(status_code=400, detail="None of these cleaning items is approved with a changed value.")
    uid, label = current_user_id(request), current_user_label()
    filt = json.dumps({"source": "cleaning", "ids": sorted(str(i) for i in body.ids)})
    out = await db.run_sync(lambda s: remediation.store_batch(s, str(tenant.id), body.name, filt, items, uid, label))
    await db.commit()
    return out


@router.post("/batches/from-simulation")
async def create_batch_from_simulation(body: FromSimulation, request: Request, db: AsyncSession = Depends(get_db),
                                       tenant: Tenant = Depends(get_tenant),
                                       _perm: str = Depends(require_permission("apply"))):
    """Draft batch from a finished simulation's record fixes (Redis, 24 h)."""
    from api.services.task_progress import _redis_client
    from workers.tasks.run_simulation import result_key

    raw = _redis_client().get(result_key(str(tenant.id), body.simulation_id))
    doc = json.loads(raw) if raw else None
    if not doc or not doc.get("record_fixes"):
        raise HTTPException(status_code=404, detail="Simulation not found, expired, or it changed no records.")
    items = remediation.items_from_simulation(doc["record_fixes"])
    await _rls(db, tenant)
    uid, label = current_user_id(request), current_user_label()
    filt = json.dumps({"source": "simulation", "simulation_id": body.simulation_id})
    out = await db.run_sync(lambda s: remediation.store_batch(s, str(tenant.id), body.name, filt, items, uid, label))
    await db.commit()
    return out
```

Add `import json` to the route module. `result_key` already includes the tenant id, so one tenant cannot read another tenant's simulation.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_remediation.py tests/test_fix_simulation.py -q`
Expected: PASS. The `proposal_source` DB check is widened in Task 16; the pg route test there covers the insert.

---

### Task 13: Migration Cockpit-style workbook (`ltmc_xlsx`)

**Files:**
- Create: `api/services/sap_packages.py`
- Test: `tests/test_sap_packages.py`

**Interfaces:**
- Produces:
  - `LTMC_OBJECTS: dict[str, tuple[str, dict[str, str]]]`, mapping object to (migration object name, {table: sheet});
  - `FIELD_ALIASES: dict[str, str]`;
  - `no_formulas(ws) -> None`;
  - `ltmc_workbook(items, dictionary) -> bytes`.
- Consumes: `remediation.cockpit_sheets`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_sap_packages.py
"""SAP correction packages: files only, never a call to SAP."""
import io
import json
import zipfile

from openpyxl import load_workbook

from api.services import sap_packages as pk
from sap.ddic import get_dictionary

ITEMS = [
    {"module": "material_master", "check_id": "LR-000001", "record_key": "MATNR=000000000000000042",
     "field": "MARA.MATKL", "current_value": "misc", "proposed_value": "MG-0001"},
    {"module": "material_master", "check_id": "LR-000002", "record_key": "MATNR=000000000000000042|WERKS=1000",
     "field": "MARC.EKGRP", "current_value": "", "proposed_value": "=cmd|' /C calc'!A0"},
    {"module": "accounts_payable", "check_id": "AP_T", "record_key": "LIFNR=0000100002",
     "field": "LFA1.LAND1", "current_value": None, "proposed_value": "DE"},
    {"module": "x", "check_id": "N", "record_key": "K=1", "field": "ZTAB.F", "current_value": None,
     "proposed_value": None},
]


def test_ltmc_workbook_groups_tables_into_object_sheets_and_blocks_formulas():
    wb = load_workbook(io.BytesIO(pk.ltmc_workbook(ITEMS, get_dictionary("s4hana"))))
    material_sheets = [s for s in wb.sheetnames if s.startswith("Product")]
    assert material_sheets == ["Product - Basic Data", "Product - Plant Data"]
    plant = wb["Product - Plant Data"]
    header = [c.value for c in plant[1]]
    assert header[:2] == ["MATNR", "WERKS"] and "EKGRP" in header
    assert all(c.data_type != "f" for row in plant.iter_rows() for c in row)
    assert "Supplier - General Data" in wb.sheetnames
    assert "README" in wb.sheetnames                       # names the object, release check, "file only"
```

The sheet strings in this test must equal what `LTMC_OBJECTS` holds after the verification step. Update both together.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_sap_packages.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'api.services.sap_packages'`

- [ ] **Step 3: Implement**

```python
# api/services/sap_packages.py
"""SAP correction packages from an approved remediation batch. Every function returns
file bytes for a person to download and load through SAP's own tools; nothing here
opens a connection to SAP (Meridian is read-only on SAP).

  ltmc_workbook           Migration Cockpit file-staging layout (S/4 migration load)
  mass_maintenance_zip    MM17 / XD99 / XK99 key lists + change log (fix in place)
  mdg_change_request      MDG change-request payload file (customer-side import)
"""
from __future__ import annotations

import io
from collections.abc import Iterable

import pandas as pd
from openpyxl.worksheet.worksheet import Worksheet

from api.services.remediation import _exportable, _key_parts, cockpit_sheets
from sap.ddic import Dictionary

# object -> (Migration Cockpit migration object, {SAP table: template sheet}).
# VERIFY against the target release's downloaded templates before relying on a name (see plan, Part B).
LTMC_OBJECTS: dict[str, tuple[str, dict[str, str]]] = {
    "material": ("Product", {"MARA": "Basic Data", "MAKT": "Descriptions", "MARC": "Plant Data",
                             "MARD": "Storage Location Data", "MBEW": "Valuation Data", "MVKE": "Sales Data",
                             "MARM": "Units of Measure"}),
    "customer": ("Customer", {"KNA1": "General Data", "KNB1": "Company Data", "KNVV": "Sales Data"}),
    "vendor": ("Supplier", {"LFA1": "General Data", "LFB1": "Company Code Data",
                            "LFM1": "Purchasing Organization Data"}),
}
# "TABLE.FIELD" -> template column name, where the template renames a DDIC field. Filled from the verification.
FIELD_ALIASES: dict[str, str] = {}
TABLE_OBJECT = {t: o for o, (_, sheets) in LTMC_OBJECTS.items() for t in sheets}


def no_formulas(ws: Worksheet) -> None:
    """SAP values like '=A' stay text, never a formula (same guard as the remediation export)."""
    for row in ws.iter_rows():
        for cell in row:
            if cell.data_type == "f":
                cell.data_type = "s"


def _description(dictionary: Dictionary | None, table: str, field: str) -> str:
    f = dictionary.field(table, field) if dictionary is not None else None
    return (getattr(f, "description", None) or "") if f else ""


def ltmc_workbook(items: list[dict], dictionary: Dictionary | None) -> bytes:
    sheets = cockpit_sheets(items, dictionary)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        readme = pd.DataFrame({"Meridian correction package": [
            "Migration Cockpit file-staging layout. One sheet per migration object structure.",
            "Row 1: technical field names. Row 2: field descriptions. Values from row 3.",
            "Paste rows into the template downloaded from your S/4HANA release; check sheet names match.",
            "Meridian never writes to SAP. Load this file through the Migration Cockpit yourself.",
        ]})
        readme.to_excel(xw, sheet_name="README", index=False)
        for table, df in sheets.items():
            obj = TABLE_OBJECT.get(table)
            if obj is None:
                continue  # tables outside the three objects: use cockpit_xlsx / mass_change_csv
            mig, names = LTMC_OBJECTS[obj]
            name = f"{mig} - {names[table]}"[:31]
            cols = [FIELD_ALIASES.get(f"{table}.{c}", c) for c in df.columns]
            desc = pd.DataFrame([[_description(dictionary, table, c) for c in df.columns]], columns=cols)
            pd.concat([desc, df.set_axis(cols, axis=1)], ignore_index=True).to_excel(xw, sheet_name=name, index=False)
        for ws in xw.book.worksheets:
            no_formulas(ws)
    return buf.getvalue()
```

The `Iterable` and `_key_parts` imports are used by the next tasks. Check the DDIC field object's description attribute name (`python -c "from sap.ddic import get_dictionary as g; print(vars(g('s4hana').field('MARA','MATKL')))"`) and use it directly instead of `getattr` if it exists.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/test_sap_packages.py -q`
Expected: PASS

- [ ] **Step 5: Verify SAP naming**

Do the "SAP template naming must be verified" step above. Record in the commit message which release's templates were checked. If no system is reachable, leave the names as they are and add a `# ponytail: names unverified for release X` comment at `LTMC_OBJECTS`. Do not invent field aliases.

---

### Task 14: MM17 / XD99 / XK99 mass-maintenance package

**Files:**
- Modify: `api/services/sap_packages.py`
- Modify: `api/services/export_engine.py` (add `MASS_MAINTENANCE_TCODES`)
- Test: `tests/test_sap_packages.py` (append)

**Interfaces:**
- Produces: `MASS_MAINTENANCE_TCODES = {"material": "MM17", "customer": "XD99", "vendor": "XK99"}` and `mass_maintenance_zip(items) -> bytes`.
- Zip layout:
  - `changes.tsv`, with columns TCODE, TABLE, FIELD, NEW_VALUE, RECORD_KEY, OLD_VALUE, RULE, sorted by those columns;
  - `<TCODE>/<TABLE>-<FIELD>-<nnn>.txt`, one business key per line (the last key part, e.g. MATNR), for the multiple-selection paste;
  - `README.txt`, with each group's new value and instructions.
  - Each group is one transaction run that sets one field to one value for the listed keys. Items outside the three objects go to `skipped.tsv`.

- [ ] **Step 1: Write the failing test**

```python
def test_mass_maintenance_zip_groups_by_field_and_value():
    z = zipfile.ZipFile(io.BytesIO(pk.mass_maintenance_zip(ITEMS)))
    names = sorted(z.namelist())
    assert names == ["MM17/MARA-MATKL-001.txt", "MM17/MARC-EKGRP-001.txt", "README.txt", "XK99/LFA1-LAND1-001.txt",
                     "changes.tsv"]
    assert z.read("MM17/MARA-MATKL-001.txt").decode() == "000000000000000042\n"
    changes = z.read("changes.tsv").decode().splitlines()
    assert changes[0] == "TCODE\tTABLE\tFIELD\tNEW_VALUE\tRECORD_KEY\tOLD_VALUE\tRULE"
    assert "MG-0001" in z.read("README.txt").decode()
    assert pk.mass_maintenance_zip(ITEMS) == pk.mass_maintenance_zip(list(reversed(ITEMS)))   # deterministic
```

The zip must be deterministic: fixed `ZipInfo.date_time = (1980, 1, 1, 0, 0, 0)` and sorted entries. The sha256 then identifies the content.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_sap_packages.py -q -k mass`
Expected: FAIL with `AttributeError: ... has no attribute 'mass_maintenance_zip'`

- [ ] **Step 3: Implement**

In `api/services/export_engine.py`, below `TRANSACTION_CODES`:

```python
# Mass maintenance transactions (one field, one new value, many keys per run) for correction packages.
MASS_MAINTENANCE_TCODES: dict[str, str] = {"material": "MM17", "customer": "XD99", "vendor": "XK99"}
```

Append to `api/services/sap_packages.py` (add `import zipfile`):

```python
def _zip(files: Iterable[tuple[str, str]]) -> bytes:
    """Deterministic zip: sorted names, fixed timestamps."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, body in sorted(files):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, body)
    return buf.getvalue()


def _tsv(rows: list[list[str]]) -> str:
    return "".join("\t".join(v.replace("\t", " ").replace("\n", " ") for v in r) + "\n" for r in rows)


def mass_maintenance_zip(items: list[dict]) -> bytes:
    from api.services.export_engine import MASS_MAINTENANCE_TCODES

    head = ["TCODE", "TABLE", "FIELD", "NEW_VALUE", "RECORD_KEY", "OLD_VALUE", "RULE"]
    rows, skipped = [], []
    for i in _exportable(items):
        table, field = i["field"].split(".", 1)
        tcode = MASS_MAINTENANCE_TCODES.get(TABLE_OBJECT.get(table, ""), "")
        r = [tcode, table, field, str(i["proposed_value"]), i["record_key"], str(i.get("current_value") or ""),
             i["check_id"]]
        (rows if tcode else skipped).append(r)
    rows.sort()
    groups: dict[tuple[str, str, str, str], list[str]] = {}
    for r in rows:
        groups.setdefault((r[0], r[1], r[2], r[3]), []).append(list(_key_parts(r[4]).values())[-1])
    files, readme, seq = [("changes.tsv", _tsv([head, *rows]))], [], {}
    for (tcode, table, field, new), keys in sorted(groups.items()):
        n = seq[(tcode, table, field)] = seq.get((tcode, table, field), 0) + 1
        name = f"{tcode}/{table}-{field}-{n:03d}.txt"
        files.append((name, "".join(f"{k}\n" for k in sorted(set(keys)))))
        readme.append(f"{name}: run {tcode}, table {table}, set {field} to '{new}' for {len(set(keys))} keys "
                      "(paste the file into the key multiple selection).")
    if skipped:
        files.append(("skipped.tsv", _tsv([head, *sorted(skipped)])))
    files.append(("README.txt", "Meridian correction package. Meridian never writes to SAP; run each step "
                                "yourself after review.\n" + "\n".join(readme) + "\n"))
    return _zip(files)
```

ponytail: for plant-level fields (MARC), MM17 also needs the plant in its selection. The key list holds the last key part only. `changes.tsv` carries the full key, so the steward filters by plant from there. Split groups per plant if stewards ask.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/test_sap_packages.py -q`
Expected: PASS. For plant-level groups the key file holds the last key part; adjust the expected line in the test if `_key_parts` ordering puts WERKS last (it does for `MATNR=…|WERKS=1000`). In that case `MARC-EKGRP-001.txt` holds `1000`. Instead, take the object's business key: use `ANCHOR`'s key name from `remediation.ANCHOR` (`MATNR` / `KUNNR` / `LIFNR`), `_key_parts(r[4]).get(key) or last part`, and keep the test expecting the material number.

---

### Task 15: MDG change-request payload file

**Files:**
- Modify: `api/services/sap_packages.py`
- Test: `tests/test_sap_packages.py` (append)

**Interfaces:**
- Produces: `mdg_change_request(items, *, batch_id: str, batch_name: str, cr_type: str | None) -> bytes`. The JSON has sorted keys and indent 2:

```json
{"format": "meridian.mdg-change-request/1", "batch_id": "...", "description": "...",
 "change_requests": [{"data_model": "MM", "change_request_type": null,
                      "entities": [{"entity_type": "MARA", "key": {"MATNR": "..."},
                                    "changes": [{"attribute": "MATKL", "old": "misc", "new": "MG-0001", "rule": "LR-000001"}]}]}],
 "note": "File only. Meridian makes no MDG or SAP call. Import it with your MDG file upload or a customer mapping."}
```

The data model is `MM` for material tables and `BP` for customer and vendor tables. Other tables are left out and counted in `"skipped"`. `change_request_type` is the caller's `cr_type`; it is MDG configuration (transaction MDGIMG), so it is never defaulted.

- [ ] **Step 1: Write the failing test**

```python
def test_mdg_change_request_groups_entities_by_model():
    doc = json.loads(pk.mdg_change_request(ITEMS, batch_id="b1", batch_name="Fix MATKL", cr_type="ZMAT_CHG"))
    models = {cr["data_model"]: cr for cr in doc["change_requests"]}
    assert set(models) == {"MM", "BP"} and doc["skipped"] == 0
    mara = next(e for e in models["MM"]["entities"] if e["entity_type"] == "MARA")
    assert mara["key"] == {"MATNR": "000000000000000042"}
    assert mara["changes"] == [{"attribute": "MATKL", "old": "misc", "new": "MG-0001", "rule": "LR-000001"}]
    assert models["MM"]["change_request_type"] == "ZMAT_CHG"
    assert "no MDG or SAP call" in doc["note"]
```

`skipped` is 0 because the ZTAB item has no proposed value, so `_exportable` drops it before grouping.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_sap_packages.py -q -k mdg`
Expected: FAIL with `AttributeError: ... has no attribute 'mdg_change_request'`

- [ ] **Step 3: Implement**

```python
MDG_MODEL = {"material": "MM", "customer": "BP", "vendor": "BP"}


def mdg_change_request(items: list[dict], *, batch_id: str, batch_name: str, cr_type: str | None) -> bytes:
    import json

    by_model: dict[str, dict[tuple[str, str], dict]] = {}
    skipped = 0
    for i in _exportable(items):
        table, field = i["field"].split(".", 1)
        model = MDG_MODEL.get(TABLE_OBJECT.get(table, ""))
        if model is None:
            skipped += 1
            continue
        ent = by_model.setdefault(model, {}).setdefault(
            (table, i["record_key"]), {"entity_type": table, "key": _key_parts(i["record_key"]), "changes": []})
        ent["changes"].append({"attribute": field, "old": i.get("current_value"), "new": i["proposed_value"],
                               "rule": i["check_id"]})
    doc = {
        "format": "meridian.mdg-change-request/1", "batch_id": batch_id, "description": batch_name,
        "change_requests": [
            {"data_model": m, "change_request_type": cr_type,
             "entities": [{**e, "changes": sorted(e["changes"], key=lambda c: c["attribute"])}
                          for _, e in sorted(ents.items())]}
            for m, ents in sorted(by_model.items())],
        "skipped": skipped,
        "note": "File only. Meridian makes no MDG or SAP call. Import it with your MDG file upload or a customer mapping.",
    }
    return json.dumps(doc, indent=2, sort_keys=True).encode()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/test_sap_packages.py -q`
Expected: PASS

---

### Task 16: Migration 068, export route (formats, sha256, audit), diff and packages list

**Files:**
- Create: `db/migrations/versions/068_export_packages.py`
- Modify: `db/schema.py` (`ExportPackage` model)
- Modify: `api/services/remediation.py` (`batch_diff`)
- Modify: `api/routes/remediation.py` (export formats and record, `GET /batches/{id}/diff`, `GET /batches/{id}/packages`)
- Test: `tests/test_remediation.py` (append, `batch_diff`) and `tests/test_export_packages_pg.py` (create)

**Interfaces:**
- `export_packages` has these columns: `id`, `tenant_id`, `batch_id` (FK, CASCADE), `format`, `filename`, `sha256`, `size_bytes`, `item_count`, `created_by` uuid, `created_by_label`, `approved_by_label` (a copy of the batch's checker), `created_at`. It has RLS.
- `remediation_items.ck_remediation_items_source` widens to `('rule','steward','manual','cleaning','simulation')`.
- `batch_diff(items) -> list[dict]` returns `[{record_key, table, changes: [{field, before, after, rule}]}]`, sorted.
- The export `format` Literal gains `ltmc_xlsx | mass_maintenance_zip | mdg_cr_json`, plus the optional query `cr_type` (max 40 characters, `^[A-Z0-9_]+$`).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_remediation.py (append)
def test_batch_diff_groups_changes_per_record():
    items = [{"record_key": "MATNR=42", "field": "MARA.MATKL", "current_value": "misc", "proposed_value": "MG-1",
              "check_id": "LR-000001"},
             {"record_key": "MATNR=42", "field": "MARA.MTART", "current_value": "ROH", "proposed_value": None,
              "check_id": "X"},
             {"record_key": "MATNR=41", "field": "MARA.MATKL", "current_value": None, "proposed_value": "MG-2",
              "check_id": "LR-000001"}]
    assert remediation.batch_diff(items) == [
        {"record_key": "MATNR=41", "table": "MARA",
         "changes": [{"field": "MATKL", "before": None, "after": "MG-2", "rule": "LR-000001"}]},
        {"record_key": "MATNR=42", "table": "MARA",
         "changes": [{"field": "MATKL", "before": "misc", "after": "MG-1", "rule": "LR-000001"}]},
    ]
```

```python
# tests/test_export_packages_pg.py
"""Export packages (migration 068) through the real route: four-eyes, sha256 record, audit row, RLS."""
# Reuse the app/tenant/auth fixtures of an existing route pg test (e.g. tests/test_drilldown_routes_pg.py) and
# tests/route_auth.py to call the API as two different users of one tenant.
import hashlib
import os

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


def test_export_records_sha256_and_requires_checker(client_as, seeded_batch):
    maker, checker = client_as("steward"), client_as("approver")
    bid = seeded_batch(created_by=maker.user_id)          # draft with two items that have proposals
    assert maker.post(f"/api/v1/remediation/batches/{bid}/export?format=mdg_cr_json").status_code == 409
    assert maker.post(f"/api/v1/remediation/batches/{bid}/approve").status_code == 403   # maker ≠ checker
    assert checker.post(f"/api/v1/remediation/batches/{bid}/approve").status_code == 200
    r = checker.post(f"/api/v1/remediation/batches/{bid}/export?format=mass_maintenance_zip")
    assert r.status_code == 200 and r.headers["x-content-sha256"] == hashlib.sha256(r.content).hexdigest()
    pk = checker.get(f"/api/v1/remediation/batches/{bid}/packages").json()["items"]
    assert pk[0]["sha256"] == r.headers["x-content-sha256"] and pk[0]["format"] == "mass_maintenance_zip"
    ev = checker.get(f"/api/v1/remediation/batches/{bid}/events").json()["items"]
    assert any(e["action"] == "exported" and e["to_value"] == "mass_maintenance_zip" for e in ev)
    diff = checker.get(f"/api/v1/remediation/batches/{bid}/diff").json()["records"]
    assert diff and diff[0]["changes"][0]["after"] is not None
```

Implement `client_as` and `seeded_batch` as local fixtures following the existing pg route tests. Do not invent a new auth mechanism; if no two-user route harness exists, test the guards by calling the route functions with stub `Request`/`Tenant` objects as `tests/test_rbac_matrix.py` does.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_remediation.py -q -k diff && MERIDIAN_TEST_DB_URL=postgresql://… pytest tests/test_export_packages_pg.py -q`
Expected: FAIL (`batch_diff` missing; `relation "export_packages" does not exist`)

- [ ] **Step 3: Implement**

```python
# db/migrations/versions/068_export_packages.py
"""export packages

Revision ID: 068
Revises: 067
Create Date: 2026-10-10

One row per downloaded correction package (format, file name, sha256, size, who
exported it, who approved the batch) — the audit trail proving which exact file
left Meridian. Batches may now come from approved cleaning items and simulations.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "068"
down_revision: Union[str, None] = "067"
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
        "export_packages",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("remediation_batches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("format", sa.Text(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("item_count", sa.Integer(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_label", sa.Text(), nullable=True),
        sa.Column("approved_by_label", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_export_packages_batch", "export_packages", ["tenant_id", "batch_id"])
    _rls("export_packages")
    op.drop_constraint("ck_remediation_items_source", "remediation_items", type_="check")
    op.create_check_constraint("ck_remediation_items_source", "remediation_items",
                               "proposal_source IN ('rule', 'steward', 'manual', 'cleaning', 'simulation')")


def downgrade() -> None:
    op.drop_constraint("ck_remediation_items_source", "remediation_items", type_="check")
    op.create_check_constraint("ck_remediation_items_source", "remediation_items",
                               "proposal_source IN ('rule', 'steward', 'manual')")
    op.drop_table("export_packages")
```

```python
# api/services/remediation.py
def batch_diff(items: list[dict]) -> list[dict]:
    """Before/after per record: only fields with a value to load."""
    recs: dict[tuple[str, str], list[dict]] = {}
    for i in _exportable(items):
        table, field = i["field"].split(".", 1)
        recs.setdefault((i["record_key"], table), []).append(
            {"field": field, "before": i.get("current_value"), "after": i["proposed_value"], "rule": i["check_id"]})
    return [{"record_key": k, "table": t, "changes": sorted(c, key=lambda x: x["field"])}
            for (k, t), c in sorted(recs.items())]
```

In `api/routes/remediation.py`:

```python
_MEDIA = {"csv": "text/csv", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "zip": "application/zip", "json": "application/json"}
ExportFormat = Literal["cockpit_xlsx", "cockpit_csv", "mass_change_csv", "ltmc_xlsx", "mass_maintenance_zip",
                       "mdg_cr_json"]
```

- In `export_batch`, change the param to `format: ExportFormat = Query("cockpit_xlsx")` and add `cr_type: Optional[str] = Query(None, max_length=40, pattern=r"^[A-Z0-9_]+$")`.
- After the existing draft guard, add the checker guard: `if b.get("approved_by") and str(b["approved_by"]) == str(b.get("created_by")): raise HTTPException(403, "The batch's creator approved it; a second person must approve before export.")`. This is defence in depth; the approve route already blocks it.
- Add the branches before the existing `else`:

```python
    from api.services import sap_packages
    from sap.ddic import get_dictionary
    if format == "ltmc_xlsx":
        data, ext = sap_packages.ltmc_workbook(items, get_dictionary("s4hana")), "xlsx"
    elif format == "mass_maintenance_zip":
        data, ext = sap_packages.mass_maintenance_zip(items), "zip"
    elif format == "mdg_cr_json":
        data, ext = sap_packages.mdg_change_request(items, batch_id=str(batch_id), batch_name=b["name"],
                                                    cr_type=cr_type), "json"
```

- Replace the inline formula loop in the existing `cockpit_xlsx` branch with `sap_packages.no_formulas(xw.sheets[table[:31]])`, so there is one guard.
- After `data` is built:

```python
    digest, filename = hashlib.sha256(data).hexdigest(), f"remediation_{batch_id}_{format}.{ext}"
    await db.execute(text("""
        INSERT INTO export_packages (tenant_id, batch_id, format, filename, sha256, size_bytes, item_count,
                                     created_by, created_by_label, approved_by_label)
        VALUES (:tid, :bid, :fmt, :fn, :sha, :size, :n, CAST(:uid AS uuid), :label, :appr)
    """), {"tid": str(tenant.id), "bid": str(batch_id), "fmt": format, "fn": filename, "sha": digest,
           "size": len(data), "n": len(remediation._exportable(items)), "uid": current_user_id(request),
           "label": current_user_label(), "appr": b.get("approved_by_label")})
```

- Keep the existing status update and `_event(... "exported" ..., to_value=format)`.
- Return with `headers={"Content-Disposition": f"attachment; filename={filename}", "X-Content-SHA256": digest, "Access-Control-Expose-Headers": "Content-Disposition, X-Content-SHA256"}`.
- Add `import hashlib`.

```python
@router.get("/batches/{batch_id}/diff")
async def batch_diff(batch_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                     _perm: str = Depends(require_permission("view"))):
    await _batch(db, tenant, batch_id)
    return {"records": remediation.batch_diff(await _items(db, batch_id))}


@router.get("/batches/{batch_id}/packages")
async def list_packages(batch_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                        _perm: str = Depends(require_permission("view_audit"))):
    await _batch(db, tenant, batch_id)
    rows = (await db.execute(text("SELECT format, filename, sha256, size_bytes, item_count, created_by_label, "
                                  "approved_by_label, created_at FROM export_packages WHERE batch_id = :b "
                                  "ORDER BY created_at DESC"), {"b": batch_id})).mappings().all()
    return {"items": [dict(r) for r in rows]}
```

Check that `view_audit` exists in `api/services/rbac.py`; it does, as listed in the RBAC actions. Add the `ExportPackage` model to `db/schema.py`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_remediation.py tests/test_sap_packages.py tests/test_rbac_matrix.py -q && MERIDIAN_TEST_DB_URL=postgresql://… pytest tests/test_export_packages_pg.py tests/test_learned_rules_pg.py -q && alembic heads`
Expected: PASS, and a single head `068`.

---

### Task 17: Fix › Batches: new formats, before/after diff, package hashes

**Files:**
- Modify: `frontend/lib/api/remediation.ts`
- Modify: `frontend/lib/query-keys.ts` (add `remediationDiff: (id: string) => ["remediation", "diff", id] as const` and `remediationPackages: (id: string) => ["remediation", "packages", id] as const`)
- Modify: `frontend/app/(app)/fix/batches-tab.tsx` (`BatchDetailBody`: diff section, packages section, MDG CR type field)
- Test: `frontend/app/(app)/fix/__tests__/batches-tab.test.tsx` (append)

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows the before/after diff and exports an MDG payload with a CR type", async () => {
  vi.spyOn(remediationApi, "getBatches").mockResolvedValue({ items: [batch({ status: "approved" })] });
  vi.spyOn(remediationApi, "getBatch").mockResolvedValue(detail({ status: "approved" }));
  vi.spyOn(remediationApi, "getBatchEvents").mockResolvedValue({ items: [] });
  vi.spyOn(remediationApi, "getMonitor").mockResolvedValue({ items: [] });
  vi.spyOn(remediationApi, "getBatchDiff").mockResolvedValue({ records: [
    { record_key: "MATNR=42", table: "MARA", changes: [{ field: "MATKL", before: "misc", after: "MG-0001", rule: "LR-000001" }] },
  ] });
  vi.spyOn(remediationApi, "getBatchPackages").mockResolvedValue({ items: [] });
  const exp = vi.spyOn(remediationApi, "exportBatch").mockResolvedValue();
  renderWithQuery(<BatchesTab />);
  await userEvent.click(await screen.findByText("AP001 batch"));
  expect(await screen.findByText("misc")).toBeInTheDocument();
  expect(screen.getByText("MG-0001")).toBeInTheDocument();
  // choose MDG, enter a CR type, export
  await userEvent.click(screen.getByRole("button", { name: /^export$/i }));
  await userEvent.click(screen.getByRole("combobox"));
  await userEvent.click(screen.getByRole("option", { name: /MDG change request/i }));
  await userEvent.type(screen.getByLabelText(/change request type/i), "ZMAT_CHG");
  await userEvent.click(screen.getByRole("button", { name: /^export$/i }));
  await waitFor(() => expect(exp).toHaveBeenCalledWith("b1", "mdg_cr_json", "ZMAT_CHG"));
});
```

Match the drawer-open interaction and the `Select` role to how the existing tests in this file open a batch and pick a format. Copy their selectors rather than these if they differ.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run "app/(app)/fix/__tests__/batches-tab.test.tsx"`
Expected: FAIL (`getBatchDiff` is not a function)

- [ ] **Step 3: Implement**

`frontend/lib/api/remediation.ts`:

```ts
export type ExportFormat = "cockpit_xlsx" | "cockpit_csv" | "mass_change_csv" | "ltmc_xlsx" | "mass_maintenance_zip" | "mdg_cr_json";
export type ProposalSource = "rule" | "steward" | "manual" | "cleaning" | "simulation";

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  cockpit_xlsx: "Migration Cockpit workbook (xlsx)",
  cockpit_csv: "Migration Cockpit CSV",
  mass_change_csv: "Mass change CSV",
  ltmc_xlsx: "Migration Cockpit object templates (xlsx)",
  mass_maintenance_zip: "MM17 / XD99 / XK99 mass maintenance (zip)",
  mdg_cr_json: "MDG change request file (json)",
};

export interface DiffRecord { record_key: string; table: string; changes: { field: string; before: string | null; after: string; rule: string }[] }
export interface ExportPackage { format: ExportFormat; filename: string; sha256: string; size_bytes: number; item_count: number; created_by_label: string | null; approved_by_label: string | null; created_at: string }

export async function getBatchDiff(id: string): Promise<{ records: DiffRecord[] }> {
  const { data } = await apiClient.get<{ records: DiffRecord[] }>(`/api/v1/remediation/batches/${id}/diff`);
  return data;
}

export async function getBatchPackages(id: string): Promise<{ items: ExportPackage[] }> {
  const { data } = await apiClient.get<{ items: ExportPackage[] }>(`/api/v1/remediation/batches/${id}/packages`);
  return data;
}
```

- Change `defaultExtensionFor` to `({ cockpit_xlsx: "xlsx", ltmc_xlsx: "xlsx", mass_maintenance_zip: "zip", mdg_cr_json: "json" } as Partial<Record<ExportFormat, string>>)[format] ?? "csv"`.
- Change `exportBatch(id, format, crType?: string)` to append `&cr_type=${encodeURIComponent(crType)}` when `crType` is set. Add `SOURCE_LABEL` entries for `cleaning: "Cleaning"` and `simulation: "Simulation"`.

In `batches-tab.tsx` `BatchDetailBody`:
- Add `const diff = useQuery({ queryKey: queryKeys.remediationDiff(batchId), queryFn: () => getBatchDiff(batchId) })`.
- Add `const packages = useQuery({ queryKey: queryKeys.remediationPackages(batchId), queryFn: () => getBatchPackages(batchId), enabled: canExport })`.
- Add `const [crType, setCrType] = useState("")`.
- Change `doExport` to call `exportBatch(batchId, format, format === "mdg_cr_json" ? crType.trim() || undefined : undefined)`, and invalidate `remediationPackages(batchId)` on success.
- Next to the format `Select`, render `{format === "mdg_cr_json" ? <Field label="Change request type"><input aria-label="Change request type" value={crType} onChange={(e) => setCrType(e.target.value.toUpperCase())} /></Field> : null}`.
- Add a "Before and after" section: a `DataTable` over `diff.data?.records.flatMap((r) => r.changes.map((c) => ({ id: `${r.record_key}|${r.table}.${c.field}`, ...c, record_key: r.record_key, table: r.table })))`. The columns are Record (`Mono`), Field (`Mono` `table.field`), Before (`Mono`, `—` when null) and After (`Mono`).
- Add an "Exported files" section listing `packages.data?.items` with format label, `Mono` sha256 (first 12 characters, full value in a `Tooltip`), who exported and who approved. Use `var(--m-ink-2)`/`var(--m-ink-3)` tokens as the file already does; no hex.

- [ ] **Step 4: Run the gate**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run`
Expected: PASS

---

### Task 18: Final verification

- [ ] **Step 1: Backend suite**

Run: `pytest tests -q -x --ignore=tests/golden`
Expected: PASS. The pg tests are skipped unless `MERIDIAN_TEST_DB_URL` is set; run them once with it set.

- [ ] **Step 2: Migrations**

Run: `alembic heads && alembic upgrade head && alembic downgrade -2 && alembic upgrade head` against a scratch database.
Expected: a single head; upgrade, downgrade and re-upgrade all succeed.

- [ ] **Step 3: Read-only guarantee**

Run: `grep -nE "pyrfc|requests\.|httpx|writeback" api/services/sap_packages.py checks/house_rules.py workers/tasks/mining/house_rules.py`
Expected: no output.

- [ ] **Step 4: No customer names, no Any, no hex**

Run:
- `grep -nE "\bAny\b" checks/house_rules.py api/services/sap_packages.py workers/tasks/mining/house_rules.py api/routes/learned_rules.py`
- `cd frontend && npm run lint:tokens && grep -rnE "\bany\b" lib/api/learnedRules.ts "app/(app)/rules/learned"`

Expected: no output, and lint:tokens passes with the allowlist still empty.

- [ ] **Step 5: Frontend gate**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run`
Expected: PASS. Do not run `npm run build`.

---

## Self-review notes

- **Spec coverage, part A:**
  - The four rule kinds are covered by Tasks 3–6: dependency, value set, format and range.
  - Contingency, confidence, minimum support and cardinality cap follow the Algorithms section.
  - Determinism: Task 6 chunk invariance and Task 7.
  - Scale: Tasks 1 and 6 (chunked, head fit) and the bundle parent join in Task 9.
  - Human approval with append-only ids: Task 10. UI: Task 11.
  - Extends rather than duplicates `rule_proposal_task` (notify), `mining/` (orchestrator include, relationship fix), `profiling` helpers, `rule_versions` lifecycle, `dependency_check` and the rules UI.
- **Spec coverage, part B:**
  - Sources: Task 12.
  - LTMC: Task 13. MM17/XD99/XK99: Task 14. MDG file: Task 15.
  - Four-eyes, audit, sha256 and diff: Task 16. UI: Task 17.
  - Extends the remediation batch flow rather than `writeback.py`.
- **Known ceilings (marked `ponytail:` in code):**
  - The compressed parquet object is held in memory.
  - The parent lookup is held in memory.
  - Trailing-minus numbers are out of scope.
  - The MM17 key list is per business key, not per plant.
  - Value-map simulation fixes are not packaged.
  - SAP template names need a per-release check.
