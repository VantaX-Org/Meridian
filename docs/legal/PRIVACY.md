# Privacy policy — Meridian Platform

**TEMPLATE — have qualified counsel review before publishing.**

_Effective date: {{EFFECTIVE_DATE}}. Controller: {{LICENSOR_LEGAL_NAME}} ("we", "us"). Contact: privacy@{{DOMAIN}}._

This policy describes how we handle personal information in connection with the Meridian software and our customer-facing HQ portal. It is intended for:
- Prospective customers evaluating Meridian
- Existing customer administrators
- End users of the HQ portal

## 1. What Meridian processes

Meridian is a self-hosted data-quality platform. Your organisation installs it on its own infrastructure. Three distinct data contexts exist:

### 1a. Data processed by your Meridian deployment
This data stays on your infrastructure. We have no access to it. It includes:
- Your SAP master-data and transactional extracts
- Data quality findings derived from those extracts
- User accounts of people logging into your dashboard (email, name, password hash, role)
- Audit logs of every state-changing API call

We do not receive, process, or store any of the above.

### 1b. Data sent to our licence service
Every six hours (and on startup), your deployment sends a single HTTPS request to our Cloudflare-hosted licence worker containing:
- The licence key we issued you
- A machine fingerprint (SHA-256 of hostname + MAC address — opaque to us)

The response contains your licence manifest and no customer data. We store only the licence key hash, the machine fingerprint, the timestamp of the most recent validation, and counts of validations per tenant.

### 1c. Data you give us directly
If you interact with our HQ portal, sales team, or support team, we process:
- Account contact details (name, business email, company, job title)
- Billing information (company name, address, tax identifier)
- Support tickets and correspondence

## 2. Legal bases

Where GDPR / POPIA applies, we process personal information on the following bases:
- **Contract** — we need the data to perform the contract with your organisation (account management, support, billing).
- **Legitimate interests** — operating the licence service, detecting abuse, internal analytics. Balanced against your reasonable expectations.
- **Legal obligation** — tax records, responding to lawful regulator requests.

## 3. Retention

| Category | Retention |
|---|---|
| Licence validation records | For the duration of your contract plus 24 months |
| Support tickets | 36 months from ticket closure |
| Billing records | 7 years (statutory retention in most jurisdictions) |
| Marketing consent records | Until withdrawn plus 24 months |

Data inside your Meridian deployment is retained per your own policies — we cannot delete it because we do not have access.

## 4. Sub-processors

We use the following sub-processors for the HQ services (licence worker, HQ portal, support tooling):
- Cloudflare (USA/global edge) — DNS, TLS termination, Worker/D1/Pages hosting
- {{EMAIL_PROVIDER}} — transactional email
- {{BILLING_PROCESSOR}} — payment processing (billing data only, never SAP data)
- {{ANALYTICS_PROVIDER}} — web analytics on the marketing site (not the product)

The up-to-date sub-processor list is maintained at {{SUBPROCESSOR_URL}}.

## 5. Your rights

Depending on your jurisdiction, you may have rights to access, correct, delete, export, or restrict processing of your personal information. Contact privacy@{{DOMAIN}}. We will respond within thirty (30) days.

Note: data that lives inside your Meridian deployment is under your control — we cannot action DSARs against it on your behalf. Contact your own data-protection officer for those.

## 6. Security

Our approach to securing the HQ services is described in `docs/security/THREAT_MODEL.md` and `docs/security/DATA_FLOW.md`. Key points:
- TLS 1.2/1.3 on every external hop
- PBKDF2-hashed passwords with per-row salt
- TOTP MFA available on HQ portal admin accounts
- JWT revocation via session-table lookup
- Dependency + container scanning on every release
- Weekly pen-test-style internal review

Your Meridian deployment's security is your responsibility. We provide deployment guidance, FORCE ROW LEVEL SECURITY defaults, a non-superuser database role, and a backup/restore runbook.

## 7. International transfers

The HQ licence worker runs on Cloudflare's global edge network. If you are in the EU/UK or another region with data-transfer restrictions, the standard contractual clauses included in the Data Processing Agreement apply.

Your deployment runs wherever you install it. No cross-border transfer occurs on our side for your SAP data.

## 8. Changes

We may update this policy from time to time. Material changes will be notified via email to your registered account contact at least thirty (30) days before they take effect.

## 9. Contact

{{LICENSOR_LEGAL_NAME}}
{{REGISTERED_ADDRESS}}
privacy@{{DOMAIN}}

If we have not adequately addressed your concern, you may lodge a complaint with your local data-protection authority.
