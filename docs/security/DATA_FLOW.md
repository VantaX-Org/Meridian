# Meridian — Data flow

_Companion to THREAT_MODEL.md. Describes every network hop, what travels over it, how it's authenticated, and how it's encrypted._

## 1. Customer → Meridian dashboard (hot path)

```
Browser → (nginx TLS 1.3) → Next.js frontend → FastAPI → Postgres
                                          └→ MinIO
                                          └→ Redis
                                          └→ Celery queue
                                          └→ SAP connector → customer SAP
                                          └→ LLM provider (tier-dependent)
```

| Hop | Protocol | Auth | TLS |
|---|---|---|---|
| Browser → nginx | HTTPS | — | Customer cert |
| nginx → Next.js | HTTP (docker network) | — | n/a — internal only |
| Next.js → FastAPI | HTTP (docker network) | Bearer JWT | n/a — internal only |
| FastAPI → Postgres | Postgres wire | `meridian_app` non-superuser role | Customer-configurable (`sslmode=require` via env) |
| FastAPI → MinIO | S3 HTTPS | MinIO access/secret key (from `.env`) | Customer-configurable |
| FastAPI → Redis | Redis resp | No auth on internal network (tested at install time) | n/a |
| Worker → SAP | OData/REST/RFC | Stored per-system in `system_credentials` (encrypted at rest) | Customer-controlled cert pinning |
| Worker → LLM | HTTPS | API key per provider | Provider-managed |

## 2. Customer → Meridian HQ (licence validation)

```
Customer API ── POST https://licence.meridian.vantax.co.za/api/licence/validate ──→ Licence Worker → D1
                   body: {licenceKey, machineFingerprint}
                   response: {tenant_id, modules, features, rules, field_mappings}
```

Single call per startup + every 6 hours thereafter. Outbound only. Payload contains:
- The customer's licence key (bearer-equivalent secret)
- A non-sensitive machine fingerprint (hostname + MAC SHA-256)

Response contains:
- No customer data
- Licence manifest: tier, expiry, enabled modules, rule defaults

The licence worker **never receives customer SAP data** — only a key + fingerprint.

## 3. HQ portal operator → HQ stack

```
Operator browser → (Cloudflare Pages TLS) → Portal (Next.js) → (CF network) → Licence Worker → D1
```

| Hop | Auth |
|---|---|
| Operator → Portal | Portal session cookie (short-lived) |
| Portal → Licence Worker | Bearer JWT from `/api/admin/login` (8h, with optional TOTP) + revocation check |

## 4. At-rest encryption

| Data | Location | Scheme |
|---|---|---|
| SAP passwords (`system_credentials.encrypted_password`) | Customer Postgres | AES-256-GCM with `CREDENTIAL_MASTER_KEY`-derived per-tenant key |
| User passwords (`users.password_hash`) | Customer Postgres | PBKDF2-SHA256 (120k iterations) + salt |
| Admin passwords (`admins.password_hash`) | HQ D1 | PBKDF2-SHA256 + per-row salt |
| Tenant-user passwords (`tenant_users.password_hash`) | HQ D1 | PBKDF2 (migration 002+); legacy SHA-256 rows upgrade on next login |
| LLM API keys (`tenants.llm_config.api_key`) | Customer Postgres | Fernet (AES-128-CBC + HMAC) with `LLM_KEK` |
| Licence keys on the customer | Not stored — only submitted at runtime | — |
| Licence keys in HQ D1 | SHA-256 hash only | Key material never at rest |
| Audit logs | Customer Postgres `audit_log` + HQ D1 `admin_audit` | Native DB-level encryption if enabled at filesystem/cluster level |
| Findings / SAP extracts | Customer Postgres + MinIO | Plain (customer's storage encryption applies) |
| Reports (JSON + PDF) | Customer Postgres / MinIO | Same as findings |
| Backups | Customer filesystem | Optional GPG-symmetric (AES-256) via `backup.sh --encrypt` |

Volume-level encryption (LUKS / ebs-encryption / cloud provider) is a customer responsibility; it's called out in the pre-install checklist.

## 5. In-flight encryption

All external hops use TLS 1.2 or 1.3. Internal docker-network hops (api ↔ db, api ↔ minio, etc.) are unencrypted by design — they never leave the host. Customers running on a multi-host Swarm / Kubernetes are expected to configure network-level TLS (mesh, cilium, etc.).

## 6. PII in logs

- Application logs (JSON) include `tenant_id`, `request_id`, `path`, `method`, `status`, `latency`. **Never**: passwords, licence keys, SAP row data.
- Audit log `before_json` / `after_json` columns can contain request/response bodies. Password-change endpoints do NOT store the request body (`before_json=null`). Future audit helpers should follow the same pattern — treat any field named `password*`, `secret*`, `token*`, or `*_key` as sensitive and strip before storing.

## 7. Data retention

| Store | Default retention | Configurable |
|---|---|---|
| `audit_log` | forever | — |
| `admin_audit` | forever | — |
| Celery task results (Redis) | 24h | `CELERY_RESULT_EXPIRES` |
| Prometheus metrics | 30 days | `--storage.tsdb.retention.time` |
| Backups | Customer-controlled; default cron example retains 14 days | `find -mtime +N` in cron |

## 8. Data subject access / deletion

No built-in GDPR DSAR tooling yet. On request:
- SELECT-and-export: `psql meridian -c "COPY (SELECT * FROM users WHERE email = :email) TO STDOUT CSV"` (and same for every user-linked table).
- Delete: `DELETE FROM users WHERE email = :email`. Downstream tables (audit_log referencing actor_user_id, etc.) keep their rows with the FK intact — audit data is not personal enough to require cascade, but this is a judgement call per-customer.

A first-class DSAR endpoint is on the backlog.
