# First live deployment: the checklist

A step-by-step runbook for the first deployment of Meridian on a customer's own host, from an empty Linux server to a
first run whose numbers the customer's SAP team has proved by hand. Work through it in order and tick each box; each
step names the command or the screen and what you should see. The administrator training
(`docs/admin-training/meridian-administrator-training.md`) explains every step in depth; the module is named beside
it.

Roles: **A** the customer's Meridian administrator, **B** the SAP Basis colleague, **S** the SAP team that proves the
numbers, **V** the vendor's deployment engineer (on a call; never with access to SAP data).

## 0. Before the day

- [ ] **A** The host meets `docs/prerequisites.md`: Linux, Docker 24 or later, `curl`, `python3`, `openssl`, `gpg`,
      root access, and at least the minimum memory and disk listed there (more with a local language model).
- [ ] **A** `sudo bash scripts/preflight.sh` passes on the host.
- [ ] **A** A DNS name for the host, and the certificate route decided: Let's Encrypt (the name must be reachable on
      port 80), or the customer's own certificate.
- [ ] **A** Outbound HTTPS from the host to the licence server (online licence) and to `ghcr.io` (images), or an
      offline licence token and an image tarball for an air-gapped host (`docs/air-gapped-deployment.md`).
- [ ] **B** Network access from the host to the SAP application servers (RFC, port 33nn) or to the SAP cloud APIs.
- [ ] **B** The read-only role created from `docs/sap/authorisation-role-template.md` (for example `Z_MERIDIAN_READ`)
      and assigned to a system or communication user. Its table authorisations cover the modules of the first run.
- [ ] **A** The licence key (online) or the signed offline token from Meridian HQ.

## 1. Install (training module 1)

- [ ] **A** `sudo bash scripts/meridian-deploy.sh`; answer the server name, the LLM tier and the SSL mode, and the
      first administrator (email, name, password). The installer writes `.env` with fresh secrets, migrates the
      database, creates the administrator and starts the stack.
- [ ] **A** `docker compose -f docker/docker-compose.customer.yml ps`: every service is `running` or `healthy`.
- [ ] **A** Note the release installed: `grep MERIDIAN_VERSION docker/.env`, and the version in `/health`.

## 2. HTTPS (training module 1)

- [ ] **A** SSL mode 2 (self-signed, then replace with the customer's certificate in `nginx/certs`) or 3 (Let's
      Encrypt). Never mode 1 on a live deployment.
- [ ] **A** `https://<server>/` shows the sign-in page; `http://<server>/` redirects to it.
- [ ] **A** `curl -s https://<server>/health` prints `"status": "ok"`.
- [ ] **A** `/docs` answers 404 (API documentation is hidden outside development).

## 3. First administrator (training modules 1 and 3)

- [ ] **A** Sign in with the administrator from the installer and set a new password (12 characters or more) when
      asked.
- [ ] **A** Administration, Single sign-on: connect the identity provider and **Test sign-in**, if the customer uses
      one. Keep the administrator's password sign-in as the way in if the provider is down.
- [ ] **A** Administration, Audit log: `auth.login` and `auth.password_change` are recorded.
- [ ] **A** Invite the SAP Basis colleague now, so section 5 does not wait on them: the start screen of a new tenant
      offers **Invite SAP Basis**, which opens the invitation with the SAP Basis role. Invite the SAP team that will
      prove the rules in section 8 as well (Administration, Users, **Invite a user**, role Analyst or Auditor).

## 4. Licence (training module 2)

- [ ] **A** Administration, Licence: **Check with Meridian HQ now**. It reads **Valid**, with the company, tier,
      seats, expiry and the licensed modules.
- [ ] **A** Air-gapped: `MERIDIAN_LICENCE_MODE=offline` and `MERIDIAN_LICENCE_TOKEN` in `.env`; the same screen
      reads **Valid**.

## 5. Connect SAP with the read-only role (training module 4)

- [ ] **B** Connect a system (`/s/new`): the system type, the application server or message server, the system
      number, the client, and the user with the read-only role.
- [ ] **B** **Test connection** passes. A refusal names the missing authorisation; SU53 in SAP shows the check.
- [ ] **B** `MERIDIAN_RFC_READ_FUNCTION` set to the table reader the Basis team accepts (`RFC_READ_TABLE` by
      default).
- [ ] **B** Confirm the user has no change authorisation: with this role Meridian cannot change SAP data.

## 6. First extraction (training module 5)

- [ ] **B** In the system inspector, **Dry run** the objects of the first run (for example Material master and
      Accounts payable): rows per table and an estimated duration.
- [ ] **B** Administration, Start and schedule: **Start an extraction** of those objects, full (not changes only),
      with **Analyse straight after extracting**.
- [ ] **B** Runs, Jobs: the extraction finishes; no table is marked incomplete. A failed job reads in plain words with
      **Retry**.

## 7. First run (training module 6)

- [ ] **A** The run is on **Runs** with its records, rules and score. The landscape shows each object's score as a
      ruler; a capped score reads with both numbers ("70.0 capped, 71.8 measured").
- [ ] **A** Open one object's receipt and read the arithmetic of its score.

## 8. Reconcile three rules in SE16 (training module 11)

Before anyone acts on a number, the customer's SAP team proves three of them by hand. Do it within a day of the
extraction, so SAP's data has not moved far from what Meridian read.

- [ ] **S** Choose three rules of the first run: one completeness rule whose **Prove in SAP** says "One SE16N
      selection on ... gives the failing count", one value-list rule (a check-table lookup), and one rule with a join
      or a condition SE16 cannot express.
- [ ] **S** For each: open the rule, **Prove in SAP**; in SAP, enter the table and the **Population** rows, count and
      compare; add the **Failing** rows, count and compare; apply the conditions as written.
- [ ] **S** Look up the five failing record keys in SE16 and confirm each fails for the reason the rule gives.
- [ ] **S** **Download the reconciliation workbook** of the run; fill in **SE16 count** and **Match** for the three
      rules (and as many of the ten as time allows). Keep it with the go-live records.
- [ ] **A** A mismatch: rerun the extraction and the rule, then count again within the hour. If it still differs,
      record the rule, the run and both counts and raise it with the vendor (section 11).

## 9. Cost model (training module 6)

- [ ] **A** Administration, Settings, Cost model and currency: set the currency and the cost of one failing record by
      severity with the customer's finance owner, and **Save cost model**. Until it is saved every amount reads
      **default estimate**.
- [ ] **A** Dimension weights, score bands and the cap tolerance agreed and saved (the DAMA defaults are a fine
      start).

## 10. Users (training module 3)

- [ ] **A** Administration, Users: invite the stewards, owners, the SAP Basis colleague and the auditor with their
      roles, scoped to their systems or objects where needed. The seat meter stays within the licence.
- [ ] **A** Or provision through SCIM with group-to-role mappings.
- [ ] **A** Each person signs in once and lands on the start screen of their role.

## 11. Before you leave: operations (training module 9)

- [ ] **A** `sudo bash scripts/backup.sh --passphrase-file <file> --output <dir>` runs, and a restore drill
      (`scripts/restore.sh <backup-dir> --drill`) succeeds. The backup is scheduled.
- [ ] **A** Updates: `sudo bash scripts/update.sh --version <release>` installs and pins a named release;
      `--rollback` returns to the previous one (`docs/meridian-update-guide.md`).
- [ ] **A** A schedule for the next extractions (Changes on weekdays, Everything weekly).

## 12. What to send back to the vendor, and what never leaves the site

Send to the vendor (nothing in this list holds SAP data):

- The release installed (`MERIDIAN_VERSION` and the `/health` version) and the date.
- The diagnostics bundle (Administration, Platform and updates, **Download diagnostics bundle**): versions, health
  checks, recent errors and configuration with every secret removed; it holds no SAP record values.
- For a reconciliation mismatch: the rule id, the run id, Meridian's two counts, the SE16 count and the SE16
  selection your team used. Not the record keys or values.
- The checklist with its boxes ticked, and the open items.

Never leaves the site:

- SAP data of any kind: extracts, record keys and values, findings, reports, the reconciliation workbook (it holds
  record keys), screenshots of records, the database and its backups.
- `.env` and every secret in it (database, encryption and licence keys, the SAP user's password, SSO and SMTP
  secrets), the backup passphrase, certificates and their private keys.
- User lists, email addresses and the audit log.

Meridian HQ receives only the licence validation (the licence key and a machine fingerprint); no SAP data, finding or
report is ever sent to it.
