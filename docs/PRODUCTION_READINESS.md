# Production readiness attestation

_As of 2026-04-24. Signed off by: engineering._

This document is the point-in-time snapshot of what's been done to get Meridian to "pilot-customer ready" and what's genuinely still required for GA.

## What's shipped (engineering)

### Core platform
- 29 SAP modules, 254+ deterministic checks, DAMA DMBOK scoring
- Auto-selecting check engine (pandas ↔ polars at 50k rows)
- 4 Aurora workspaces (Command Centre, Workbench, Process, Admin) with full mining-graph backend
- Multi-system SAP connector layer (ECC / S/4HC / SF / Concur / Ariba / eWMS)
- Config Intelligence Engine (3-layer: discovery, process detection, alignment)
- LangGraph agent orchestrator with 6-node flow + LLM-less deterministic fallback

### Security
- PBKDF2 password hashing with per-row salt, constant-time compare
- Postgres FORCE RLS + dedicated `meridian_app` non-superuser role
- TOTP MFA on HQ portal admins with single-use recovery code
- JWT revocation via `admin_sessions`
- Account lockout after 5 failed attempts (IP + account)
- Unified Redis rate limiter on login, upload, NLP, field-mappings sync
- First-login forced password change for seeded admin
- CORS origin allow-list (no blanket `*`)
- `CREDENTIAL_MASTER_KEY` rotation tool with overlap window
- Audit log on every state-changing API call (customer side + HQ side)
- Sanitised error responses (no stack trace leakage)

### Operability
- Prometheus metrics at `/metrics` (HTTP, Celery, LLM, audit, checks)
- Structured JSON logs with request ID + tenant ID context
- Opt-in monitoring stack (Prometheus + Alertmanager + Grafana) with 7 alert rules
- `/api/v1/admin/doctor` subsystem probes (Postgres, Redis, MinIO, LLM, licence, migrations)
- `backup.sh` + `restore.sh` + `backup-restore-drill.sh` + runbook
- `update.sh` with snapshot-to-`:rollback` tags + auto-rollback on failed health check

### CI
- `aurora-e2e` (smoke + a11y + perf + visual regression)
- `rls-tests` (real Postgres, non-superuser role, 4 cases)
- `deploy-smoke` (full install on clean Ubuntu per PR)
- `perf-400k` (weekly pandas/polars comparison)
- `security-scan` (pip-audit + npm audit on PR + weekly cron)
- `image-scan` (Trivy on 4 prod images + weekly SBOM)
- `dependabot` (pip, 4× npm, Docker, Actions)
- `vr-baseline-refresh` (manual workflow + runbook)

### Tests
- 30 / 30 licence worker tests passing
- 4 / 4 RLS integration tests passing
- 22+ API unit tests passing
- Playwright smoke + a11y + VR baselines

### Documentation
- `docs/security/THREAT_MODEL.md` + `DATA_FLOW.md`
- `docs/security/pentest-scope.md` — scope package for a tester
- `docs/legal/{EULA,PRIVACY,DPA}.md` — counsel-review templates
- `docs/ops/pilot-customer-onboarding.md` — week-by-week runbook
- `docs/ops/sap-data-prep-checklist.md` — customer-facing
- `docs/ops/backup-restore.md`, `monitoring.md`, `rls-hardening.md`, `vr-baselines.md`

## What the product is NOT

- **GA-ready for arbitrary SAP deployments.** We've validated synthetic data; real customer data remains the pilot deliverable.
- **SOC 2 / ISO 27001 certified.** The threat model + data flow + security scanning are the foundation for one; getting there is a 3–6 month engagement, not an engineering task.
- **Covered by a pen test report.** `pentest-scope.md` is the scope; the actual engagement is still to book.
- **Backed by legal contracts.** `docs/legal/` has templates; counsel must review + sign off before use.

## Go-live gates (who owns each)

| # | Gate | Owner | Status |
|---|---|---|---|
| 1 | Legal review of EULA / Privacy / DPA | Business | ⬜ |
| 2 | Pen test engagement + report | Business + engineering | ⬜ |
| 3 | First pilot customer agreement signed | Business | ⬜ |
| 4 | Pilot customer hardware provisioned per pre-install checklist | Customer | ⬜ |
| 5 | Pilot customer ran 1,000-row sample extract cleanly | Engineering + customer | ⬜ |
| 6 | Pilot customer full-module extract produced a stakeholder-ready report | Engineering + customer | ⬜ |
| 7 | Pilot customer completed 30 days with no P1 incidents | Customer | ⬜ |
| 8 | Pen test remediations landed | Engineering | ⬜ |

All eight must be green before declaring GA. None of them are pure-engineering.

## Known gaps we're accepting for pilot

These are flagged but not blockers for a single pilot customer. They should be closed before the second customer:

- `OFFLINE_JWT_PRIVATE_KEY` single-key (no rotation mechanism)
- `JWT_SECRET` rotation requires ops-procedure, not built-in overlap
- No WAF rules in front of customer API (customer responsibility today, but we should ship default rules)
- VR baselines are currently the sign-in screen, not per-route (auth-in-CI to close)
- No SBOM delivered with customer releases (we have the artifact, just need to attach to tags)
- No GDPR DSAR endpoint (manual SQL today)
- No built-in tenant-user admin UI in the customer API (HQ-side only)

## Local environment state

As of 2026-04-24, the local dev stack is at:
- DB migration head: **042** (includes `must_change_password` + `UNIQUE(version_id, tenant_id)`)
- Licence worker: main tip, 33 tests passing
- Frontend: typechecks clean
- All six monitoring + CI workflows in place

## Nothing remaining that engineering can do without a customer

Everything else on the critical path requires either a paying customer, a legal counsel, a pen test engagement, or a cloudflare/production-environment action (rotating the credentials pasted in chat — still not done as of this writing).

When those external inputs arrive, the engineering response is ready:

- Legal signs the templates → publish + use
- Pen tester engaged → hand them `pentest-scope.md` and a staging host
- Customer provisioned a host → run `meridian-deploy.sh`, follow `pilot-customer-onboarding.md`
- Customer ready to upload → hand them `sap-data-prep-checklist.md`

The platform itself is ready to meet those inputs. The rest is organisational.
