# Data governance

What data the product holds, where it lives, how long it stays, how it is deleted, and how the product
supports a customer's own governance (GDPR, SOX, GxP). Measured at commit `5cf7161c`.

## 1. Where SAP data lives

```
SAP system ──(read-only extraction in the customer network)──> customer host
                                                                ├─ object storage (Garage): parquet per table per run
                                                                └─ Postgres: findings, failing records and their values,
                                                                   scores, work items, golden records (RLS per tenant)
Cloudflare (HQ) <── licence key + SHA-256 machine fingerprint only
LLM provider    <── aggregated findings (agent graph); optional helpers as in security.md section 9
```

- SAP data is extracted by the customer's own deployment, stored on the customer's host and never sent to
  the vendor. The only outbound call to vendor infrastructure is licence validation, whose payload is the
  licence key and a hash of hostname and MAC (`api/middleware/licence.py`).
- The model provider is the customer's choice (security.md section 9). With Tier 2 (bundled Ollama), Tier
  3 (customer endpoint) or no model, no data leaves the customer environment at all.
- `GET /api/v1/settings/compliance` (the Compliance screen in Administration) states, from the running
  configuration, the database and object-storage hosts, the model provider and whether it runs inside the
  deployment, retention days, encryption-at-rest flags declared by the operator, and the last backup.
  Anything the process cannot see is shown as unknown, never guessed.

## 2. What is stored

| Family | Tables (examples) | Contains SAP values? | Personal data? |
|---|---|---|---|
| Extracts | object storage, one parquet prefix per run | yes, the extracted columns | yes when the extracted tables hold it (names, addresses, bank data, HR data) |
| Findings | `findings`, `finding_records`, `record_issues`, `field_profiles` | failing values of the failing fields, record keys | as above, limited to failing fields |
| Work | `work_records`, `remediation_batches`, `remediation_items`, `work_counts` | current and proposed values | as above |
| MDM | `master_records`, `match_scores`, `glossary_terms` | golden record values | as above |
| Configuration | `config_inventory`, `config_snapshots`, `config_processes`, ... | SAP customising values | no |
| People and access | `users`, `user_role_scopes`, `api_keys`, `scim_*` | no | names and emails of the customer's users |
| Trail | `audit_log`, `llm_audit_log`, `purge_log`, `skipped_deliveries` | `audit_log.before_json/after_json` can carry changed values | actor emails, IPs, user agents |

160 tables in total; 153 carry `tenant_id` and all 153 have row-level security (security.md section 5).
`llm_audit_log` stores a hash of each prompt, not its content (`api/utils/llm_logger.py`).

## 3. Retention and deletion

| Mechanism | What it deletes | Guard |
|---|---|---|
| Retention policy (`tenants.retention`, `PUT /api/v1/settings/compliance` and `/settings/retention`) | archived analysis versions older than `versions_days` with everything keyed to them, reports older than `reports_days`, audit rows older than `audit_days` (minimum 30) | never the pinned baseline, never the newest `keep_latest_per_system` runs, never a version with open work |
| Nightly purge (`workers.tasks.purge_expired`, 02:30 UTC) | applies the policy | dry run every night; deletes only with `MERIDIAN_PURGE_ENABLED` on and 7 days of dry runs under the current policy (`api/services/retention.py`); each run writes `purge_log` and an audit row |
| Delete one run (`DELETE /api/v1/versions/{id}`) | one version, children before parents in one transaction, then its storage objects | refuses with open work; storage failures recorded on the `purge_log` row |
| Handover purge (`scripts/purge_tenant_data.py`) | every tenant-keyed row and extract, keeping users and system connections | table list derived from the live schema and foreign keys; refuses if a kept table would be emptied |
| Weekly archive (`workers.scheduler.weekly_archive`) | nothing: hides old versions so the retention policy can later select them | |
| Health samples | older than 35 days | |

Tenant assets (golden records, learned rules, glossary terms, contracts, exceptions, the tenant's own
rules) are never deleted by the version purge; pointers to a purged version are cleared.

## 4. GDPR-relevant processing

Under GDPR the customer is the controller of the SAP data and Meridian, run by the customer, is its tool;
the vendor processes only licence data (`docs/legal/DPA.md`, a template awaiting counsel).

| Requirement | What the product provides | Gap |
|---|---|---|
| Data minimisation | extraction plans name the tables and fields per module (`sap/extraction_registry.py`, `sap/extraction_plan.py`); findings keep only failing fields | no per-field exclusion switch for extraction |
| Storage limitation | retention policy and nightly purge (section 3) | off until the operator enables it (by design) |
| Security of processing | RLS, encryption of credentials, role model, audit (security.md) | volume encryption is the host's responsibility |
| Records of processing | audit log, `llm_audit_log`, `purge_log`, compliance statement | |
| Personal data in model prompts | 20 named personal-data SAP fields redacted before any prompt (`api/utils/pii_fields.py`) | redaction by field name only (security.md, F-2) |
| Data subject access and erasure | record history shows every run and decision for one record key (`GET /api/v1/work/records/{module}/{key}/history`); users can be deleted (`api/routes/users.py`) | no subject-access export or erasure across extracts and findings; SAP is the system of record and erasure there flows into the next run, but stored past runs keep the values until purged (D-27) |
| Special categories | the GDPR policy pack's `special_category` class marks the fields | |

## 5. Policy packs

Static packs in `sap/policy_packs.yaml`, applied per tenant with `POST /api/v1/policy-packs/{id}/apply`
(`api/services/policy_packs.py`, migration 113). Applying a pack tags field classes with the catalogue
rules that evidence them; the evidence is read from stored findings, deterministically:

| Pack | Authority | Classes | Evidencing rules |
|---|---|---|---|
| GDPR personal data | Regulation (EU) 2016/679 | 5: identity, contact, national identifier, employee bank, special category | 173 |
| SOX financial controls | Sarbanes-Oxley Act of 2002 | 5: G/L master, journal entries, vendor bank, customer bank, payment terms | 128 |
| GxP batch and quality | 21 CFR Part 211 and EudraLex Volume 4 | 4: batch identity, shelf life, quality inspection, deviations | 79 |

A class is "in breach" for a run and object when a critical evidencing rule fails on a record; the count
appears on the landscape cell and the object receipt, and `?policy=sox:vendor_bank` filters the work
ledger. The counts above are read from `sap/policy_packs.yaml` (classes and the rule ids each lists).

## 6. Sandbox mode

`POST /api/v1/admin/sandbox/enter` (`api/services/sandbox.py`, migration 115) copies the latest finished run
into a sandbox run and sets `tenants.sandbox`. While it is on:

- every decision lands on the sandbox copy (scope `sandbox:<scope>`); a decision on a real run is refused;
- every outbound sender checks the flag and records what it would have sent in `skipped_deliveries`
  instead: alert and user emails, Slack and Teams posts, webhooks, digests, report mailouts and SAP
  write-backs.

`POST /api/v1/admin/sandbox/exit` discards the sandbox run and everything keyed to it. Both are audited.
Proof: `tests/test_m2_sandbox_pg.py`. It lets a buyer or a new customer train staff on real findings with
no risk of a write reaching SAP.

## 7. Audit trail

- Every mutating API call (security.md section 11), plus explicit before/after rows for role, grant,
  retention, sandbox, purge, share-link, export and API-key events.
- Every model call made through the AI helpers (`llm_audit_log`: service, model version, prompt hash, token
  count, latency, success).
- Every purge (`purge_log`, dry or real, rows by table, storage errors).
- Every held delivery in sandbox (`skipped_deliveries`).
- Per record: the history endpoint above joins record issue events, fix batch items, approvals and sends
  in order, so "who changed this value, when, and was it approved" is one query.
- Export: `GET /api/v1/audit/export` (CSV), readable by `view_audit` or `manage_users`.
- Gap: password sign-in and sign-out are not in `audit_log` (D-14).
