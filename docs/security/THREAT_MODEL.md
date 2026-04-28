# Meridian — Threat model

_Last updated: 2026-04-24. Reviewed by: engineering._

This document enumerates the trust boundaries, assets, threats, and mitigations for the Meridian platform as currently deployed. Intended to be read by:
- Enterprise security reviewers evaluating Meridian during procurement
- Internal engineers shipping new features on the platform
- External pen testers scoping an engagement

It is **not** a substitute for a real pen test. It is a starting point that (a) forces us to articulate what we think we're protecting, and (b) gives a reviewer a predictable structure to ask questions against.

---

## 1. Scope

The platform consists of four parts, each with different trust expectations:

```
┌────────────────────────────────────────────────────────────────────────┐
│                  CLOUDFLARE (Meridian HQ — our infra)                   │
│                                                                        │
│  ┌────────────────┐  ┌────────────────────┐  ┌─────────────────────┐   │
│  │  HQ Portal     │  │  Licence Worker    │  │  LLM Proxy          │   │
│  │  (Next.js on   │  │  (Worker + D1)     │  │  (optional relay)   │   │
│  │  CF Pages)     │  │                    │  │                     │   │
│  └────────────────┘  └──────────┬─────────┘  └─────────────────────┘   │
└─────────────────────────────────┼──────────────────────────────────────┘
                                  │   POST /validate  (HTTPS)
                                  │   licence key → manifest
                                  │
┌─────────────────────────────────┼──────────────────────────────────────┐
│              CUSTOMER ENVIRONMENT  (their own servers)                 │
│                                  ▼                                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Meridian deployment                                              │  │
│  │  ┌─────────┐  ┌─────────┐  ┌────────┐  ┌────────┐  ┌──────────┐   │  │
│  │  │ nginx   │  │ Next.js │  │ FastAPI│  │ Celery │  │ Postgres │   │  │
│  │  │ (TLS)   │→ │ frontend│→ │ API    │→ │ workers│  │ (RLS)    │   │  │
│  │  └─────────┘  └─────────┘  └────────┘  └────────┘  └──────────┘   │  │
│  │                               │                                    │  │
│  │                               ▼                                    │  │
│  │                         ┌──────────────┐                           │  │
│  │                         │ SAP systems  │ ← customer's ECC / SF /   │  │
│  │                         │ (OData/RFC)  │   Concur / Ariba / S4 HC │  │
│  │                         └──────────────┘                           │  │
│  │                                                                    │  │
│  │                         ┌──────────────┐                           │  │
│  │                         │ LLM          │ ← Tier 1 cloud / Tier 2   │  │
│  │                         │ (configured) │   bundled Ollama /        │  │
│  │                         └──────────────┘   Tier 3 custom endpoint  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

## 2. Assets

Ranked by blast radius of a compromise:

| Rank | Asset | Where | Impact of exposure |
|---|---|---|---|
| A1 | Customer SAP data (findings, extracts, config) | Customer Postgres + MinIO | Disclosure of operational data; competitive harm |
| A2 | `CREDENTIAL_MASTER_KEY` | Customer `.env` | Decrypts every stored SAP system password |
| A3 | Customer SAP system credentials (encrypted) | Customer Postgres `system_credentials` | Direct access to customer SAP |
| A4 | HQ portal admin credentials | D1 `admins` | Cross-tenant access to every licensed customer |
| A5 | `JWT_SECRET` (HQ portal) | Wrangler secret | Forge any admin session |
| A6 | `OFFLINE_JWT_PRIVATE_KEY` | Wrangler secret | Mint offline licences for any airgap customer |
| A7 | Customer admin user passwords | Customer Postgres `users` | Local dashboard access for that tenant |
| A8 | Meridian HQ Stripe billing data | Cloudflare D1 (if enabled) | Financial/PII exposure of customer company data |

## 3. Trust boundaries

1. **Public internet ↔ Cloudflare (HQ)** — enforced by Cloudflare TLS + WAF.
2. **Cloudflare (HQ) ↔ Customer deployment** — only a single `POST /validate` call from the customer → HQ. Customer → HQ is outbound-only. No reverse traffic.
3. **Customer external network ↔ Customer Meridian stack** — enforced by customer-provided nginx / reverse proxy + TLS.
4. **Customer Meridian containers ↔ Customer Postgres / MinIO** — docker network, only reachable from within the compose stack.
5. **Customer Meridian stack ↔ Customer SAP** — outbound connections initiated by the connectivity manager.
6. **Meridian containers ↔ LLM provider** — outbound only; Tier 2 keeps it inside the docker network.

## 4. STRIDE per-asset

### A1 — Customer SAP data

| Threat | Mitigation |
|---|---|
| Spoofing | JWT-signed session; licence validation gates the stack |
| Tampering | Findings are append-only via workers; audit_log records every mutation |
| Repudiation | audit_log + admin_audit |
| Information disclosure | RLS on every tenant table; FORCE ROW LEVEL SECURITY (migration 039); non-superuser `meridian_app` role (migration 040); LLM proxy can be configured to strip PII before upstream call |
| Denial of service | Rate limits on /upload, /nlp/query, /auth/login; max upload size 100 MB; Celery soft time limits |
| Elevation of privilege | RBAC via `PERMISSIONS` dict; every admin endpoint checks a named action; route guards enforced by `require_permission` |

### A2 — `CREDENTIAL_MASTER_KEY`

| Threat | Mitigation |
|---|---|
| Information disclosure | Stored in customer `.env` with 600 perms; backup scripts can GPG-encrypt it (`backup.sh --encrypt`); rotation tool ships in `scripts/rotate-credential-key.py` with opportunistic re-encrypt on old/new overlap |

### A4 — HQ portal admin credentials

| Threat | Mitigation |
|---|---|
| Spoofing | PBKDF2 hashing; per-row salt; constant-time compare |
| Repeated guess | IP rate limit 5/5min + account lockout after 5 wrong attempts |
| Token theft | MFA (TOTP) on any admin account that enrols; JWT revocation via `admin_sessions`; single-use recovery code |
| Session pivot | JWT `jti` claim + revocation check in `verifyJwt` — stolen tokens can be revoked server-side |

### A5 — `JWT_SECRET`

| Threat | Mitigation |
|---|---|
| Exposure | Wrangler secret (never in repo); no rotation mechanism today (tracked under follow-up) |
| Forged session | Rotation of the secret invalidates all existing tokens — acceptable trade-off in an incident |

## 5. Threats by attack surface

### HTTPS edges
- **Customer nginx (HTTPS)**: customer-owned certificate; TLS config is their responsibility. Deploy script configures Let's Encrypt or self-signed.
- **HQ portal (CF Pages)**: Cloudflare-managed TLS.
- **Licence worker (CF Workers)**: Cloudflare-managed TLS + CORS allow-list.

### Authentication
- Customer API: local JWT auth (AUTH_MODE=local). Passwords hashed with PBKDF2. Bootstrap admin forced into password rotation on first login (migration 041).
- HQ portal: PBKDF2 + optional TOTP MFA + account lockout + session revocation. See §4 A4.

### Cross-tenant isolation
Postgres RLS policies on every tenant-scoped table. Two migrations harden this:
- Migration 039 — `FORCE ROW LEVEL SECURITY` so policies apply to the owner too.
- Migration 040 — `meridian_app` role (non-superuser, NOBYPASSRLS). The API + workers connect as this role; migrations still run as the owner.

Integration tests in `tests/test_rls_integration.py` create an isolated app role at runtime and verify cross-tenant SELECT/UPDATE both return zero rows.

### SQL injection
All queries use parameterised SQLAlchemy `text()` bindings. No string concatenation on user-supplied values. Two exceptions, both audited:
- `SET app.tenant_id = '…'` takes a UUID from the validated `Tenant` model; inline because Postgres rejects bound params on SET.
- LIKE search patterns have `%` and `_` escaped via `escapeLike()` in the licence worker.

### LLM prompt injection
- The LLM never sees raw SAP data. Agents receive summarised finding payloads, not row-level content.
- LLM responses parsed as structured data; falls back to deterministic scoring if parsing fails.
- NLP query filter layer (`api/services/nlp_service.py`) sanitises user input before sending to the model.

### Dependency supply chain
- `dependabot.yml` — weekly scans across Python, 4× npm workspaces, GitHub Actions, Docker base images.
- `security-scan.yml` — `pip-audit` + `npm audit --audit-level=high` on every PR + weekly cron.
- `image-scan.yml` — Trivy on the four prod Docker images (`HIGH`, `CRITICAL`, unfixed ignored). Weekly SBOM artifact (CycloneDX, 90-day retention).

### Audit
- `audit_log` (customer-side, migration 038) records every state-changing API call — actor, verb, entity type+id, method, path, status, IP, user-agent.
- `admin_audit` (licence worker D1, migration 003) records every HQ-side mutation — same schema.
- Both excluded from RLS bypass.
- Flush-on-shutdown ensures in-flight writes drain before pod recycle.

## 6. Known gaps (as of 2026-04-24)

1. `JWT_SECRET` rotation requires an ops procedure; no built-in key-overlap mechanism yet.
2. `OFFLINE_JWT_PRIVATE_KEY` single-key; rotation invalidates all airgapped offline tokens simultaneously.
3. No WAF rules in front of the customer API (customers typically put Cloudflare / equivalent in front themselves).
4. Penetration test — this document is written in lieu of one, not as a replacement. External engagement is recommended before the first enterprise contract.
5. SBOM for the customer-side containers is generated weekly but not published to customers. Should be delivered per-release.

## 7. Data flow — where the data goes

See `docs/security/DATA_FLOW.md` for the full diagram + per-hop encryption/auth details.

## 8. Responsible disclosure

Security issues should be reported to `security@vantax.co.za`. Include:
- Affected component (HQ portal / licence worker / customer API / frontend)
- Reproduction steps
- Impact assessment

We aim to acknowledge within 2 business days.
