# Data Processing Agreement — Meridian Platform

**TEMPLATE — have qualified counsel review before signing.**

_This Data Processing Agreement ("DPA") forms part of the Meridian End-User Licence Agreement ("EULA") and Order Form between {{LICENSOR_LEGAL_NAME}} ("Processor", "we") and the customer identified on the Order Form ("Controller", "you"). It governs the processing of Personal Data by the Processor on behalf of the Controller in the course of providing the Meridian platform._

## 1. Definitions

Terms defined in the EU General Data Protection Regulation ("GDPR") and the South African Protection of Personal Information Act ("POPIA") apply as defined there. "Personal Data" has its GDPR Article 4(1) meaning.

## 2. Subject matter and scope

2.1 The Processor provides the Meridian software, hosted by the Controller in the Controller's own computing environment. Personal Data within the Meridian deployment is processed by the Controller itself; the Processor has no access.

2.2 The Processor additionally provides a hosted Licence Service to which the Meridian deployment connects every six hours for licence validation. The Licence Service processes a minimal, defined set of Personal Data described in Annex I.

2.3 This DPA applies to the Personal Data processed via the Licence Service and via direct interactions between the parties (support, sales, billing). It does **not** apply to the Personal Data processed inside the Controller's own Meridian deployment, because that is not processed by the Processor.

## 3. Duration

This DPA remains in force for the duration of the EULA. Obligations relating to confidentiality, deletion, and audit survive termination.

## 4. Nature and purpose of processing

See Annex I.

## 5. Controller obligations

5.1 The Controller warrants that it has a lawful basis for all Personal Data it submits to the Licence Service (namely, its own end-user licence key + machine fingerprint).

5.2 The Controller is solely responsible for the security and lawful processing of all Personal Data inside its own Meridian deployment. The Processor provides deployment guidance but is not the processor of that data.

## 6. Processor obligations

6.1 The Processor will:
- Process Personal Data only on the Controller's documented instructions, as set out in this DPA and the EULA;
- Ensure that persons authorised to process the Personal Data are subject to appropriate confidentiality obligations;
- Implement the technical and organisational measures described in Annex II;
- Not engage a sub-processor without the Controller's general authorisation granted below;
- Assist the Controller in meeting its obligations regarding data subject requests, breach notification, and DPIA consultation;
- Make available to the Controller the information necessary to demonstrate compliance;
- Delete or return all Personal Data at the end of the contract, unless law requires continued storage.

## 7. Sub-processors

7.1 The Controller authorises the Processor to engage the sub-processors listed in Annex III.

7.2 The Processor will notify the Controller at least thirty (30) days in advance of any intended changes to sub-processors. The Controller may object within fifteen (15) days; if the objection cannot be resolved the Controller may terminate the EULA for the affected service.

## 8. International transfers

8.1 The Licence Service is operated on Cloudflare's global edge network, which includes facilities outside the EEA/UK.

8.2 For transfers of Personal Data subject to the GDPR or UK GDPR from the EEA/UK to a country not recognised as providing an adequate level of protection, the Standard Contractual Clauses (Commission Decision 2021/914, Module 2) are incorporated by reference into this DPA, with the following specifics:
- Clause 7 (docking clause): included.
- Clause 11(a) (optional redress): not applicable.
- Clause 17 (governing law): the laws of {{GOVERNING_LAW_JURISDICTION}}.
- Clause 18 (forum): the courts of {{COURTS_LOCATION}}.
- Annex I.A (parties): as identified on the Order Form.
- Annex I.B (processing): Annex I of this DPA.
- Annex II (measures): Annex II of this DPA.
- Annex III (sub-processors): Annex III of this DPA.

## 9. Personal Data breach

9.1 The Processor will notify the Controller without undue delay and, where feasible, within seventy-two (72) hours of becoming aware of a Personal Data breach affecting the Processor's processing under this DPA.

9.2 Notification will include (to the extent known) the nature of the breach, categories and approximate numbers of data subjects affected, likely consequences, and measures taken.

## 10. Audit

10.1 The Processor will make available to the Controller, on reasonable notice and no more than once per contract year (except in the case of a suspected or actual breach), the most recent independent audit report and any additional information reasonably required to demonstrate compliance.

10.2 On-site audits are permitted where the Controller can demonstrate a specific lawful requirement that cannot be satisfied by the above, subject to reasonable notice and during business hours.

## 11. Deletion and return

11.1 On termination of the EULA, the Processor will delete or return all Personal Data held by the Licence Service and sub-processors, within thirty (30) days. Certification of deletion will be provided on request.

---

## Annex I — Processing details

**Categories of data subjects:** Controller's employees using the Meridian HQ portal.

**Categories of Personal Data (via Licence Service):**
- Licence key (does not directly identify a person)
- Machine fingerprint (SHA-256 of hostname + MAC; does not identify a person)
- Timestamps of validation calls

**Categories of Personal Data (via direct interaction — HQ portal, support, billing):**
- Name, business email
- Company, job title
- Billing address, tax identifier, payment method reference (no PAN — handled by PCI-compliant billing processor)
- Support correspondence

**Frequency:** continuous (Licence Service), ad-hoc (direct interactions).

**Duration:** for the duration of the contract plus the retention periods specified in the Privacy Policy.

**Nature and purpose:** as set out in the EULA.

---

## Annex II — Technical and organisational measures

The Processor implements and maintains the following measures, further described in `docs/security/THREAT_MODEL.md` and `docs/security/DATA_FLOW.md`:

1. **Access control** — PBKDF2 password hashing, per-row salt, constant-time compare, account lockout after repeated failed attempts, TOTP MFA available, JWT revocation via session lookup.
2. **Transport security** — TLS 1.2 / 1.3 on every external hop.
3. **At-rest encryption** — for the Processor's data: SHA-256 hashed licence keys in D1, PBKDF2-hashed admin passwords. For Controller-side data: the Processor does not process Controller-side data.
4. **Auditing** — every admin mutation recorded in `admin_audit` with actor, action, entity, timestamp, IP, user-agent.
5. **Vulnerability management** — weekly dependency scanning (dependabot, pip-audit, npm audit), weekly container image scanning (Trivy), CVE remediation within the supported release series.
6. **Monitoring** — Prometheus + Alertmanager stack with alerting for service availability, error rate, latency, audit backlog, LLM availability, licence validation health.
7. **Backups** — the Processor's hosted services are backed up via Cloudflare D1 time-travel (up to 30 days) and regular snapshots.
8. **Personnel** — access to production systems is restricted to named personnel with MFA.
9. **Change management** — all code changes pass through pull-request review and CI security scans before deployment. Deployments are tagged and version-controlled.

---

## Annex III — Authorised sub-processors

| Sub-processor | Service | Location |
|---|---|---|
| Cloudflare, Inc. | Licence Service hosting (Workers, D1, KV), HQ portal hosting (Pages), TLS termination, DNS, WAF | Global edge |
| {{BILLING_PROCESSOR}} | Payment processing (billing details only; no SAP data) | {{BILLING_LOCATION}} |
| {{EMAIL_PROVIDER}} | Transactional email (invoices, security notifications) | {{EMAIL_LOCATION}} |
| {{SUPPORT_TOOL}} | Support ticket management | {{SUPPORT_LOCATION}} |

The up-to-date list is maintained at {{SUBPROCESSOR_URL}}. Updates notified per Section 7.

---

_Signed on behalf of {{LICENSOR_LEGAL_NAME}} (Processor):_
_Name, title, date._

_Signed on behalf of Controller:_
_Name, title, date._
