# Analysis throughput: the lifecycle step is the wall

A full analysis of a pilot customer's sandbox currently cannot finish inside the worker's
time limit. This records what was measured, what it blocks, and the concrete place
to look next, so it is not rediscovered from scratch.

## What was observed

On 2026-10-15, on the Meridian deployment (`meridiansrv`, 8-core Xeon, 30 GB):

| run | objects | checks | `record_issues` step | outcome |
|---|---|---|---|---|
| `b901357e` material_master | 1 | 615 ran / 91 skipped | **skipped** — "not the newest run" | `agents_complete`, complete scores |
| `c4d1cba0` ECC 4-module | 4 (BP, AP, AR, fi_gl) | all 4 modules checked | **killed at the 6 h limit** (2.78 M issues in scope) | `partial`, but per-module scores preserved by the checkpoint |
| `70afeca6` SuccessFactors | 9 | all 9 modules checked | **~2 minutes** (235 K failing records) | `agents_complete`, complete scores |

So this is **not** a wall every run hits: SuccessFactors completed the same step in
about two minutes. What differs is the size of `record_issues` in the system's scope
(ECC carries ~2.8 M rows). The cost scales with that table, so it grows as more
objects are analysed — the ECC system is simply the first to reach the limit.

The ECC 4-module run checked all four modules in ~14 minutes, then spent **5 h 50 m**
inside `api/services/record_issues.py::track`, was killed by
`MERIDIAN_CHECKS_TIME_LIMIT` (21600 s), and left its SQL running as an orphan for a
further 30 minutes until it was terminated by hand.

material_master looked fast only because it ran *second*: by the time it finalised,
a newer run of the same system existed, so `track` returned early with
`lifecycle: skipped (not the newest run)`. The expensive path had never completed.

## Why it is expensive

`track` does three set-based passes over the version's records, and the cost is
dominated by two things:

1. **`tmp_present` holds every present record of the run**, and the resolved/reopened
   joins probe it per `record_issues` row. `record_issues` held **2.78 M rows**; this
   run added **333 K** failing records, and the material_master run had left
   **1.94 M** in `finding_records` (2.51 M rows in that table).

   The code already knows this shape — there is a comment at the index it creates:

   > the resolved/reopened semi-joins probe tmp_present per record_issues row; without
   > an index that is a 2.6M × ~60M sequential scan (the run hung ~1.5 h here)

   So the index that was added moved this from "hangs on a sequential scan" to
   "runs for hours".

2. **The "mark resolved" pass rewrites every non-resolved issue row**, not only the
   ones that changed:

   ```sql
   UPDATE record_issues ri
      SET status = 'resolved', resolution = 'verified_fixed', ...
    WHERE ri.tenant_id = :tid AND ri.scope = :scope AND ri.status <> 'resolved'
      AND NOT EXISTS (SELECT 1 FROM finding_records fr WHERE fr.version_id = :vid
                        AND fr.check_id = ri.check_id AND fr.record_key = ri.record_key)
      AND ri.check_id IN (SELECT check_id FROM ran)
      AND EXISTS (SELECT 1 FROM tmp_present tp ...)
   ```

   Every row the planner cannot prove is excluded produces a new row version and a
   `record_issue_events` insert. Those become dead tuples: `record_issues` was left
   with **333,288 dead tuples and zero live ones under the stats snapshot**, and
   `record_issue_events` was empty — the work was rolled back when the task was
   killed, so nothing was gained.

## Re-measurement after the batching and bounding fixes (2026-11-04)

Commits `3b5bca1a` (bound `tmp_present` by open issues) and `7ef114d2` (reconcile in record-volume batches)
were never measured at the scale above. `scripts/bench_lifecycle_scale.py` now does that: it seeds a throwaway
Postgres with synthetic issues, runs the real `record_issues.track` (nothing reimplemented; the script only
times the real statements and functions), and checks the created, reopened and resolved counts against what it
seeded. Every run below returned the expected counts.

Setup: Apple M5 Pro laptop (15 logical CPUs, 24 GB RAM), Postgres 16 (`postgres:16-alpine`) in Docker Desktop
with a 3.8 GB VM, `shared_buffers=1GB`, `work_mem=64MB`, schema from `alembic upgrade head`. Scenario per 100
issues of a check: 65 keep failing, 30 are fixed and resolve, 5 were resolved and fail again, plus 5 new records.
One run per size, so no variance is known.

| issues in scope | checks | batches | `track` total | upsert | resolve sweep | reopened sweep | copy + index `tmp_present` | events written |
|---|---|---|---|---|---|---|---|---|
| 100,000 | 2 | 1 | 3.4 s | 1.8 s | 1.0 s | 0.1 s | 0.2 s | 35,000 |
| 1,000,000 | 20 | 4 | 48.0 s | 23.5 s | 12.5 s | 2.1 s | 6.8 s | 350,000 |
| 2,800,000 | 56 | 12 | 204.0 s (3 min 24 s) | 66.7 s | 42.9 s | 18.4 s | 64.2 s | 980,000 |

At 2.8 million issues (2.1 million failing in the new run) the lifecycle finished in about 3.4 minutes, against
the 6 hour wall recorded on 2026-10-15. Client memory peaked at 2.0 GB; `record_issues` was 2.9 GB with its
indexes, with 2.17 million dead tuples left for autovacuum.

What this does not show. It is a synthetic run on one laptop, not a production run and not the customer ECC
4-module analysis: no customer data, no concurrent users or workers, no row-level security (the role owns the
tables), no exported fix batches for `remediation.reconcile` to reconcile (it cost nothing here), one key layout,
and issue keys that are unique per check. The 2026-10-15 figure came from a 30 GB Xeon with real key
distributions and 100 million evaluated keys, so the two numbers must not be read as a speedup factor. What it
does show is that the lifecycle finishes at 2.8 million issues when about 2.9 million keys are evaluated. It says
nothing yet about 100 million evaluated keys, which only the real re-run can settle. Cost grows a little worse than linearly (about 34 s per 1M issues at 100k, 48 s at 1M, 73 s at 2.8M).

Bottleneck, confirmed and fixed. Copy and index of `tmp_present` rose from 14% of the run at 1M to 31% at 2.8M.
Reading `track` suggested that every batch of checks sharing a key layout copied the whole layout's open-issue
key list. Counting the rows handed to `_copy` per batch confirmed it: at 1M issues each of the 4 batches copied
950,000 rows (3.8M in total), and at 2.8M each of the 12 batches copied 2,660,000 rows (31.92M in total), which is
every open issue in scope every time. `track` now keeps, for each batch, only the layout keys that have an open
issue under one of that batch's own checks (one extra query per batch, bounded by that batch's issues). A key
that is open under checks in two different batches still goes to both, so the sweeps see the same rows as
before and the created, reopened and resolved counts did not change.

Before and after, same container and settings as above (`shared_buffers=1GB`, `work_mem=64MB`), one run each,
2026-11-04 on the same laptop. The "before" 1M column is the first run on this container and differs from the
table above (48.0 s) by run-to-run noise, which is the reason to read the stage rows rather than the totals.

| | 1M before | 1M after | 2.8M before | 2.8M after |
|---|---|---|---|---|
| rows copied into `tmp_present`, all batches | 3,800,000 | 950,000 | 31,920,000 | 2,660,000 |
| copy `tmp_present` | 2.1 s | 0.6 s | 17.2 s | 1.6 s |
| index `tmp_present` | 4.7 s | 1.0 s | 41.8 s | 2.9 s |
| load open issue keys (now per batch too) | 0.2 s | 0.5 s | 0.6 s | 3.1 s |
| `track` total | 42.5 s | 38.8 s | 205.7 s | 156.7 s |
| client peak memory | 0.96 GB | 0.95 GB | 2.68 GB | 1.81 GB |

At 2.8M, copy plus index fell from 59.0 s to 4.5 s (3.1 s more went into loading keys per batch) and the total
from 205.7 s to 156.7 s. Every run returned the expected counts (140,000 created, 140,000 reopened, 840,000
resolved at 2.8M; 50,000, 50,000 and 300,000 at 1M). Upsert, reopened and resolve sweeps did not change beyond
noise.

Does the gain depend on the benchmark's unique keys? Yes, in the sense that it is the best case. Here every
check owns its records, so the open issues of different batches are disjoint and each batch's `tmp_present`
shrinks to its own share (237,500 rows per batch at 2.8M, 47,500 for the last). In real data many checks hit the same
record (one material fails several checks). A batch then keeps every key that any of its checks has open, so
batches whose checks overlap on the same records shrink less, and if every check had an issue on every record
nothing would shrink. The fix never copies more than before; how much it saves on the customer analysis is
unmeasured. Re-run the benchmark after any change to `record_issues.py`:

    DATABASE_URL_SYNC=postgresql://u:p@localhost:5432/meridian_bench python scripts/bench_lifecycle_scale.py --issues 2800000

## What this blocks

The lifecycle only runs for the **newest** run of a system, so it cannot be warmed
incrementally: any fresh analysis of a system with a large `record_issues` pays this
cost, fails at the limit, and leaves a `partial` version. That is the difference
between "all objects analysed" and "all objects analysed except the newest one per
system".

## Where to look next

Not yet attempted — these need profiling on the real data, not a guess:

1. **Profile the three statements separately.** `track` does reopened → upsert →
   resolved; the log only reports the totals. Time each one
   (`log_statement`/`auto_explain`, or wrap each in its own step).
2. **Narrow the "mark resolved" candidate set before the update.** Only issues whose
   `check_id` appears in this run's `ran` and whose `(grain, record_key)` is in
   `tmp_present` can change state. Materialising those candidates into an indexed
   temp table (the pattern `tmp_present` already uses) should stop the planner
   touching 2.78 M rows to change a handful.
3. **Check `tmp_present`'s size**, which is the other half of the cost. If it carries
   every tested record of every rule (the "~60 M" in the comment), consider storing
   only failing keys plus the grain-level key set actually needed by the semi-joins.
4. **Consider `MERIDIAN_CHECKS_SLOTS`** (currently unset → 1). Two slots would let a
   second object proceed, but the box had 4 GB of swap in use and material_master
   peaked at 13.5 GB of 30 GB, so this needs a measured decision, not a default
   change.

## Related fix already shipped

`run_checks` retried its slot wait with `self.retry(countdown=..., max_retries=None)`,
which does **not** override Celery's dispatch default of 3 (Celery falls back to the
task's own attribute when the call site passes `None`). While material_master held
the slot for 3.5 h, the runs queued behind it exhausted those three retries and were
dropped with `MaxRetriesExceededError`; their versions sat at `pending` with nothing
left in the queue to run them. Fixed by setting `max_retries=None` on the task, with
a regression test in `tests/test_run_checks_lock.py`.
