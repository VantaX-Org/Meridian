# Security

The security posture of the customer deployment and the control plane, as built. Each control names the code
that implements it and the test or command that proves it. What the review found is in section 15 ("Known
findings") with a disposition for each; defects handed to the owning team carry a D-number from
[roadmap-and-debt.md](roadmap-and-debt.md).

**Update, 30 October 2026.** A buyer's critique tested this document and found two statements wrong (licence
integrity and tenant resolution, corrected below) and several findings that have since been fixed. The
fixes of the backend remediation line are now merged into this tree, and each disposition below says what is
true in the code and where.

Measured at commit `5cf7161c`. Reproduce with `bash scripts/diligence_audit.sh` (scanners, SBOMs, licence
tables) and `bash scripts/diligence_audit.sh --full` with `MERIDIAN_TEST_DB_URL` set (live RLS count). The
proof tests named below ran green for this document:
`pytest tests/test_rls_conformance.py tests/test_rbac_matrix.py tests/test_rls_integration.py tests/agents/test_state.py tests/agents/test_prompts.py tests/test_server_error_handler.py`
(27 passed against Postgres 16).

## 1. Threat model (STRIDE)

Assets, in order of harm if lost: customer SAP data (extracts, findings, failing record values, golden
records); SAP connection credentials; session signing secrets and the credential master key; licence
integrity; the audit trail. Trust boundaries: browser to nginx; nginx to API; API and workers to Postgres,
Redis and object storage; workers to SAP; API and workers to an optional LLM provider; API to the licence
worker on Cloudflare. A longer per-asset model is in `docs/security/THREAT_MODEL.md` (April 2026).

| | Threat | Where | Control in this repository | Residual risk |
|---|---|---|---|---|
| S | Stolen or forged session | browser, API | HS256 JWT signed with a per-tenant 256-bit secret, 24 h expiry, `tv` claim revoked on password change, reset and deactivation (`api/services/local_auth.py`); argon2id hashes; per-IP login limit 10/min and per-account lockout after 10 failures for 15 min (`api/routes/auth.py`) | the token sits in `localStorage`, readable by script after an XSS (D-12); no Content-Security-Policy (D-13) |
| S | Forged single sign-on | OIDC | authorization code with PKCE S256, signed 10-minute state cookie, issuer, audience, azp, exp and nonce checked, `none` and HMAC refused (`api/services/oidc.py`); `tests/test_oidc_pg.py` | none known |
| S | Stolen API key or SCIM token | service accounts | key `mk_<prefix>.<secret>`, secret shown once, stored as SHA-256, compared in constant time, 600 requests/min per key (`api/services/api_keys.py`); SCIM token hashed per tenant, 1,200 requests/min per IP (`api/routes/scim.py`) | keys have no default expiry |
| T | Cross-tenant read or write | Postgres | RLS enabled and forced on every tenant table, non-superuser `meridian_app`, `SET LOCAL app.tenant_id` per transaction (sections 4, 5) | `system_update_log` is forced since migration 117 (D-07). A signed-in request runs in the tenant of its verified token claim, checked with that tenant's own secret (`api/middleware/local_auth.py`, `api/deps.py`), and `tests/test_tenant_isolation_api_pg.py` proves a token cannot read another tenant's rows (DR-4, fixed) |
| T | Tampered upload | `POST /api/v1/upload` | magic-byte check, 100 MB cap read in chunks, formula-injection prefix after column mapping (`api/routes/upload.py:_validate_magic_bytes`, `_sanitise_formula_injection`) | none known |
| T | SQL injection | API, workers | SQLAlchemy `text()` with bound parameters; dynamic identifiers come from code constants; `tests/test_sql_param_intervals.py` | `api/deps.py:44` formats the tenant id into `SET LOCAL`; the value is a `uuid.UUID` from a verified token, not user text |
| T | Tampered licence | API and licence worker | every path (online response, offline token, offline file) verifies an Ed25519 signature against the vendor public key compiled into the image (`api/middleware/licence_keys.py`, `api/middleware/licence.py`); the licence worker signs with `LICENCE_SIGNING_KEY_ED25519` | fixed; enforcement switches on after the worker rollout. The transition window `MERIDIAN_LICENCE_ALLOW_LEGACY_SIGNATURES` is on by default (`api/config.py`) and still accepts the old HMAC and RSA signatures and, with no RSA key set, an unsigned online response, each logged, until the licence worker is deployed with `LICENCE_SIGNING_KEY_ED25519`; a release then turns it off (DR-3) |
| R | A user denies a change | API | `AuditMiddleware` writes every POST, PUT, PATCH, DELETE under `/api/v1/` to `audit_log` (actor, path, status, IP, user agent); 33 modules write their own before/after rows (`write_audit`) | password sign-in, sign-out and password change are not audited (D-14). Fixed in commit `24a551c0`: `auth.login`, `auth.login_failed` (email as typed, reason, address, user agent, never the password), `auth.lockout`, `auth.password_change`, and a new `POST /api/v1/auth/logout` writing `auth.logout` (`api/routes/auth.py`, `tests/test_auth_audit_pg.py`) |
| I | SAP data leaves the customer | all egress | licence calls carry key and fingerprint only; the agent graph gets aggregates; sandbox mode holds every outbound delivery | optional AI helpers send sample values to the configured model (section 9) |
| I | Internals in responses | API | one handler for unhandled errors returns a reference code and audits it (`api/server_error.py`, `tests/test_server_error_handler.py`) | `/docs` and `/openapi.json` are reachable without sign-in through nginx (D-15). Fixed in commit `28c18f7c`: the API serves them only when `MERIDIAN_ENV=development` or `MERIDIAN_OPENAPI_PUBLIC=1` (`api/config.py`, `api/main.py`, `tests/test_security.py`) |
| I | Secrets at rest | Postgres, backups | SAP passwords AES-256-GCM with per-tenant keys from `CREDENTIAL_MASTER_KEY`, rotation by `scripts/rotate-credential-key.py`; stored LLM keys Fernet under the tenant secret | `scripts/backup.sh` writes `.env` in clear unless `--encrypt` (D-16) |
| D | Request floods | API | Redis fixed-window limits on login, forgot and reset password, invite, OIDC, upload (30/min per tenant), SCIM, public theme, client errors, API keys (`api/services/rate_limiter.py`) | the limiter fails open while Redis is down, by design |
| D | Licence worker unreachable | API | last validated licence keeps serving 2 h after the first failure | licensed routes answer 403 after that (operations.md, section 8) |
| E | Privilege beyond the role | API | one matrix (`api/services/rbac.py`, 14 roles, 26 actions, grants scoped by system and module); every mutating route guarded (section 3); `tests/test_rbac_escalation_pg.py` | none known |
| E | Abuse of the updater sidecar | updater | holds the Docker socket by design; `POST /update` needs `X-Updater-Secret`, compared with `hmac.compare_digest`, and fails closed when no secret is set (`updater/main.py:57`) | an attacker with the secret can trigger an update, not choose the image |

## 2. Authentication

| Mechanism | Implementation | Proof |
|---|---|---|
| Local password | `POST /api/v1/auth/login`; argon2id; policy: 12+ characters, not containing the email name, not on the bundled common-password list, not the current password | `tests/test_auth_lockout_pg.py`, `tests/test_change_password_route.py` |
| Session | JWT HS256, 24 h, per-tenant `jwt_secret`, bearer header; httponly SameSite=Lax cookie `mn_auth_token` (Secure on HTTPS) for downloads and video; `tv` claim revokes earlier sessions | `tests/test_auth_cookie_secure.py`; `pytest -m session_revocation` |
| Lockout | 10 consecutive failures lock the account 15 minutes (423 with the minutes left) | `tests/test_auth_lockout_pg.py` |
| OIDC | code flow with PKCE, JWKS check, per-tenant configuration | `tests/test_oidc_pg.py` |
| SCIM 2.0 | `/scim/v2` Users and Groups (17 operations), Entra ID and Okta PatchOp shapes, group-to-role map; the last active admin is never removed | `tests/test_m2_scim_pg.py` |
| API keys | service users without a password; a key holds its service user's grants and nothing more | `tests/test_api_keys_pg.py` |
| Invites and reset | signed 7-day invites, reset tokens; all rate limited per IP | `tests/test_invite_preview.py` |

## 3. Authorisation

- **Roles.** 14 built-in roles (`ROLE_RANK`): platform_admin, admin, programme_lead, manager, data_steward,
  steward, sap_basis, data_owner, approver, process_analyst, analyst, ai_reviewer, auditor, viewer. Custom
  roles live in `role_permissions`.
- **Permissions.** 26 actions (`ALL_ACTIONS`) mapped to resource x action pairs. `GET /api/v1/auth/me`
  returns the caller's permissions; the frontend keeps no copy.
- **Scopes.** A grant can be limited to one system and one module (`user_role_scopes`) and can expire;
  the nightly purge removes expired grants with an audit row.
- **Route guard test.** `tests/test_rbac_matrix.py::test_every_mutating_route_is_guarded` parses every file
  in `api/routes/` and fails when a POST, PUT, PATCH or DELETE handler (or its router) has no
  `require_permission`, `require_any_permission` or `require_action_or_sap_source` dependency, outside an
  explicit list of public endpoints (sign-in, accept invite, reset, change own password).
  `tests/test_rbac_admin_all.py` proves the admin holds every action a route asks for;
  `tests/test_route_shadowing.py` that no parameterised route swallows a static one;
  `tests/test_get_routes_no_5xx.py` sweeps every GET route on an empty tenant and on one with a run.
- **Reads.** GET routes need a signed-in user of the tenant; audit, LLM, users, licence and credential reads
  are outside plain `view` (`_NO_VIEW` in `rbac.py`).
- **View as and share links.** An admin can view as a lower role (server-enforced `X-View-As-Role`). A share
  link opens one page read-only under the viewer role for a signed-in user of the same tenant; its token is
  stored as SHA-256 (`api/routes/share_links.py`).

## 4. Tenant isolation

**What the code does today (corrected).** Tenant resolution is not taken from the token. `api/deps.py:get_tenant`
returns a hard-coded development tenant (`00000000-0000-0000-0000-000000000001`, with a hard-coded list of
licensed modules) in every mode, with the comment "For now, return dev tenant as fallback";
`api/middleware/local_auth.py` loads the session signing secret for that tenant only; `TenantMiddleware`
never reads the token's tenant claim. Row-level security below is real and tested, but every request runs as
the same tenant, so a deployment is single-tenant in code, not only by contract. A hosted or
multi-business-unit offering needs the tenant read from a verified token claim, a per-tenant secret cache,
entitlements from the licence, and a cross-tenant API test (DR-4). **Fixed on 30 October 2026**: the
middleware verifies a token with the secret of the tenant its `tenant_id` claim names and makes that claim the
request's tenant and RLS context; `get_tenant` refuses a signed-in request without one outside development;
entitlements come from the licence cache; the deployment's own tenant is `MERIDIAN_TENANT_ID`
(`api/middleware/local_auth.py`, `api/deps.py`, `api/config.py`, `tests/test_tenant_isolation_api_pg.py`).

The API sets `SET LOCAL app.tenant_id` in `api/deps.py:get_db`; workers use `workers/db.py:tenant_session`,
which runs `set_config('app.tenant_id', ...)` at the start of every transaction. Production connects as
`meridian_app` (no superuser, no BYPASSRLS; migration 040; `scripts/meridian-deploy.sh` lines 574 to 576);
only migrations use the owner role. `docs/ops/rls-hardening.md` covers deployments older than migration 040.

## 5. Row-level security on every table

Live measurement on Postgres 16 at migration head `116` (`python3 scripts/diligence_counts.py --rls`):

| Measure | Count |
|---|---|
| Tables in `public` | 160 |
| Tables with a `tenant_id` column | 153 |
| ...RLS enabled | 153 |
| ...RLS forced | 152 (all but `system_update_log`, D-07) |
| ...with a policy | 153 |
| RLS through a parent row (no own `tenant_id`) | 3: `config_process_steps`, `role_permissions`, `system_credentials` |
| Without RLS | 4, none holding tenant data: `alembic_version`, `relationship_types` (shipped vocabulary), `rules_hq_cache` (HQ rule catalogue), `tenants` |

Proof in CI: `tests/test_rls_conformance.py` imports `db.schema`, finds every model with `tenant_id`,
resolves every `ENABLE ROW LEVEL SECURITY` in `db/migrations/versions/` (literal, loop and helper forms,
with a guard against passing vacuously) and fails on any gap. `tests/test_rls_integration.py`
(`.github/workflows/rls-tests.yml`) creates `meridian_rls_app` with `NOSUPERUSER NOBYPASSRLS` and shows one
tenant cannot read or write another's rows; 89 `*_pg.py` files run their assertions with RLS in force.

The 156 tables with RLS enabled, as listed in `docs/diligence/generated/counts.json` (`rls.rls_tables`):

`access_requests`, `ai_feedback_log`, `ai_proposed_rules`, `alert_channels`, `analysis_run_steps`, `analysis_versions`, `api_keys`, `assignment_rules`, `assignment_templates`, `audit_log`, `cleaning_audit`, `cleaning_metrics`, `cleaning_queue`, `cleaning_rules`, `comments`, `config_alignment_findings`, `config_drift_alerts`, `config_drift_log`, `config_health_scores`, `config_impact_results`, `config_inventory`, `config_items`, `config_loads`, `config_matches`, `config_process_steps`, `config_processes`, `config_snapshots`, `contract_breaches`, `contract_compliance_history`, `contract_versions`, `contracts`, `cost_avoidance`, `data_anomalies`, `data_duplicates`, `data_owners`, `data_relationships`, `ddic_domains`, `ddic_snapshots`, `ddic_tables`, `dedup_candidates`, `delegations`, `digest_deliveries`, `digest_schedules`, `dqs_history`, `escalation_steps`, `exception_billing`, `exception_comments`, `exception_rules`, `exceptions`, `export_packages`, `extraction_changes`, `field_dependencies`, `field_mappings`, `field_profiles`, `finding_records`, `finding_root_causes`, `findings`, `glossary_change_log`, `glossary_term_rules`, `glossary_terms`, `golden_writeback_requests`, `health_samples`, `impact_records`, `insight_feedback`, `known_issues`, `learned_rule_proposals`, `llm_audit_log`, `llm_decision_cache`, `master_record_history`, `master_records`, `match_rules`, `match_scores`, `mdm_merge_events`, `mdm_metrics`, `mdm_pair_constraints`, `migration_export_files`, `migration_gap_findings`, `migration_runs`, `migration_waves`, `notification_deliveries`, `notification_subscriptions`, `notifications`, `policy_field_classes`, `policy_packs`, `process_derivations`, `process_discovery_runs`, `process_discovery_schedules`, `process_discovery_variants`, `process_events`, `process_model_versions`, `process_models`, `process_variants`, `proven_cost_results`, `purge_log`, `record_fixes`, `record_hashes`, `record_issue_events`, `record_issues`, `record_relationships`, `remediation_batches`, `remediation_events`, `remediation_items`, `report_files`, `report_schedule_runs`, `report_schedules`, `reports`, `role_permissions`, `roles`, `rule_suppressions`, `rule_versions`, `rules`, `sap_systems`, `saved_views`, `scim_group_members`, `scim_group_role_map`, `scim_groups`, `scim_tokens`, `scim_users`, `share_links`, `skipped_deliveries`, `sla_policies`, `steward_assignments`, `steward_metrics`, `stewardship_queue`, `survivorship_rules`, `sync_profiles`, `sync_runs`, `system_credentials`, `system_module_map`, `system_update_log`, `table_profiles`, `tenant_settings`, `transfer_field_mappings`, `transfer_value_mappings`, `triage_settings`, `triage_team_members`, `triage_teams`, `undo_actions`, `user_role_scopes`, `users`, `watches`, `wave_certificate_signatures`, `wave_certificates`, `wave_gates`, `webhook_deliveries`, `webhooks`, `work_counts`, `work_groups`, `work_records`, `write_back_log`, `z_object_anomalies`, `z_object_baselines`, `z_object_findings`, `z_object_profiles`, `z_object_registry`, `z_object_rules`

## 6. Secrets handling

| Secret | Where it lives | Protection |
|---|---|---|
| `JWT_SECRET` / per-tenant `jwt_secret` | `.env`, `tenants` row | 256-bit random (`secrets.token_hex(32)`); signs sessions and derives the Fernet key for stored LLM keys |
| `CREDENTIAL_MASTER_KEY` | `.env` | AES-256-GCM master; per-tenant key derived with the tenant id; `CREDENTIAL_MASTER_KEY_PREV` for a rotation window; `scripts/rotate-credential-key.py` re-encrypts every row |
| SAP passwords, OAuth client secrets | `system_credentials` (RLS) | encrypted as above; never returned by the API; decrypted only in the worker at connect time |
| LLM API keys | tenant settings | Fernet (`api/services/crypto.py`) |
| API keys, SCIM tokens, share-link tokens | database | SHA-256 digests only; the secret is shown once |
| Licence key, `LICENCE_SERVER_PUBLIC_KEY`, `MERIDIAN_OFFLINE_PUBLIC_KEY`, `LICENCE_SECRET` | `.env` | the two public keys are public; their signing keys stay in HQ. `LICENCE_SECRET` is a shared HMAC secret held by the customer, which is why an HMAC licence file can be forged by its holder (DR-3) |
| Updater shared secret | `.env` | constant-time compare, fails closed |

No secret is committed: `.env.example` holds empty values. Rotation of `JWT_SECRET` signs everybody out
(no key overlap); this is an accepted limitation listed in `docs/security/THREAT_MODEL.md` section 6.

## 7. Encryption

- **In transit, edge.** nginx terminates TLS 1.2 and 1.3 with HSTS in the HTTPS server block of
  `docker/nginx/meridian.conf`. That block ships commented out and no script in the repository uncomments it
  (D-11): an install that chooses self-signed or Let's Encrypt in `meridian-deploy.sh` gets certificates but
  nginx keeps serving HTTP on port 80. Until D-11 is fixed, TLS is the operator's step or a load balancer in
  front. Fixed in commit `a79e9ea8`: `scripts/nginx-https.sh` uncomments the 443 block and turns port 80
  into a 301 to HTTPS (health probes stay on 80); `meridian-deploy.sh` runs it after creating certificates
  and `update.sh` re-applies it after an update (`tests/test_nginx_https.py`). Self-signed or Let's Encrypt
  modes then serve HTTPS; mode 1 (no certificates) still serves HTTP.
- **In transit, inside the stack.** API, Postgres, Redis and Garage talk over the private Docker network
  `meridian-net`, unencrypted; only nginx publishes ports. Helm ships a NetworkPolicy
  (`helm/meridian/templates/network-policy.yaml`).
- **In transit, outward.** SAP cloud connectors, the licence worker and cloud LLMs over HTTPS; RFC uses
  the SAP NW RFC SDK (SNC is a customer configuration of the SDK).
- **At rest.** Application-level encryption of credentials and keys as in section 6. Database and object
  storage volumes are encrypted by the host or cloud disk, not by Meridian; the compliance screen
  (`GET /api/v1/settings/compliance`) reports `MERIDIAN_DB_ENCRYPTED_AT_REST` and
  `MERIDIAN_OBJECT_STORAGE_ENCRYPTED_AT_REST` as the operator declares them and never guesses.

## 8. Input hardening

| Input | Control | Proof |
|---|---|---|
| File upload | extension and magic bytes (`_validate_magic_bytes`), 100 MB cap read in 8 KB chunks, upload rate 30/min per tenant, nginx `client_max_body_size 100m` | `tests/test_upload_origin.py`, `tests/test_upload_path.py` |
| Spreadsheet formulas | cells starting `=`, `+`, `-`, `@` (also after leading whitespace) prefixed with `'`; columns mapped to a real SAP field are exempt only after the mapping is verified server-side | `api/routes/upload.py:429` |
| Exports | every XLSX export goes through `api/services/branded_xlsx.py`, which neutralises formula cells | `api/services/branded_xlsx.py:guard_formula_cell`; `tests/test_*_export_xlsx.py` (9 files) |
| SQL | bound parameters throughout; asyncpg type rules held by `tests/test_sql_param_intervals.py` | as named |
| Natural language query | parsed by rules into the fixed filter set of `GET /work/records`, no model in the request path; the optional model fallback (`MERIDIAN_NL_LLM=1`) sees only the unmatched words and must answer one phrase of a closed list (`api/services/nl_query.py`) | `tests/test_nl_query.py` |
| SCIM bodies | nginx `client_max_body_size 1m`, SCIM error schema for every failure | `tests/test_m2_scim_pg.py` |

## 9. The model and customer data

The agent graph receives `findings_summary` only: check id, module, severity, dimension, affected and total
counts, pass rate, message (`agents/state.py`; held by `tests/agents/test_state.py` and
`tests/agents/test_prompts.py`). Every number is computed before the model is called.

Two optional helpers send field values, and two more send metadata or hashes only. Values pass through `api/utils/pii_fields.py:sanitise_for_prompt`, which replaces the
values of 20 named personal-data fields (names, street, city, phone, email, tax numbers, bank account,
IBAN, birth date, nationality) with `[REDACTED]` and truncates the rest to 200 characters:

| Helper | What it sends |
|---|---|
| `api/services/ai_column_matcher.py` (upload column mapping) | up to 3 sample rows of the unmatched columns |
| `api/services/ai_semantic_matcher.py` (match and merge) | two candidate values of one field |
| `api/services/ai_survivorship.py` (golden record tie-break) | field names, source metadata and value hashes |
| `api/services/ai_glossary_enricher.py` | table, field, technical name and rule text, no record values |

The redaction keys on SAP field names, so a column whose header is not a SAP field name (for example a
spreadsheet header "Customer name") is not redacted before mapping. All of them run only when an LLM
provider is configured; with Tier 2 (bundled Ollama) or Tier 3 (customer endpoint) nothing leaves the
customer environment, and with `LLM_PROVIDER=none` none of them runs. The helpers log their calls
through `api/utils/llm_logger.py:log_llm_call` to `llm_audit_log` (readable at `GET /api/v1/audit/llm`). This is finding F-2 in section 15.

## 10. Rate limiting

`api/services/rate_limiter.py` (Redis fixed window, fails open):

| Endpoint | Limit | Key |
|---|---|---|
| `POST /api/v1/auth/login` | 10 / 60 s | IP |
| forgot password, reset password, accept invite, invite preview, change password | 5 / 60 s | IP (change password: user) |
| OIDC start and callback | 20 / 60 s | IP |
| upload | 30 / 60 s | tenant |
| SCIM | 1,200 / 60 s | IP |
| public theme and logo | 120 / 60 s | IP |
| notification test | 3 / hour | user |
| client error reports | 20 / 60 s | user |
| any API key | 600 / 60 s (`API_KEY_RATE_LIMIT_PER_MIN`) | key |
| RFC connection test | per tenant (`api/routes/connect.py:_check_rfc_rate_limit`) | tenant |

## 11. Audit log coverage

- **Automatic.** `api/middleware/audit.py` writes every POST, PUT, PATCH and DELETE under `/api/v1/` with
  actor, method, path, entity type and id parsed from the path, status code, IP and user agent. Writes are
  off the request path and drained on shutdown (`flush_pending_audits`, `tests/test_audit_flush.py`).
  Excluded: `/api/v1/auth/`, `/api/v1/licence`, `/api/v1/events`, and two prefixes whose routes write
  their own rows (client errors, API keys).
- **Explicit.** 33 modules call `write_audit` with before and after JSON: role and grant changes, sandbox
  enter and exit, purge, retention and compliance changes, share-link open and revoke, grid and
  configuration exports, OIDC sign-in events, API key create and revoke, server errors (with the reference).
- **Sign-in.** Password sign-in success and failure, lockout, sign-out and password change are in `audit_log`
  as `auth.login`, `auth.login_failed`, `auth.lockout`, `auth.logout` and `auth.password_change`
  (`api/routes/auth.py`, D-14 fixed). Reads are not audited except the exports above.
- **Retention.** `audit_days` (30 to 3,650) in the tenant retention policy; enforced by the nightly purge
  only after seven days of dry runs and with `MERIDIAN_PURGE_ENABLED` (see
  [data-governance.md](data-governance.md)). Export: `GET /api/v1/audit/export` (CSV stream, `tests/test_audit_export.py`).

## 12. Server error handler

`api/server_error.py:unhandled_exception_handler` is registered for `Exception` in `api/main.py:308`. It
logs the traceback under an 8-hex reference, writes a `server_error` audit row with the reference when the
tenant is known, and answers `500 {"detail": "Something went wrong on the server. Reference <ref>.",
"reference": "<ref>"}`. `HTTPException` keeps FastAPI's handler. The status page counts server errors by
reference for 24 hours. Proof: `tests/test_server_error_handler.py`.

Response headers from the API: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, `Server` removed; nginx adds its own set and, in the HTTPS block, HSTS.

## 13. Dependency scanning

| Gate | Workflow | Scope | Fails on |
|---|---|---|---|
| pip-audit, locked pins | `.github/workflows/dependency-audit.yml` (new) | `requirements.lock`, 134 packages, exactly what the images install | any advisory |
| pip-audit, floors | `.github/workflows/security-scan.yml` | `requirements.txt` resolved fresh | any advisory |
| npm audit, runtime | both workflows | `frontend`, `cloudflare/portal`, `cloudflare/licence-worker`, `cloudflare/llm-proxy`, `cloudflare/install-worker` with `--omit=dev` | high or critical |
| npm audit, full | both workflows | the same with development packages | report only |
| SBOM drift | `dependency-audit.yml` | regenerated SBOM vs the committed one | any component difference |
| Container CVEs | `.github/workflows/image-scan.yml` (Trivy) | the five production images | high or critical |

Results on 2026-10-30, `bash scripts/diligence_audit.sh` (raw JSON in `docs/diligence/generated/`):

| Scope | Result |
|---|---|
| Python, `requirements.lock` (134 packages) | 0 advisories |
| Python, `updater/requirements.txt` (resolved) | 0 advisories |
| frontend, runtime (195 packages) | 0 |
| frontend, all (965 packages) | 11: 1 critical, 5 high, 4 moderate, 1 low, all in development tooling |
| cloudflare/portal, runtime | 1 moderate (`qs` 6.7.0 to 6.16.0) |
| cloudflare/portal, all | 8: 1 critical, 6 high, 1 moderate |
| cloudflare/licence-worker, runtime / all | 0 / 18: 2 critical, 14 high, 1 moderate, 1 low |
| cloudflare/llm-proxy, runtime / all | 0 / 10: 2 critical, 5 high, 3 moderate |
| cloudflare/install-worker, runtime / all | 0 / 8: 7 high, 1 moderate |

## 14. SBOMs

CycloneDX, committed under `docs/diligence/sbom/` and checked for drift by `dependency-audit.yml`:

| File | Generator | Components |
|---|---|---|
| `python.cdx.json` | `cyclonedx-py requirements requirements.lock --of JSON --output-reproducible` (CycloneDX 1.6) | 134 |
| `frontend.cdx.json` | `npm sbom --sbom-format cyclonedx --omit dev --package-lock-only` (CycloneDX 1.5) | 193 |

Container base layers are covered by Trivy in `image-scan.yml`, not by these files.

## 15. Known findings

Every scanner finding and every finding of this review, with its disposition. "Handed over" means a
defect logged for the team that owns the file, with the expected behaviour, in
[roadmap-and-debt.md](roadmap-and-debt.md).

### Scanner findings

| ID | Finding | Ships to customers? | Disposition |
|---|---|---|---|
| S-1 | frontend dev: `proxy-addr` 1.1.0 to 2.0.7 critical, `body-parser` 2.0.0 to 2.3.0 high, `@modelcontextprotocol/sdk` up to 1.31.0 high, `@hono/node-server` moderate, `fast-uri` moderate, `ip-address` moderate, `qs` moderate, `undici` 8.0.0 to 8.12.1 high | no: all pulled in by the `shadcn` CLI (devDependency `^4.0.8`), which runs on a developer machine to add components | Accepted for runtime. Fix: upgrade or remove the `shadcn` devDependency (`npm audit fix` reports a fix is available for each); handed over to the frontend team (D-17) |
| S-2 | frontend dev: `shadcn` high, `zod` below 4.6.6 high, `deepmerge` low | no (same CLI) | as S-1; `npm audit` proposes `shadcn@1.0.0`, a major downgrade, so the right fix is removing the CLI from devDependencies |
| S-3 | cloudflare/portal runtime: `qs` 6.7.0 to 6.16.0 moderate (DoS in `qs.stringify` with `arrayFormat: comma`) | HQ portal on Cloudflare, not the customer stack | Accepted below the high gate; the portal does not stringify untrusted arrays with that format. Fix by `npm update qs` in `cloudflare/portal` (D-18) |
| S-4 | cloudflare workers dev: `wrangler`, `miniflare`, `vitest`, `vite`, `tinypool`, `undici`, `esbuild`, `ws`, `sharp` and others (critical and high) | no: build and local test tooling; the workers deploy only their bundled `src` (`dependencies: {}`) | Accepted for runtime; upgrade `wrangler` and `vitest` in each worker (D-18) |
| S-5 | Python and updater | n/a | 0 advisories; nothing to do |

### Review findings

| ID | Finding | Severity | Disposition |
|---|---|---|---|
| F-1 | The API image keeps its Python source. `docker/Dockerfile.api.prod` lines 62 and 103 strip `.py` with `find . -path "./db/migrations" -prune -o -name "*.py" -type f -delete`; GNU find refuses `-prune` together with `-delete` and exits 1 without deleting anything (reproduced with findutils 4.9.0, the Debian bookworm version; `docs/diligence/generated/source-strip-check.txt`). The first instance also skips the `__pycache__` cleanup through `&&`, and `\|\| true` hides both. The worker image's final stage uses a plain `find -name "*.py" ! -name "__init__.py" -delete` and does strip, except `__init__.py`. | High for the IP-protection claim; no customer-data impact | Fixed (D-01): both images compile `api llm sap workers db agents checks`, delete every `.py` outside `db/migrations` (including `__init__.py`) and fail the build if any source remains (`docker/Dockerfile.api.prod`, `docker/Dockerfile.worker.prod`). The expectation was: compile then delete with `find . -name "*.py" -not -path "./db/migrations/*" -delete`, also compile `db/` in the API image, and add a build step that fails if any `.py` outside `db/migrations` remains |
| F-2 | Optional AI helpers send sample values; redaction keys on SAP field names only (section 9) | Medium with a cloud LLM; none with Tier 2, Tier 3 or none | Disclosed. Recommendation: redact by mapped field after mapping, and offer "aggregates only" as a tenant switch (D-19) |
| F-3 | HTTPS block in nginx is never enabled by any script (section 7) | High for a default install | Fixed: `scripts/nginx-https.sh`, run by the installer for SSL modes 2 and 3 and by `scripts/update.sh` (D-11) |
| F-4 | No Content-Security-Policy on the frontend or nginx; session token in `localStorage` | Medium | Handed over (D-12, D-13) |
| F-5 | Password sign-in, sign-out and password change not audited | Medium for audit evidence | Fixed: `api/routes/auth.py` writes the `auth.*` rows (D-14) |
| F-6 | `/docs` and `/openapi.json` public through nginx | Low (schema disclosure, no data) | Fixed: served only in development or with `MERIDIAN_OPENAPI_PUBLIC=1` (`api/config.py`, D-15) |
| F-7 | `scripts/backup.sh` writes `.env` (with `CREDENTIAL_MASTER_KEY` and `JWT_SECRET`) in clear unless `--encrypt` | Medium | Fixed: encrypted with GPG by default, `--passphrase-file` for cron, `--plain-env` to opt out (`scripts/backup.sh`, `scripts/restore.sh`, D-16) |
| F-8 | `system_update_log` has RLS enabled but not forced | Low (platform rows written by the owner role) | Fixed: migration 117 forces it (D-07) |
| F-9 | CORS falls back to `*` without credentials when `CORS_ORIGINS` is empty (`api/main.py:352`) | Low: the API port is not published; browsers reach it through the same origin | Accepted; recommend failing closed outside development |
| F-10 | No external penetration test on record (`docs/security/pentest-scope.md` is a scope, not a report) | Process | Recommend one before the first enterprise renewal |
| F-11 | The licence is not enforceable: online response signatures are off unless `LICENCE_SERVER_PUBLIC_KEY` is set (blank in `.env.example`), and offline HMAC files are signed with a secret the customer holds (`api/middleware/licence.py` lines 134 to 145 and 437 to 444). Missed by the first version of this document, which said "none known" | High for revenue protection; none for customer data | DR-3: fixed; enforcement switches on after the worker rollout. Ed25519 signatures against the vendor key compiled into the image on every path, fail closed (`api/middleware/licence_keys.py`, `api/middleware/licence.py`); the transition window `MERIDIAN_LICENCE_ALLOW_LEGACY_SIGNATURES` is on by default until the licence worker is deployed with `LICENCE_SIGNING_KEY_ED25519`, after which a release turns it off |
| F-12 | The tenant is hard-coded (section 4). The first version of this document and architecture.md said it came from the token | High for any hosted or multi-tenant plan; none for a single-customer deployment | DR-4: fixed. Tenant from the verified token claim, per-tenant secrets, `tests/test_tenant_isolation_api_pg.py` |

## 16. Reporting a vulnerability

See [SECURITY.md](../../SECURITY.md) at the repository root.
