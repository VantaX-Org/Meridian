# Match Pipeline Implementation Plan

> **Migration numbering (controller ruling):** this plan's migration is 073 (down_revision 072); read every 069 below as 073 and 068 as 072. Execution order: the three market-leader plans (migrations 069-072) land first, then this plan, then ownership and lineage. Run `alembic heads` before writing a migration and adjust if the head moved.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score near-duplicate business partners and materials on every analysis, so `match_scores` and the steward merge queue fill from real data instead of seed data. Candidate pairs come from the same blocking the similarity check already uses. Each pair is scored by the existing match engine. Pairs a steward marked `do_not_match` are never scored. The two old dedup paths (the `head(500)` loop and primary-key blocking) are removed.

**Architecture:**
- Data:
  - Migration 069 makes a pair unique per tenant and domain, whatever the key order: a unique expression index on `(tenant_id, domain, LEAST(a, b), GREATEST(a, b))` on `match_scores`. It first removes existing duplicate pairs (keeping a reviewed row) and the open merge-decision queue items those duplicates leave orphaned.
- Backend:
  - `checks/types/similarity_check.py` gains two module-level helpers, `blocks()` and `near_pairs()`. `SimilarityCheck.evaluate` is rewritten on top of them with unchanged output.
  - `api/services/match_engine._persist_score` becomes an upsert. A rescore updates an open pair in place, never touches a reviewed pair, and adds a `cleaning_queue` row only on first insert.
  - The new `workers/tasks/run_match.py` blocks, compares and scores one module's frame, seeds default match rules for a domain that has none, and enqueues `populate_queue` when it queued anything. `run_checks` fans it out next to `run_dedup`.
  - `cleaning_engine.detect_duplicates` keeps only exact primary-key duplicates. `mining/dedup.py` uses the shared blocking instead of primary-key blocking.
- Frontend: none. The existing steward merge queue reads `stewardship_queue`, which `populate_queue` fills from `match_scores`.

**Tech Stack:** FastAPI, SQLAlchemy `text()` SQL on Postgres with RLS, Alembic, Celery, pandas, difflib, pytest.

**Spec:** `docs/superpowers/specs/2026-10-10-monitoring-migration-breadth-design.md`, section 3a only (lines 110-131).

**Global constraints:**
- No `any` in TypeScript and no `Any` in new Python signatures. Narrow API data with types; do not use `as` casts on API data.
- Never add to the `lint:tokens` allowlist. Use design tokens only: `var(--m-ink)`, `var(--m-ink-2)`, `var(--m-ink-3)`, `var(--m-line)`, `var(--m-pass)`, `var(--m-critical)`, `var(--m-accent)`.
- No customer names in code, tests, fixtures or commit messages. Use neutral names such as `PRD`, `S4D` and `Wave 1`.
- Rule IDs are append-only. This plan adds no rules.
- Migration 069 revises `"068"` and must downgrade cleanly.
- Every new table gets tenant RLS (`ENABLE` + `FORCE` + a `tenant_id = current_setting('app.tenant_id')::uuid` policy), and every tenant-scoped ORM model needs an RLS migration (`tests/test_rls_conformance.py`). This plan adds no table, so `tests/test_rls_conformance.py` needs no change.
- Times shown to users are in SAST with the zone label. This plan adds no UI and no report times.
- The eslint copy rules apply. Do not use "Cancel", "Submit", "OK", "Error", "Loading", "dashboard", "click here", "Oops" or "Sorry" in UI copy. Verdict sentences end with a full stop.
- The UI uses Aurora (`@/design`) only. Import charts from `@/design`, never from `recharts`. Only `PageHeader` renders an `h1`.
- This spec section asks for no report, so this plan adds no Excel or PDF export.
- Implementers do not run `npm run build`.
- Backend test command: `python3 -m pytest <file> -q -p no:cacheprovider`. Postgres tests skip unless `MERIDIAN_TEST_DB_URL` is set. Run them with `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test`.
- Frontend gate, for every frontend task: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npm test`. `npm test` runs `vitest run`. This plan has no frontend task.
- Frontend tests live in `__tests__/` next to the file under test. Component tests use `renderWithQuery` from `@/__tests__/render`.
- Every commit message ends with exactly these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  ```

**Spec corrections (verified against the code at ab493477):**
1. **Fan-out line.** The `run_dedup` fan-out is in `workers/tasks/run_checks.py:870-883` (the mining `try` block), not line 828.
2. **The `head(500)` line.** The cap is `subset = df.head(500)` at `api/services/cleaning_engine.py:210`, inside "Phase 2" (lines 200-297) of `detect_duplicates`. Phase 1 (exact primary-key duplicates, lines 161-198) is not fuzzy matching and stays.
3. **`blocks()` does not exist yet.** `SimilarityCheck.evaluate` (`checks/types/similarity_check.py:37-71`) does blocking and comparison inline. Task 1 extracts both, so the match pipeline compares names exactly as the similarity rules do.
4. **No match rules on real tenants.** `score_candidate_pair` (`api/services/match_engine.py:98`) returns `dismissed` with no score row when a domain has no active `match_rules`. Only seeded tenants have rules, so the pipeline must seed defaults (Ruling 1).
5. **Duplicate pair rows.** `_persist_score` (`match_engine.py:195-252`) always inserts. Running the pipeline after every analysis would add one `match_scores` row and one `cleaning_queue` row per pair per run, and `populate_queue` would queue each copy. Task 2 adds the unique pair index and the upsert.
6. **Seed insert.** `db/seeds/seed_sap_emulator.py:1684` inserts `match_scores` with `ON CONFLICT (id) DO NOTHING`. Under the new unique index a duplicate seeded pair would raise. Task 2 changes it to `ON CONFLICT DO NOTHING`.
7. **Libraries stay.** `jellyfish` and `thefuzz` stay in `requirements.txt`: `match_engine.py:24,27` imports them. Only `cleaning_engine.py` drops its imports.

**Rulings (decisions this plan makes where the spec is silent):**
1. **Default match rules.** When a domain has no `match_rules` row, `run_match` seeds three: for business partners `BUT000.NAME_ORG1` `name_legal` 60 / 0.85, `ADRC.STREET` `address_tokens` 25 / 0.7, `ADRC.CITY1` `exact` 15 / 1.0; for materials `MAKT.MAKTX` `fuzzy` 70 / 0.85, `MARA.MEINS` `exact` 15 / 1.0, `MARA.MFRPN` `exact` 15 / 1.0. A tenant's own rules are never touched.
2. **Candidate threshold and block cap.** A pair is a candidate when the similarity-check name ratio is at least 0.8 (looser than the rules' 0.9, because the match engine decides the band). `max_block` is 300, the similarity check's default.
3. **Block keys.** Business partners block on `ADRC.COUNTRY` + `ADRC.POST_CODE1`; materials on `MARA.MATKL` + `MARA.MTART`. The name key is the similarity check's `_key` (legal forms removed, words sorted).
4. **Modules.** Only `business_partner` and `material_master` are matched. `employee_central` drops out of `run_dedup`; person matching is not in the spec.
5. **`run_dedup` stays.** It backs the Dedup page (`data_duplicates`). It now uses the same blocking and name comparison as `run_match`, so both pages show the same pairs.
6. **Unblocked records.** A record with a blank block field, a blank name or a name key under 5 characters cannot be blocked. It is counted in `records_not_blocked`, never as a pass.
7. **Identical primary keys** stay in `cleaning_engine` Phase 1 (`exact_pk`). `run_match` skips pairs with the same id.
8. **Reviewed pairs are final.** Migration 069 keeps the reviewed row of a duplicated pair. The upsert never overwrites a row with `reviewed_at` or `steward_decision` set.
9. **No semantic comparator** in the defaults: it calls the LLM per pair.
10. **Cross-system matching is deferred**, as the spec says. `run_match` matches within one analysed frame.
11. **Skip reporting.** `blocks_skipped_too_large`, `records_not_compared` and `records_not_blocked` go to the task result and the worker log. No table stores them; add one when a page needs them.
12. **Missing columns.** A module whose frame lacks the id, name or a block column is skipped with a reason, not failed.
13. **A rescore updates an open pair in place**, keeping its id, so its open stewardship item stays linked.

---

## File map

| File | Change | Task |
|---|---|---|
| `checks/types/similarity_check.py` | `blocks()`, `near_pairs()`; `evaluate` uses them | 1 |
| `tests/checks/test_group_checks.py` | `test_blocks_and_near_pairs_helpers` | 1 |
| `db/migrations/versions/069_match_scores_pair_unique.py` | new: duplicate cleanup, unique pair index | 2 |
| `db/schema.py` | `MatchScore.__table_args__` gains `uq_match_scores_pair` | 2 |
| `api/services/match_engine.py` | `_persist_score` upsert | 2 |
| `db/seeds/seed_sap_emulator.py` | `ON CONFLICT DO NOTHING` for `match_scores` | 2 |
| `tests/test_match_scores_pair_pg.py` | new: migration cleanup, upsert, reviewed rows | 2 |
| `workers/tasks/run_match.py` | new: `MATCH_KEYS`, `candidate_pairs`, `match_frame`, `run_match` task | 3 |
| `workers/tasks/run_checks.py` | fan out `run_match` next to `run_dedup` | 3 |
| `workers/celery_app.py` | register `run_match` | 3 |
| `tests/test_match_pipeline.py` | new: 10k synthetic rows, registration, Postgres scoring | 3 |
| `api/services/cleaning_engine.py` | remove the `head(500)` fuzzy loop | 4 |
| `tests/test_cleaning_engine.py` | `TestDetectDuplicates` rewritten | 4 |
| `workers/tasks/mining/dedup.py` | shared blocking replaces primary-key blocking | 4 |
| `tests/test_dedup_blocking.py` | rewritten | 4 |

---

### Task 1: Extract `blocks()` and `near_pairs()` from the similarity check

**Files:**
- Modify: `checks/types/similarity_check.py` (docstring lines 1-13, imports lines 15-20, `evaluate` lines 37-71)
- Test: `tests/checks/test_group_checks.py` (append)

**Interfaces:**
- Consumes: `checks.base.is_blank`, `checks.value_placement.name_key`, the module's `_key()`.
- Produces:
  - `blocks(df, field, block_by, max_block) -> tuple[list[pd.Index], list[pd.Index]]`: the kept blocks and the oversized blocks, in sorted block-key order. A record is in a block only when the name and every block field are populated and its `name_key` has at least 5 characters.
  - `near_pairs(df, field, groups, threshold, exact_elsewhere=False) -> list[tuple[Hashable, Hashable, float]]`: index pairs inside each group whose names score at least `threshold`, with the score (1.0 for identical compact keys).

- [ ] **Step 1: Write the failing test**

Append to `tests/checks/test_group_checks.py`:

```python
def test_blocks_and_near_pairs_helpers():
    from checks.types.similarity_check import blocks, near_pairs

    df = pd.DataFrame({
        "N": ["ACME ENGINEERING", "ACME ENGINERING", "OTHER THING", "ACME ENGINEERING",
              "PLANT ONE", "PLANT TWO", "PLANT SIX", "PLANT TEN", None, "AB"],
        "C": ["DE", "DE", "DE", "FR", "ZA", "ZA", "ZA", "ZA", "DE", "DE"],
    })
    kept, oversized = blocks(df, "N", ["C"], max_block=3)
    # Blank name (8) and a name key under 5 characters (9) are in no block.
    assert [list(g) for g in kept] == [[0, 1, 2], [3]]
    assert [list(g) for g in oversized] == [[4, 5, 6, 7]]

    pairs = near_pairs(df, "N", kept, 0.9)
    assert [(a, b) for a, b, _ in pairs] == [(0, 1)]  # same name in another country is another block
    assert 0.9 <= pairs[0][2] < 1.0
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `python3 -m pytest tests/checks/test_group_checks.py -q -p no:cacheprovider`
Expected: FAIL. `ImportError: cannot import name 'blocks' from 'checks.types.similarity_check'`.

- [ ] **Step 3: Implement**

In `checks/types/similarity_check.py`, append this sentence to the module docstring (after "...and are reported as skipped."):

```
``blocks()`` and ``near_pairs()`` are shared with the match pipeline
(workers/tasks/run_match.py), so a candidate pair there is found exactly as here.
```

Replace the imports (lines 15-20) with:

```python
from collections.abc import Hashable
from difflib import SequenceMatcher
from itertools import combinations

import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank
```

Add these two functions after `_key` (after line 27):

```python
def blocks(df: pd.DataFrame, field: str, block_by: list[str],
           max_block: int) -> tuple[list[pd.Index], list[pd.Index]]:
    """Group comparable records by ``block_by``. Returns (kept, oversized) blocks.

    A record is comparable when ``field`` and every block field are populated and its
    compact name key has at least 5 characters. Blocks larger than ``max_block`` are
    returned separately: their records are not compared, so callers report them."""
    from checks.value_placement import name_key
    populated = ~is_blank(df[field])
    for c in block_by:
        populated &= ~is_blank(df[c])
    scope = populated & (name_key(df[field]).fillna("").str.len() >= 5)
    group = (df[block_by].astype("string").apply(lambda s: s.str.strip().str.upper()).agg("|".join, axis=1)
             if block_by else pd.Series("", index=df.index))
    kept: list[pd.Index] = []
    oversized: list[pd.Index] = []
    for _, idx in group[scope].groupby(group[scope]).groups.items():
        (oversized if len(idx) > max_block else kept).append(idx)
    return kept, oversized


def near_pairs(df: pd.DataFrame, field: str, groups: list[pd.Index], threshold: float,
               exact_elsewhere: bool = False) -> list[tuple[Hashable, Hashable, float]]:
    """Index pairs inside each group whose names score >= ``threshold``.

    Names with different numbers never pair. Identical compact keys score 1.0, or are
    skipped when ``exact_elsewhere`` (an exact-duplicate rule reports them)."""
    from checks.value_placement import name_key
    key = _key(df[field])
    compact = name_key(df[field]).fillna("")  # the exact-duplicate rule's own key
    digits = key.str.replace(r"[^0-9]", "", regex=True)
    out: list[tuple[Hashable, Hashable, float]] = []
    for idx in groups:
        for a, b in combinations(idx, 2):
            ka, kb = compact[a], compact[b]
            if digits[a] != digits[b] or (ka == kb and exact_elsewhere):
                continue  # other numbers, other things; identical names: the exact rule's
            score = 1.0 if ka == kb else SequenceMatcher(None, key[a], key[b]).ratio()
            if score >= threshold:
                out.append((a, b, score))
    return out
```

Replace `evaluate` (lines 37-71) with:

```python
    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        r = self.rule
        threshold, max_block = float(r.get("threshold", 0.9)), int(r.get("max_block", 300))
        kept, oversized = blocks(df, r["field"], list(r.get("block_by") or []), max_block)
        # Records in an oversized block are not compared: unknown, not clean, so out of scope.
        scope = pd.Series(df.index.isin([i for g in kept for i in g]), index=df.index)
        failing = pd.Series(False, index=df.index)
        ev_col = r.get("evidence_key") or r["field"]  # evidence_key: show this column's values, not the compared (personal) field
        pairs: list[list[str]] = []
        for a, b, _ in near_pairs(df, r["field"], kept, threshold, bool(r.get("exact_rule"))):
            failing[a] = failing[b] = True
            if len(pairs) < 20:
                pairs.append([str(df.at[a, ev_col]), str(df.at[b, ev_col])])
        return Evaluation(scope, failing, {"near_duplicate_pairs": pairs,
                                           "blocks_skipped_too_large": len(oversized),
                                           "records_not_compared": sum(len(g) for g in oversized),
                                           "threshold": threshold})
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python3 -m pytest tests/checks/test_group_checks.py -q -p no:cacheprovider`
Expected: PASS (5). `test_similarity_check_finds_typos_not_variants` passes unchanged, which shows the rewrite keeps the rule's behaviour.

Run: `python3 -m pytest tests/checks -q -p no:cacheprovider -k "similar or ND or duplicate"`
Expected: PASS. No similarity rule proof changes.

- [ ] **Step 5: Commit**

```bash
git add checks/types/similarity_check.py tests/checks/test_group_checks.py
git commit -m "refactor(checks): extract blocks() and near_pairs() from the similarity check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 2: Migration 069: one `match_scores` row per pair, and the scoring upsert

**Files:**
- Create: `db/migrations/versions/069_match_scores_pair_unique.py`
- Modify: `db/schema.py`. Extend `MatchScore.__table_args__` (lines 1579-1582).
- Modify: `api/services/match_engine.py`. `_persist_score` (lines 195-252).
- Modify: `db/seeds/seed_sap_emulator.py:1684`
- Test: `tests/test_match_scores_pair_pg.py` (new)

**Interfaces:**
- Consumes: `match_scores`, `stewardship_queue` (`item_type = 'merge_decision'`, `source_id = match_scores.id`, written by `workers/tasks/populate_stewardship_queue.py:49-74`), `cleaning_queue`.
- Produces:
  - Unique index `uq_match_scores_pair` on `match_scores (tenant_id, domain, LEAST(candidate_a_key, candidate_b_key), GREATEST(candidate_a_key, candidate_b_key))`.
  - `_persist_score` upserts on that index. On insert it adds a `cleaning_queue` row when `auto_action == 'queued'`. On conflict it updates the open row in place (same id). A row with `reviewed_at` or `steward_decision` set is left unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/test_match_scores_pair_pg.py`:

```python
"""Migration 069 and the match_scores upsert: one row per pair, reviewed rows are final.

Runs with MERIDIAN_TEST_DB_URL. The app role is NOBYPASSRLS so the policy is really exercised.
"""

from __future__ import annotations

import os
import subprocess
import uuid

import pytest

_ROLE = "meridian_pair_app"
pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_RULES = [("BUT000.NAME_ORG1", "name_legal", 60, 0.85), ("ADRC.STREET", "address_tokens", 25, 0.7),
          ("ADRC.CITY1", "exact", 15, 1.0)]
_A = {"BUT000.NAME_ORG1": "ALPHA TRADING", "ADRC.STREET": "MAIN STREET 1", "ADRC.CITY1": "BERLIN"}
_B = {"BUT000.NAME_ORG1": "ALPHA TRADNG", "ADRC.STREET": "HARBOUR ROAD 9", "ADRC.CITY1": "BERLIN"}


def _alembic(*args: str) -> None:
    r = subprocess.run(["alembic", *args], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": os.environ["MERIDIAN_TEST_DB_URL"],
                            "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr


@pytest.fixture(scope="module")
def app_engine():
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    _alembic("upgrade", "head")
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": _ROLE}).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"{_ROLE}:pw@{u.hostname}:{u.port or 5432}",
                                    u.path, u.params, u.query, u.fragment)))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


def _tenant(owner) -> str:
    from sqlalchemy import text

    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"P-{tid[:8]}"})
    return tid


def _rules(owner, tid: str) -> None:
    from sqlalchemy import text

    with owner.begin() as c:
        for f, m, w, th in _RULES:
            c.execute(text("INSERT INTO match_rules (id, tenant_id, domain, field, match_type, weight, threshold) "
                           "VALUES (gen_random_uuid(), :t, 'business_partner', :f, :m, :w, :th)"),
                      {"t": tid, "f": f, "m": m, "w": w, "th": th})


def _count(owner, table: str, tid: str) -> int:
    from sqlalchemy import text

    with owner.begin() as c:
        return c.execute(text(f"SELECT COUNT(*) FROM {table} WHERE tenant_id = :t"), {"t": tid}).scalar()


@pg
def test_migration_keeps_one_row_per_pair_and_drops_orphaned_items(app_engine):
    from sqlalchemy import text

    owner, _app = app_engine
    _alembic("downgrade", "068")
    try:
        t = _tenant(owner)
        with owner.begin() as c:
            for a, b, reviewed in [("1", "2", False), ("2", "1", True), ("1", "2", False)]:
                sid = c.execute(text(
                    "INSERT INTO match_scores (id, tenant_id, candidate_a_key, candidate_b_key, domain, "
                    "total_score, auto_action, reviewed_at) VALUES (gen_random_uuid(), :t, :a, :b, "
                    "'business_partner', 0.7, 'queued', CASE WHEN :r THEN now() END) RETURNING id"),
                    {"t": t, "a": a, "b": b, "r": reviewed}).scalar()
                c.execute(text("INSERT INTO stewardship_queue (id, tenant_id, item_type, source_id, domain) "
                               "VALUES (gen_random_uuid(), :t, 'merge_decision', :s, 'business_partner')"),
                          {"t": t, "s": sid})
    finally:
        _alembic("upgrade", "head")
    with owner.begin() as c:
        rows = c.execute(text("SELECT candidate_a_key, reviewed_at IS NOT NULL AS reviewed FROM match_scores "
                              "WHERE tenant_id = :t"), {"t": t}).all()
        items = c.execute(text("SELECT COUNT(*) FROM stewardship_queue WHERE tenant_id = :t "
                               "AND source_id IN (SELECT id FROM match_scores)"), {"t": t}).scalar()
    assert [(r.candidate_a_key, r.reviewed) for r in rows] == [("2", True)]
    assert items == 1
    assert _count(owner, "stewardship_queue", t) == 1


@pg
def test_rescoring_a_pair_keeps_one_row_and_one_queue_entry(app_engine):
    from sqlalchemy.orm import Session

    from api.services.match_engine import score_candidate_pair

    owner, app = app_engine
    t = _tenant(owner)
    _rules(owner, t)
    with Session(app) as s:
        first = score_candidate_pair(t, "business_partner", _A, _B, "1", "2", s)
        score_candidate_pair(t, "business_partner", _B, _A, "2", "1", s)
    assert first["auto_action"] == "queued"
    assert _count(owner, "match_scores", t) == 1
    assert _count(owner, "cleaning_queue", t) == 1


@pg
def test_a_reviewed_pair_is_not_rescored(app_engine):
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from api.services.match_engine import score_candidate_pair

    owner, app = app_engine
    t = _tenant(owner)
    _rules(owner, t)
    with Session(app) as s:
        score_candidate_pair(t, "business_partner", _A, _B, "1", "2", s)
    with owner.begin() as c:
        c.execute(text("UPDATE match_scores SET reviewed_at = now(), steward_decision = 'reject', "
                       "total_score = 0.5 WHERE tenant_id = :t"), {"t": t})
    with Session(app) as s:
        score_candidate_pair(t, "business_partner", _A, _B, "1", "2", s)
    with owner.begin() as c:
        totals = c.execute(text("SELECT total_score FROM match_scores WHERE tenant_id = :t"), {"t": t}).scalars().all()
    assert totals == [0.5]
    assert _count(owner, "cleaning_queue", t) == 1
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_match_scores_pair_pg.py -q -p no:cacheprovider`
Expected: FAIL. The first test fails on `_alembic("downgrade", "068")` because 068 is head (or, if it gets that far, on 3 rows instead of 1); the second fails with `assert 2 == 1` on `match_scores`.

- [ ] **Step 3: Implement**

Create `db/migrations/versions/069_match_scores_pair_unique.py`:

```python
"""match_scores: one row per pair per tenant and domain

Revision ID: 069
Revises: 068
Create Date: 2026-10-10

The match pipeline rescores every pair on every analysis. A pair is the same pair in
either key order, so uniqueness is on LEAST/GREATEST of the two keys. Existing
duplicates are removed first, keeping a reviewed row (then the newest). Open
merge-decision queue items that pointed at a removed row are removed with it.
Both tables are FORCE RLS, so the cleanup runs with FORCE lifted for the owner.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "069"
down_revision: Union[str, None] = "068"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("match_scores", "stewardship_queue")


def upgrade() -> None:
    for t in _TABLES:
        op.execute(f"ALTER TABLE {t} NO FORCE ROW LEVEL SECURITY")
    op.execute("""
        DELETE FROM match_scores WHERE id IN (
            SELECT id FROM (
                SELECT id, row_number() OVER (
                    PARTITION BY tenant_id, domain,
                                 LEAST(candidate_a_key, candidate_b_key),
                                 GREATEST(candidate_a_key, candidate_b_key)
                    ORDER BY (reviewed_at IS NOT NULL) DESC, created_at DESC, id DESC) AS n
                FROM match_scores) d
            WHERE d.n > 1)
    """)
    op.execute("""
        DELETE FROM stewardship_queue
        WHERE item_type = 'merge_decision' AND status = 'open'
          AND source_id NOT IN (SELECT id FROM match_scores)
    """)
    for t in _TABLES:
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
    op.create_index("uq_match_scores_pair", "match_scores",
                    ["tenant_id", "domain", sa.text("LEAST(candidate_a_key, candidate_b_key)"),
                     sa.text("GREATEST(candidate_a_key, candidate_b_key)")], unique=True)


def downgrade() -> None:
    op.drop_index("uq_match_scores_pair", table_name="match_scores")
```

In `db/schema.py`, replace `MatchScore.__table_args__` (lines 1579-1582) with:

```python
    __table_args__ = (
        Index("ix_match_scores_tenant_domain", "tenant_id", "domain"),
        Index("ix_match_scores_tenant_action", "tenant_id", "auto_action"),
        Index("uq_match_scores_pair", "tenant_id", "domain",
              text("LEAST(candidate_a_key, candidate_b_key)"),
              text("GREATEST(candidate_a_key, candidate_b_key)"), unique=True),
    )
```

In `api/services/match_engine.py`, replace the body of `_persist_score` from `score_id = str(uuid.uuid4())` to `session.commit()` (lines 211-252) with:

```python
    score_id = str(uuid.uuid4())

    # One row per pair (migration 069). A rescore updates an open pair in place, so its
    # stewardship item stays linked; a reviewed pair is final and the WHERE leaves it alone.
    row = session.execute(
        text(
            "INSERT INTO match_scores "
            "(id, tenant_id, candidate_a_key, candidate_b_key, domain, "
            " total_score, field_scores, ai_semantic_score, auto_action, explanation) "
            "VALUES (:id, :tid, :a_key, :b_key, :domain, "
            " :total, CAST(:fs AS jsonb), :ai_score, :action, CAST(:ex AS jsonb)) "
            "ON CONFLICT (tenant_id, domain, (LEAST(candidate_a_key, candidate_b_key)), "
            " (GREATEST(candidate_a_key, candidate_b_key))) DO UPDATE SET "
            " total_score = EXCLUDED.total_score, field_scores = EXCLUDED.field_scores, "
            " ai_semantic_score = EXCLUDED.ai_semantic_score, auto_action = EXCLUDED.auto_action, "
            " explanation = EXCLUDED.explanation "
            "WHERE match_scores.reviewed_at IS NULL AND match_scores.steward_decision IS NULL "
            "RETURNING (xmax = 0) AS inserted"
        ),
        {
            "id": score_id,
            "tid": tenant_id,
            "a_key": candidate_a_key,
            "b_key": candidate_b_key,
            "domain": domain,
            "total": total_score,
            "fs": json.dumps(field_scores),
            "ai_score": ai_semantic_score,
            "action": auto_action,
            "ex": json.dumps(explanation) if explanation is not None else None,
        },
    ).first()
    inserted = bool(row and row.inserted)

    # Route new queued pairs to stewardship via cleaning_queue.
    # ponytail: a rescore that drops out of the review band leaves its open queue item;
    # resolve stale items in populate_queue if stewards start seeing them.
    if inserted and auto_action == "queued":
        queue_id = str(uuid.uuid4())
        session.execute(
            text(
                "INSERT INTO cleaning_queue "
                "(id, tenant_id, object_type, record_key, status, confidence, priority) "
                "VALUES (:id, :tid, :obj_type, :record_key, 'detected', :conf, 2)"
            ),
            {
                "id": queue_id,
                "tid": tenant_id,
                "obj_type": domain,
                "record_key": f"{candidate_a_key}|{candidate_b_key}",
                "conf": total_score,
            },
        )

    session.commit()
```

Update the docstring line of `_persist_score` (line 207) to:

```python
    """Upsert the pair's match_scores row; queue a new review-band pair in cleaning_queue."""
```

In `db/seeds/seed_sap_emulator.py`, in the `match_scores` insert (line 1684), change `ON CONFLICT (id) DO NOTHING` to `ON CONFLICT DO NOTHING`, so a seeded pair that repeats in the other key order is skipped instead of raising.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_match_scores_pair_pg.py -q -p no:cacheprovider`
Expected: PASS (3).

Run: `python3 -m pytest tests/test_match_engine.py tests/test_rls_conformance.py -q -p no:cacheprovider`
Expected: PASS. `dry_run=True` paths never reach `_persist_score`, and the conformance test sees no new table.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/versions/069_match_scores_pair_unique.py db/schema.py api/services/match_engine.py db/seeds/seed_sap_emulator.py tests/test_match_scores_pair_pg.py
git commit -m "feat(mdm): one match_scores row per pair; rescoring upserts and never touches reviewed pairs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 3: `run_match`: block, compare and score after every analysis

**Files:**
- Create: `workers/tasks/run_match.py`
- Modify: `workers/tasks/run_checks.py` (mining fan-out, lines 870-883)
- Modify: `workers/celery_app.py` (after line 54, the `mining.orchestrator` import)
- Test: `tests/test_match_pipeline.py` (new)

**Interfaces:**
- Consumes:
  - `checks.types.similarity_check.blocks`, `near_pairs` (Task 1).
  - `api.services.match_engine.score_candidate_pair(tenant_id, domain, candidate_a, candidate_b, candidate_a_key, candidate_b_key, session, dry_run=False)` (`match_engine.py:98`), with the Task 2 upsert.
  - `api.services.merge_explain.drop_blocked_pairs(candidates, blocked)` (`merge_explain.py:286`). Candidates are `{"category": "dedup", "record_key": "a|b", ...}`; `blocked` is a set of `(key_lo, key_hi)`.
  - `mdm_pair_constraints (tenant_id, domain, key_lo, key_hi, kind)`, `match_rules`.
  - `workers.dataset.load_module_frame(path, module)` (`workers/dataset.py:95`).
  - `workers.tasks.populate_stewardship_queue.populate_queue` (no arguments, line 265).
- Produces:
  - `MATCH_KEYS: dict[str, tuple[str, str, list[str]]]`: module to (id column, name column, block columns).
  - `candidate_pairs(df, module) -> tuple[list[tuple[Hashable, Hashable, float]], dict[str, int]]`. Stats keys: `compared`, `blocks_skipped_too_large`, `records_not_compared`, `records_not_blocked`.
  - `match_frame(df, module, tenant_id, session) -> dict`: `{"status": "skipped", "reason"}` or `{"status": "complete", <stats>, "candidates", "blocked", "scored", "queued"}`.
  - Celery task `workers.tasks.run_match.run_match(version_id, tenant_id, module, parquet_path) -> dict`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_match_pipeline.py`:

```python
"""Match pipeline: blocking finds planted duplicates at scale, scoring respects steward constraints.

The Postgres test runs with MERIDIAN_TEST_DB_URL. The app role is NOBYPASSRLS.
"""

from __future__ import annotations

import os
import random
import string
import subprocess
import uuid

import pandas as pd
import pytest

import workers.celery_app  # noqa: F401 — registers tasks, avoids the mining import cycle

_ROLE = "meridian_match_app"
pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_candidate_pairs_find_planted_duplicates_in_10k_rows():
    from workers.tasks.run_match import candidate_pairs

    rng = random.Random(7)

    def word(prefix: str) -> str:
        return prefix + "".join(rng.choice(string.ascii_uppercase) for _ in range(5))

    rows = [{"BUT000.PARTNER": str(100000 + i), "BUT000.NAME_ORG1": f"{word('A')} {word('B')} {word('C')}",
             "ADRC.COUNTRY": "DE", "ADRC.POST_CODE1": str(1000 + i % 1000)} for i in range(9599)]
    planted = set()
    for n, base in enumerate(rng.sample(rows, 100)):
        pid = str(200000 + n)
        rows.append({**base, "BUT000.PARTNER": pid, "BUT000.NAME_ORG1": base["BUT000.NAME_ORG1"][:-1]})
        planted.add(tuple(sorted((base["BUT000.PARTNER"], pid))))
    # One postcode with 301 records: over max_block, so reported and never compared.
    rows += [{"BUT000.PARTNER": str(300000 + i), "BUT000.NAME_ORG1": f"{word('A')} {word('B')} {word('C')}",
              "ADRC.COUNTRY": "DE", "ADRC.POST_CODE1": "9999"} for i in range(301)]
    df = pd.DataFrame(rows)
    assert len(df) == 10_000

    pairs, stats = candidate_pairs(df, "business_partner")
    found = {tuple(sorted((df.at[a, "BUT000.PARTNER"], df.at[b, "BUT000.PARTNER"]))) for a, b, _ in pairs}
    assert found == planted
    assert stats == {"compared": 9699, "blocks_skipped_too_large": 1, "records_not_compared": 301,
                     "records_not_blocked": 0}


def test_records_without_a_block_are_counted_not_passed():
    from workers.tasks.run_match import candidate_pairs

    df = pd.DataFrame({"BUT000.PARTNER": ["1", "2", "3"], "BUT000.NAME_ORG1": ["ALPHA TRADING", "ALPHA TRADNG", None],
                       "ADRC.COUNTRY": ["DE", None, "DE"], "ADRC.POST_CODE1": ["10115", "10115", "10115"]})
    pairs, stats = candidate_pairs(df, "business_partner")
    assert pairs == []
    assert stats["records_not_blocked"] == 2


def test_run_match_is_registered_and_fanned_out():
    from pathlib import Path

    assert "workers.tasks.run_match.run_match" in workers.celery_app.celery_app.tasks
    src = Path(_ROOT, "workers/tasks/run_checks.py").read_text()
    assert "run_match.delay(version_id, tenant_id, module_name, parquet_path)" in src


def test_unknown_module_and_missing_columns_are_skipped():
    from workers.tasks.run_match import match_frame

    df = pd.DataFrame({"BUT000.PARTNER": ["1"], "BUT000.NAME_ORG1": ["ALPHA TRADING"]})
    assert match_frame(df, "employee_central", str(uuid.uuid4()), None)["status"] == "skipped"
    out = match_frame(df, "business_partner", str(uuid.uuid4()), None)
    assert out == {"status": "skipped", "reason": "missing columns: ADRC.COUNTRY, ADRC.POST_CODE1"}


def _alembic(*args: str) -> None:
    r = subprocess.run(["alembic", *args], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": os.environ["MERIDIAN_TEST_DB_URL"],
                            "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr


@pytest.fixture(scope="module")
def app_engine():
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    _alembic("upgrade", "head")
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": _ROLE}).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"{_ROLE}:pw@{u.hostname}:{u.port or 5432}",
                                    u.path, u.params, u.query, u.fragment)))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


@pg
def test_match_frame_seeds_rules_skips_blocked_pairs_and_is_rerunnable(app_engine):
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from workers.tasks.run_match import match_frame

    owner, app = app_engine
    t = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": t, "n": f"M-{t[:8]}"})
        c.execute(text("INSERT INTO mdm_pair_constraints (id, tenant_id, domain, key_lo, key_hi, kind) "
                       "VALUES (gen_random_uuid(), :t, 'business_partner', '3', '4', 'do_not_match')"), {"t": t})
    df = pd.DataFrame(
        [["1", "ALPHA TRADING", "DE", "10115", "MAIN STREET 1", "BERLIN"],
         ["2", "ALPHA TRADNG", "DE", "10115", "HARBOUR ROAD 9", "BERLIN"],
         ["3", "BETA SUPPLIES", "DE", "10115", None, None],
         ["4", "BETA SUPPLIE", "DE", "10115", None, None]],
        columns=["BUT000.PARTNER", "BUT000.NAME_ORG1", "ADRC.COUNTRY", "ADRC.POST_CODE1", "ADRC.STREET",
                 "ADRC.CITY1"])

    with Session(app) as s:
        out = match_frame(df, "business_partner", t, s)
    assert (out["status"], out["candidates"], out["blocked"], out["scored"], out["queued"]) == ("complete", 2, 1, 1, 1)

    with Session(app) as s:
        again = match_frame(df, "business_partner", t, s)
    assert again["scored"] == 1

    with owner.begin() as c:
        def count(table: str) -> int:
            return c.execute(text(f"SELECT COUNT(*) FROM {table} WHERE tenant_id = :t"), {"t": t}).scalar()
        assert count("match_rules") == 3
        assert count("match_scores") == 1
        assert count("cleaning_queue") == 1
        keys = c.execute(text("SELECT candidate_a_key, candidate_b_key FROM match_scores WHERE tenant_id = :t"),
                         {"t": t}).one()
    assert tuple(keys) == ("1", "2")
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_match_pipeline.py -q -p no:cacheprovider`
Expected: FAIL. `ModuleNotFoundError: No module named 'workers.tasks.run_match'`.

- [ ] **Step 3: Implement**

Create `workers/tasks/run_match.py`:

```python
"""Match pipeline: block, compare and score near-duplicate master records.

Fanned out from run_checks next to run_dedup, once per analysed module. Candidate
pairs come from the similarity check's own blocking and name comparison
(checks.types.similarity_check.blocks / near_pairs). Each pair is scored by
match_engine.score_candidate_pair, which upserts match_scores and queues the review
band; populate_queue then turns queued pairs into steward merge decisions. Pairs a
steward marked do_not_match are never scored. Records that cannot be blocked or sit
in an oversized block are reported in the result, never counted as distinct.
Cross-system matching is not done here: one run matches one analysed frame.
"""

import logging
from collections.abc import Hashable
from typing import Optional

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from checks.types.similarity_check import blocks, near_pairs
from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.run_match")

# module: (id column, name column, block-by columns)
MATCH_KEYS: dict[str, tuple[str, str, list[str]]] = {
    "business_partner": ("BUT000.PARTNER", "BUT000.NAME_ORG1", ["ADRC.COUNTRY", "ADRC.POST_CODE1"]),
    "material_master": ("MARA.MATNR", "MAKT.MAKTX", ["MARA.MATKL", "MARA.MTART"]),
}
CANDIDATE_THRESHOLD = 0.8  # looser than the similarity rules' 0.9: the match engine sets the band
MAX_BLOCK = 300
# Seeded only for a domain with no match_rules at all: (field, match_type, weight, threshold).
DEFAULT_RULES: dict[str, list[tuple[str, str, int, float]]] = {
    "business_partner": [("BUT000.NAME_ORG1", "name_legal", 60, 0.85),
                         ("ADRC.STREET", "address_tokens", 25, 0.7),
                         ("ADRC.CITY1", "exact", 15, 1.0)],
    "material_master": [("MAKT.MAKTX", "fuzzy", 70, 0.85),
                        ("MARA.MEINS", "exact", 15, 1.0),
                        ("MARA.MFRPN", "exact", 15, 1.0)],
}

_SEED_RULES = text("""
    INSERT INTO match_rules (id, tenant_id, domain, field, match_type, weight, threshold, active)
    SELECT gen_random_uuid(), CAST(:tid AS uuid), :d, u.f, u.m, u.w, u.t, true
    FROM unnest(CAST(:f AS text[]), CAST(:m AS text[]), CAST(:w AS int[]), CAST(:t AS float8[])) AS u(f, m, w, t)
    WHERE NOT EXISTS (SELECT 1 FROM match_rules WHERE tenant_id = CAST(:tid AS uuid) AND domain = :d)
""")
_DO_NOT_MATCH = text("""
    SELECT key_lo, key_hi FROM mdm_pair_constraints
    WHERE tenant_id = CAST(:tid AS uuid) AND domain = :d AND kind = 'do_not_match'
""")


def candidate_pairs(df: pd.DataFrame,
                    module: str) -> tuple[list[tuple[Hashable, Hashable, float]], dict[str, int]]:
    """Index pairs whose names are near inside a block, plus what could not be compared."""
    _, name_col, block_by = MATCH_KEYS[module]
    kept, oversized = blocks(df, name_col, block_by, MAX_BLOCK)
    compared = sum(len(g) for g in kept)
    not_compared = sum(len(g) for g in oversized)
    return near_pairs(df, name_col, kept, CANDIDATE_THRESHOLD), {
        "compared": compared,
        "blocks_skipped_too_large": len(oversized),
        "records_not_compared": not_compared,
        "records_not_blocked": len(df) - compared - not_compared,
    }


def _record(row: pd.Series) -> dict:
    """Row as plain Python values for scoring (NaN to None, numpy scalars to Python)."""
    return {k: None if pd.isna(v) else (v.item() if hasattr(v, "item") else v) for k, v in row.items()}


def match_frame(df: pd.DataFrame, module: str, tenant_id: str, session: Optional[Session]) -> dict:
    """Score one module's candidate pairs into match_scores. ``session`` may be None only
    when the module is skipped (no DB work happens before the column checks)."""
    from api.services.match_engine import score_candidate_pair
    from api.services.merge_explain import drop_blocked_pairs

    if module not in MATCH_KEYS:
        return {"status": "skipped", "reason": f"no match keys for {module}"}
    id_col, name_col, block_by = MATCH_KEYS[module]
    missing = [c for c in (id_col, name_col, *block_by) if c not in df.columns]
    if missing:
        return {"status": "skipped", "reason": f"missing columns: {', '.join(missing)}"}
    assert session is not None

    session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
    # ponytail: two first runs at once can both seed; duplicate rules only double-weight
    # equally. Add a unique (tenant_id, domain, field) key if that ever happens.
    f, m, w, t = (list(x) for x in zip(*DEFAULT_RULES[module]))
    session.execute(_SEED_RULES, {"tid": tenant_id, "d": module, "f": f, "m": m, "w": w, "t": t})
    blocked = {(r.key_lo, r.key_hi) for r in session.execute(_DO_NOT_MATCH, {"tid": tenant_id, "d": module})}
    session.commit()

    pairs, stats = candidate_pairs(df, module)
    candidates = []
    for a, b, _ in pairs:
        ida, idb = str(df.at[a, id_col]), str(df.at[b, id_col])
        if ida != idb:  # identical keys are cleaning_engine's exact_pk duplicates
            candidates.append({"category": "dedup", "record_key": f"{ida}|{idb}", "a": a, "b": b})
    to_score = drop_blocked_pairs(candidates, blocked)

    queued = 0
    for c in to_score:
        ida, _, idb = c["record_key"].partition("|")
        res = score_candidate_pair(tenant_id, module, _record(df.loc[c["a"]]), _record(df.loc[c["b"]]),
                                   ida, idb, session, dry_run=False)
        queued += res["auto_action"] == "queued"
    return {"status": "complete", **stats, "candidates": len(candidates),
            "blocked": len(candidates) - len(to_score), "scored": len(to_score), "queued": queued}


@celery_app.task(bind=True, name="workers.tasks.run_match.run_match",
                 soft_time_limit=1800, time_limit=2100)
def run_match(self, version_id: str, tenant_id: str, module: str, parquet_path: str) -> dict:
    """Score one analysed module's near-duplicate pairs and refresh the steward queue."""
    from workers.dataset import load_module_frame
    from workers.tasks.populate_stewardship_queue import populate_queue

    if module not in MATCH_KEYS:
        return {"version_id": version_id, "module": module, "status": "skipped"}
    df = load_module_frame(parquet_path, module)
    with Session(get_sync_engine()) as session:
        result = match_frame(df, module, tenant_id, session)
    logger.info("run_match version_id=%s module=%s result=%s", version_id, module, result)
    if result.get("queued"):
        populate_queue.delay()
    return {"version_id": version_id, "module": module, **result}
```

In `workers/tasks/run_checks.py`, replace the mining block (lines 864-883) with:

```python
        # Enqueue mining — dedup / match / anomaly / relationship (non-blocking).
        # Mirrors the run_cleaning fan-out: each module's mining runs against
        # the same uploaded parquet and writes data_duplicates / match_scores /
        # data_anomalies / data_relationships, which back the Dedup, merge queue,
        # Mining and Relationships pages. run_match returns at once for modules
        # it does not match. Failure is non-fatal — it must never block analysis completion.
        try:
            from workers.tasks.mining.dedup import run_dedup
            from workers.tasks.mining.anomaly import run_anomaly
            from workers.tasks.mining.relationship import run_relationship
            from workers.tasks.run_match import run_match
            for module_name in data_modules:
                run_dedup.delay(version_id, tenant_id, module_name, parquet_path)
                run_match.delay(version_id, tenant_id, module_name, parquet_path)
                run_anomaly.delay(version_id, tenant_id, module_name, parquet_path)
                run_relationship.delay(version_id, tenant_id, module_name, parquet_path)
            logger.info(
                f"Enqueued mining (dedup/match/anomaly/relationship) for "
                f"version_id={version_id}, modules={modules}"
            )
        except Exception as e:
            logger.warning(f"Failed to enqueue mining tasks (non-fatal): {e}")
```

In `workers/celery_app.py`, after line 54 (`import workers.tasks.mining.orchestrator ...`), add:

```python
import workers.tasks.run_match  # noqa: F401 — match pipeline → match_scores
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `MERIDIAN_TEST_DB_URL=postgresql://meridian_test:meridian_test@localhost:5432/meridian_test python3 -m pytest tests/test_match_pipeline.py -q -p no:cacheprovider`
Expected: PASS (5).

Run: `python3 -m pytest tests/test_run_checks.py -q -p no:cacheprovider`
Expected: PASS. The fan-out is inside the existing non-fatal `try`.

- [ ] **Step 5: Commit**

```bash
git add workers/tasks/run_match.py workers/tasks/run_checks.py workers/celery_app.py tests/test_match_pipeline.py
git commit -m "feat(mdm): run_match scores blocked near-duplicate pairs after every analysis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

### Task 4: Remove the two old dedup paths

**Files:**
- Modify: `api/services/cleaning_engine.py` (docstring line 3, imports lines 10 and 12, `_TAX_COLS` and `_BANK_ACCT_COLS` lines 50-51, `detect_duplicates` docstring line 157 and Phase 2 lines 200-297)
- Modify: `workers/tasks/mining/dedup.py` (docstring lines 1-7, `import hashlib`, `BLOCKING_KEYS`, `_compute_record_hash`, `_find_potential_duplicates`, `_get_id_column`, `_compute_match_score`)
- Test: `tests/test_cleaning_engine.py` (`TestDetectDuplicates`, lines 19-39), `tests/test_dedup_blocking.py` (rewritten)

**Interfaces:**
- Consumes: `workers.tasks.run_match.MATCH_KEYS`, `candidate_pairs` (Task 3).
- Produces:
  - `CleaningEngine.detect_duplicates` returns exact primary-key duplicates only (`match_method == "exact_pk"`).
  - `_find_potential_duplicates(df, module) -> list[dict]` keeps its output keys (`record_a`, `record_b`, `match_score`, `blocking_key`, `module`, `id_field`, `matched_fields`) and returns `[]` for modules outside `MATCH_KEYS` or frames without the columns. `blocking_key` is the readable block value (`"DE|10115"`), not an MD5 hash.

- [ ] **Step 1: Write the failing test**

In `tests/test_cleaning_engine.py`, replace `test_exact_match_on_email` (lines 20-30) with these two tests, and keep `test_no_duplicates`:

```python
    def test_exact_primary_key_duplicates(self, engine):
        df = pd.DataFrame({
            "partner": ["BP001", "BP001", "BP002"],
            "name": ["Acme Trading", "Acme Trading", "Zeta Holdings"],
        })
        results = engine.detect_duplicates(df, "business_partner", VERSION_ID, TENANT_ID)
        assert [(r["record_key"], r["match_method"], r["category"]) for r in results] == [
            ("BP001|BP001_dup1", "exact_pk", "dedup")]

    def test_near_names_are_left_to_the_match_pipeline(self, engine):
        df = pd.DataFrame({
            "partner": ["BP001", "BP002", "BP003"],
            "name": ["Acme Trading Pty Ltd", "Acme Trading (Pty) Ltd", "Unrelated Corp"],
            "email": ["info@acme.co.za", "info@acme.co.za", "other@test.com"],
        })
        assert engine.detect_duplicates(df, "business_partner", VERSION_ID, TENANT_ID) == []
```

Replace the whole of `tests/test_dedup_blocking.py` with:

```python
import pandas as pd

import workers.celery_app  # noqa: F401 — registers tasks, avoids the mining import cycle
from workers.tasks.mining.dedup import _find_potential_duplicates

_COLS = ["BUT000.PARTNER", "BUT000.NAME_ORG1", "ADRC.COUNTRY", "ADRC.POST_CODE1"]


def test_near_names_in_one_block_pair_up():
    df = pd.DataFrame([["1", "ALPHA TRADING", "DE", "10115"], ["2", "ALPHA TRADNG", "DE", "10115"],
                       ["3", "GAMMA METALS", "DE", "10115"]], columns=_COLS)
    dups = _find_potential_duplicates(df, "business_partner")
    assert [(d["record_a"], d["record_b"]) for d in dups] == [("1", "2")]
    assert (dups[0]["blocking_key"], dups[0]["id_field"], dups[0]["module"]) == (
        "DE|10115", "BUT000.PARTNER", "business_partner")
    assert 0.8 <= dups[0]["match_score"] < 1.0
    assert "ADRC.POST_CODE1" in dups[0]["matched_fields"]


def test_other_postcodes_are_other_blocks():
    df = pd.DataFrame([["1", "ALPHA TRADING", "DE", "10115"], ["2", "ALPHA TRADNG", "DE", "80331"]], columns=_COLS)
    assert _find_potential_duplicates(df, "business_partner") == []


def test_modules_without_match_keys_are_skipped():
    df = pd.DataFrame({"empemployment.userId": ["U1", "U1"], "empemployment.startDate": ["2020-01-01"] * 2})
    assert _find_potential_duplicates(df, "employee_central") == []
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `python3 -m pytest tests/test_cleaning_engine.py tests/test_dedup_blocking.py -q -p no:cacheprovider`
Expected: FAIL. `test_near_names_are_left_to_the_match_pipeline` gets one fuzzy result; `test_near_names_in_one_block_pair_up` gets `[]` (no `BUT000.BU_TYPE` column, so primary-key blocking finds nothing); `test_modules_without_match_keys_are_skipped` gets one pair from the `employee_central` blocking keys.

- [ ] **Step 3: Implement**

In `api/services/cleaning_engine.py`:

1. Replace docstring line 3 (`Uses jellyfish for fuzzy string matching, thefuzz for token overlap.`) with `Near-duplicate records are scored by the match pipeline (workers/tasks/run_match.py).`
2. Delete `import jellyfish` (line 10) and `from thefuzz import fuzz` (line 12).
3. Delete `_TAX_COLS` and `_BANK_ACCT_COLS` (lines 50-51). Phase 2 is their only user (lines 203-204).
4. Replace the `detect_duplicates` docstring (line 157) with:

```python
        """Category 1: exact primary-key duplicates. Near-duplicates are scored by the
        match pipeline (workers/tasks/run_match.py), which blocks the whole frame."""
```

5. Delete Phase 2: from the comment `# Phase 2: Fuzzy matching on name/email/tax/bank (O(n^2), capped at 500 rows)` (line 200) to the end of its loop (line 295), so the method ends with Phase 1 followed by:

```python
        return results
```

Keep `_EMAIL_COLS` and `_record_key`: other categories use them (lines 358 and 411 onwards).

In `workers/tasks/mining/dedup.py`, replace lines 1-122 (docstring through `_get_matched_fields`) with:

```python
"""Deduplication mining task — near-duplicate pairs for the Dedup page (data_duplicates).

Pairs come from the match pipeline's blocking (workers/tasks/run_match.py): the same
block keys and name comparison as the similarity rules, so the Dedup page and the
steward merge queue show the same pairs. Modules the match pipeline does not cover
produce no pairs. Exact primary-key duplicates are cleaning_engine's exact_pk.
"""

import logging
from typing import Optional

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.mining.dedup")


def _find_potential_duplicates(df: pd.DataFrame, module: str) -> list[dict]:
    """Near-duplicate pairs within each block.

    Returns list of {record_a, record_b, match_score, blocking_key, module, id_field, matched_fields}.
    """
    from workers.tasks.run_match import MATCH_KEYS, candidate_pairs

    if module not in MATCH_KEYS:
        return []
    id_col, name_col, block_by = MATCH_KEYS[module]
    if any(c not in df.columns for c in (id_col, name_col, *block_by)):
        return []
    pairs, _ = candidate_pairs(df, module)
    out = []
    for a, b, score in pairs:
        ra, rb = df.loc[a].to_dict(), df.loc[b].to_dict()
        if str(ra[id_col]) == str(rb[id_col]):
            continue
        out.append({
            "record_a": str(ra[id_col]),
            "record_b": str(rb[id_col]),
            "match_score": round(score, 2),
            "blocking_key": "|".join(str(ra[c]).strip().upper() for c in block_by),
            "module": module,
            "id_field": id_col,
            "matched_fields": _get_matched_fields(ra, rb),
        })
    return out


def _get_matched_fields(record_a: dict, record_b: dict) -> list[str]:
    """Get list of fields that match between two records."""
    matches = []
    common_keys = set(record_a.keys()) & set(record_b.keys())
    for key in common_keys:
        if str(record_a.get(key, "")) == str(record_b.get(key, "")):
            matches.append(key)
    return matches
```

The `run_dedup` task (from line 125) is unchanged.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python3 -m pytest tests/test_cleaning_engine.py tests/test_dedup_blocking.py tests/test_match_pipeline.py -q -p no:cacheprovider`
Expected: PASS. `test_cleaning_engine.py` keeps all other categories green; the Postgres test in `test_match_pipeline.py` skips without `MERIDIAN_TEST_DB_URL`.

Run: `grep -rn "BLOCKING_KEYS\|_compute_record_hash\|_compute_match_score\|_get_id_column\|_TAX_COLS\|_BANK_ACCT_COLS" --include=*.py .`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add api/services/cleaning_engine.py workers/tasks/mining/dedup.py tests/test_cleaning_engine.py tests/test_dedup_blocking.py
git commit -m "refactor(mdm): drop the head(500) fuzzy loop and primary-key dedup blocking for the shared blocking

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Self-review against spec section 3a

| Spec item | Where | Status |
|---|---|---|
| Problem: `head(500)` fuzzy loop in cleaning_engine | Task 4 removes Phase 2 | covered |
| Problem: mining/dedup.py blocks on the primary key | Task 4 replaces it with `candidate_pairs` | covered |
| Problem: match_engine only called by `/match-rules/simulate` | Task 3 `match_frame` calls `score_candidate_pair(dry_run=False)` | covered |
| Problem: `match_scores` holds seed data only, merge queue empty | Task 3 (scores, `populate_queue.delay()`), Task 2 (one row per pair), Ruling 1 (default rules) | covered |
| Build 1: new `workers/tasks/run_match.py`, fanned out next to `run_dedup` | Task 3 (`run_checks.py:870-883`, Correction 1) | covered |
| Build 2: shared `blocks()` from `similarity_check.py` | Task 1 | covered |
| Build 2: BP name key + country + postcode | `MATCH_KEYS["business_partner"]`, Task 3 | covered |
| Build 2: materials name key + material group + type | `MATCH_KEYS["material_master"]`, Task 3 | covered |
| Build 2: `max_block` cap; skipped records reported, never passes | `blocks()` returns oversized blocks; stats in Task 3; `evaluate` keeps them out of scope (Task 1) | covered |
| Build 3: `score_candidate_pair(dry_run=False)` persists `match_scores` | Task 3, with the Task 2 upsert | covered |
| Build 4: respect `mdm_pair_constraints` via `drop_blocked_pairs` | Task 3, tested with a `do_not_match` pair | covered |
| Build 5: remove both old dedup paths | Task 4 | covered |
| Build 6: defer cross-system matching | Ruling 10; module docstring of `run_match.py` | covered (deferred) |
| Tests: `tests/test_match_pipeline.py`, 10k synthetic rows, planted duplicates | Task 3 (9,599 + 100 planted + 301 in one oversized block) | covered |
| Tests: update `test_dedup_blocking.py` | Task 4 | covered |

**Placeholder scan.** Searched the plan for "TBD", "TODO", "similar to Task", "fill in", "etc." and "...". None in steps or code. Every step that changes code shows the full replacement text, and every run step names its command and expected result.

**Type-consistency check.**
- `blocks()` returns `tuple[list[pd.Index], list[pd.Index]]`. Task 1 `evaluate`, Task 3 `candidate_pairs` and the Task 1 test all unpack `kept, oversized`.
- `near_pairs()` returns `list[tuple[Hashable, Hashable, float]]`. Task 3 unpacks `a, b, _`. Task 4 unpacks `a, b, score` through `candidate_pairs`.
- `MATCH_KEYS[module]` is `(id_col, name_col, block_by)` in Task 3 `candidate_pairs`, `match_frame` and Task 4 `_find_potential_duplicates`.
- `candidate_pairs` stats keys (`compared`, `blocks_skipped_too_large`, `records_not_compared`, `records_not_blocked`) match the Task 3 test's dict literal.
- `match_frame` result keys (`status`, `candidates`, `blocked`, `scored`, `queued`) match the Task 3 Postgres test. The skipped shape `{"status", "reason"}` matches `test_unknown_module_and_missing_columns_are_skipped`, including the joined missing-column text.
- `drop_blocked_pairs` receives `{"category": "dedup", "record_key": "a|b"}` and a set of `(key_lo, key_hi)` tuples, as `merge_explain.py:286-291` reads them.
- `score_candidate_pair` positional order `(tenant_id, domain, candidate_a, candidate_b, candidate_a_key, candidate_b_key, session)` matches `match_engine.py:98-106` in Tasks 2 and 3.
- The `ON CONFLICT` target expressions in `_persist_score` are character-for-character the index expressions in migration 069 and `MatchScore.__table_args__`.
- Migration chain: 069 `down_revision = "068"`. The Task 2 test downgrades to `"068"` and upgrades `head`.
