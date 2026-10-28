# Client handover: purge and re-baseline

The order these have to happen in, and what has to be true before each step. Prefix the
commands with `ssh meridian`.

## 0. Before the purge — two decisions, not engineering

The SuccessFactors mapping now resolves 353 of its 472 declared sources against the pilot customer's
tenant. The remaining 119 are concentrated where the tenant does not serve the data
(`docs/successfactors-parity.md`). Two of those are commercial decisions:

1. **Learning, Benefits and Payroll.** `learning_management` (0 of 29 sources resolvable),
   `benefits` (`BenefitEnrollment` has no entity set) and `payroll_integration`
   (`PAYRESULT` needs the EC Payroll export). Either the client supplies those by export —
   the upload path exists — or those objects are scoped out of acceptance. No code change
   makes these evaluate.
2. **Succession.** Whether `succession_planning`'s rules should be scoped to the fields
   `Successor` actually carries (18 of its 26 sources are unresolvable).

Decide these before the purge, because the baselines are the handover evidence and a
re-baseline costs another full run per object.

## 0b. Run the preflight before you start anything

```bash
ssh meridian
python3 /opt/meridian/scripts/handover_preflight.py      # add --json for machines
```

Every line must be PASS. It tests the things that fail *silently* and cost hours — the checks time
limit, a worker on an older image than the API, an analysis stuck `running` and holding the single
checks slot, rule packs that do not load, and **whether each system actually accepts a logon**.

That last one matters most. `connections` proves credentials are *present*; `systems reachable`
proves they *work* by logging on the way an extraction will. On this deployment those two lines
read:

```
[PASS] connections        2 system(s); missing credentials: none
[FAIL] systems reachable  Sanbox (ERP): RFC_LOGON_FAILURE ... "too many failed attempts" ... (SU01)
```

Credentials present, account locked. Without this check the only way to find out is to launch a
baseline and watch it die at the first logon.

**If `systems reachable` says the SAP user is locked**, an SAP basis administrator must unlock it
(transaction **SU01**) or reset the password. Meridian will not retry — deliberately, because each
attempt extends the lock.

### Do not kill an extraction

An extraction holds SAP sessions. Abrupt termination leaves them dangling, and SAP counts an
uncleaned session against the user exactly like a failed logon — which is how the sandbox account
was locked twice.

```bash
docker restart docker-worker-1                 # SIGTERM: sessions close cleanly. USE THIS.
docker exec docker-worker-1 celery -A workers.celery_app revoke <task-id> --terminate
kill -9 <pid>                                  # NEVER. Sessions are orphaned and the user locks.
```

The connector also refuses any logon for 15 minutes after a lock reply, allows only one extraction
per version (so a redelivered task exits instead of re-reading), and closes sessions on
SIGTERM/SIGINT/SIGHUP. A successful logon clears the cooldown immediately, so an unlock takes
effect at once.

### If an extraction stops for memory

A table is written only if it fits in 55% of available memory. When it does not, the run stops with
`ExtractionMemoryError` naming what it needed and what was available — **it does not get OOM-killed**,
because an OOM kill cannot be caught and would leave the sessions open and lock the user. Raise the
worker's memory on the host, or narrow the object's rules, then run again.

## 1. Take a database dump

The purge is not reversible.

```bash
sudo bash /opt/meridian/scripts/backup.sh          # writes /opt/meridian/backups/pre-update-*.dump
ls -la /opt/meridian/backups | tail -3             # confirm the dump exists and is recent
```

## 2. Purge the tenant data, keeping the connections

`scripts/purge_tenant_data.py` derives what to purge from the live schema: every table
carrying a `tenant_id` is emptied in foreign-key order (children first — most keys onto
`analysis_versions` are RESTRICT, so deleting the version before its findings fails), and
it refuses to run if a kept table would be affected.

Kept: `tenants`, `users`, `sap_systems`, `system_credentials`, `system_module_map`,
`sync_profiles`, `alembic_version`.

```bash
docker cp /opt/meridian/scripts/purge_tenant_data.py docker-api-1:/tmp/purge.py
docker exec docker-api-1 python /tmp/purge.py --dry-run      # review the tables and row counts
docker exec docker-api-1 python /tmp/purge.py --execute      # one transaction; any error rolls it back
```

The dry run is the default. It prints every table it will empty and how many rows each
holds, so the list can be eyeballed against the customer's expectation before anything is
deleted.

**Validated against the live deployment (2026-10-16, version 0.0.407).** The dry run reports:

```
tables with tenant_id: 114
kept (skipped) even though they carry tenant_id: ['sap_systems', 'sync_profiles', 'system_module_map', 'users']
tables to purge: 110   (43 non-empty)
rows to delete: 12,810,206
   cleaning_queue 4,099,205   finding_records 3,170,755   record_issues 3,000,585
   dedup_candidates 1,591,382  config_drift_log 638,450   config_items 158,218
   ... 37 more tables
purged tables that reference a kept table: 0
```

So the purge removes ~12.8 M rows and keeps the four connection- and identity-bearing tables
plus `tenants` and `alembic_version`. Run it before the baselines, not after.

**A note on how this was found:** the first version of the script's safety guard asserted that a
KEEP table must not carry a `tenant_id`, and *every* kept table does — so it refused every run
with "KEEP tables carry tenant_id and would be emptied". The guard was checking the wrong
thing: carrying a `tenant_id` is what makes a table a *candidate*, not what disqualifies it.
The check now asserts that no KEEP table reaches the purge set, and the dry run above is the
first time the script has actually run end to end.

**Also clear the work queue.** Purging the database does not stop work already queued against
it. On this deployment two extraction tasks queued before the purge survived it, kept reading the
whole SAP system against analysis versions that no longer existed, and — running alongside the
intended single-module baseline — held 24 GB of the 30 GB worker and stretched that baseline from
minutes to nine hours. `purge_tenant_data.py` now discards the queue after the database purge (see
`--keep-queue` to skip that); **if an extraction was already running, restart the worker**:

```bash
docker restart docker-worker-1          # drops any task still executing
docker exec docker-redis-1 redis-cli LLEN celery   # must be 0
```

**Also purge the object store.** The staged parquet for every analysed version lives
outside Postgres, under the uploads bucket:

```
staging/<tenant-id>/<version-id>/
```

That was ~2.5 M rows of `finding_records` and 3 GB of staged data at the last measurement.
Removing the tenant's `staging/` prefix reclaims it; the purge script does not touch it.

## 3. Verify the deployment is clean

```bash
# no analysis history left
docker exec docker-db-1 psql -U meridian -d meridian -c \
  "SELECT count(*) AS versions FROM analysis_versions;"
# the connections survived, with credentials
docker exec docker-db-1 psql -U meridian -d meridian -c \
  "SELECT name, system_type, company_id FROM sap_systems;"
docker exec docker-db-1 psql -U meridian -d meridian -c \
  "SELECT count(*) AS creds FROM system_credentials;"
# the engine still loads every rule pack
docker exec docker-api-1 python -c \
  "from checks.runner import module_rules; print(len(module_rules('material_master')), 'rules')"
```

Then re-test each connection from Admin → Systems → Test, and confirm the top bar shows the
right object count.

## 4. Baseline run 1 — material_master

Start from the UI (Admin → analyse), or:

```bash
# the extract, then the checks, exactly as the UI does
# Every call needs a token. POST /api/v1/auth/login returns {"token": "..."}; send it as a
# bearer. (The API also accepts the mn_auth_token cookie, which is what the browser uses for
# downloads.)
TOKEN=$(curl -sS -X POST http://127.0.0.1/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<admin-email>","password":"<admin-password>"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')

# The real path is /api/v1/connectivity/extract - there is no /api/v1/extract. Body fields:
# system_id, modules, include_config (default true), sync_type in {data, config, both}.
# A baseline re-reads data; set include_config=false unless the SPRO read is wanted too.
curl -sS -X POST http://127.0.0.1/api/v1/connectivity/extract \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"system_id":"<ecc-system-uuid>","modules":["material_master"],"include_config":false,"sync_type":"data"}'
```

Expect: the ECC checks phase takes tens of minutes, then the cross-run issue lifecycle,
which is the slow tail (measured 5 h 50 m for four ECC modules on this box — that is why
`MERIDIAN_CHECKS_TIME_LIMIT` defaults to 24 h). Watch it:

```bash
docker logs -f docker-worker-1 | grep -E "Module '|skipped|record issues"
```

Success is `status = complete` (or `agents_complete`) with `dqs_summary` non-null:

```bash
docker exec docker-db-1 psql -U meridian -d meridian -c \
  "SELECT id, status, dqs_summary IS NOT NULL AS scored FROM analysis_versions ORDER BY run_at DESC;"
```

Record, per module: `raw_score`, `composite_score`, `coverage`, and the dimension scores —
plus the checks that ran versus skipped, which the worker log states as
`Module '<name>': ran N checks, M passed` and `skipped K checks (<reasons>)`.

## 5. Baseline run 2 — SuccessFactors

Same again with the SF system id and its nine modules. This one is fast (the checks took
~4 minutes at the last measurement; the lifecycle ~2 minutes).

```bash
curl -sS -X POST http://127.0.0.1/api/v1/connectivity/extract \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"system_id":"<sf-system-uuid>","modules":["benefits","compensation","employee_central","learning_management","payroll_integration","performance_goals","recruiting_onboarding","succession_planning","time_attendance"],"include_config":false,"sync_type":"data"}'
```

Expect coverage to be **bounded by what the tenant serves**, not uniform: `employee_central`
and `compensation` near the ECC numbers, `learning_management` at or near zero. That is the
mapping limit in `docs/successfactors-parity.md`, not a data-quality result, and it should
be presented to the client as such.

## 6. What "done" looks like

- `analysis_versions` holds exactly the two baseline runs, both scored, nothing `partial`.
- Every object reports checks-run and checks-skipped with reasons; no module reads 0 checks
  without an explanation in the coverage metadata.
- The two connection rows are intact and test green.
- The numbers in `docs/successfactors-parity.md` match what the SF baseline reports; if they
  do not, the mapping drifted again — `scripts/successfactors_parity.py --strict` is the gate
  to wire in for that.
