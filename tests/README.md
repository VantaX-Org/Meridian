# Tests

`pytest tests/` runs the suite (conftest.py sets up the development environment; set `MERIDIAN_TEST_DB_URL`
for the Postgres tests). CI splits it into six shards by test id (`PYTEST_SHARD=i/6`).

## Coverage

Line coverage of `api`, `workers`, `checks` and `sap` (configuration in `.coveragerc`):

```bash
make coverage                  # whole suite: coverage.xml + terminal report, then the floor
make coverage-shard SHARD=1/6  # one CI shard
python tests/coverage_floor.py coverage.xml [--floor N]
```

Both run `pytest --cov=api --cov=workers --cov=checks --cov=sap --cov-report=xml --cov-report=term` and then
`tests/coverage_floor.py`, which fails when total line coverage is below the floor.

**Floor: 52.9%.** Measured 2026-10-30 on shard 1/6 alone (3,029 tests): 54.9% (58,121 statements, 26,195
missed), minus 2 points. One shard runs a sixth of the tests, so the combined six-shard number CI reports is at
least this; the floor is deliberately set from the single shard. Raise the floor when coverage rises; never
lower it to make a build pass.

The CI job that combines the six shards, publishes `coverage.xml` and enforces the floor is `coverage` in
`.github/workflows/unit-tests.yml`.
