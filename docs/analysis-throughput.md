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
