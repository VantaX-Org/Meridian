# Security policy

## Reporting a vulnerability

Email `security@vantax.co.za`. Do not open a public issue. Include:

- the affected component (customer deployment API, frontend, workers, updater, HQ portal, licence worker,
  LLM proxy, install worker);
- the version (`GET /health` returns it; images are tagged `vX.Y.Z`);
- steps to reproduce and the impact you observed.

We aim to acknowledge a report within 2 business days and to agree a disclosure date with you once a fix
is available. Please do not test against a customer's deployment; use your own install or the fixture
mode of the frontend (`?fixture=1`), which needs no backend.

## Supported versions

Customers run the release the updater delivers. Security fixes ship in the next release; there are no
long-term-support branches. Installs that cannot update automatically (air-gapped) receive the same
release as an image bundle (`docs/air-gapped-deployment.md`).

## How this repository is kept secure

- Dependency advisories: `.github/workflows/dependency-audit.yml` (pip-audit on `requirements.lock`, npm
  audit on runtime dependencies, SBOM drift) and `.github/workflows/security-scan.yml`; container images:
  `.github/workflows/image-scan.yml` (Trivy).
- Tenant isolation: row-level security on every tenant table, proven by `tests/test_rls_conformance.py`
  and `tests/test_rls_integration.py`.
- Every mutating API route carries a permission check: `tests/test_rbac_matrix.py`.

The full security description, the threat model and the open findings are in
[docs/diligence/security.md](docs/diligence/security.md).
