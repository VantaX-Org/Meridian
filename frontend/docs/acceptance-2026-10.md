# Acceptance run, October 2026

The acceptance a buyer would run, on the real product: the complete Meridian 2 (steps 0 to 10, after the cut-over),
brought up locally against a fresh database, walked as every role in a real browser. Not fixture mode.

Date: 30 October 2026. Branch: the backend finishing worktree after merging `m2-10f-ready`.

## Result

| Layer | Steps | Pass | Fail |
|---|---|---|---|
| Browser walk (`frontend/e2e/acceptance.spec.ts`, final run) | 21 | 18 | 3 |
| API checks behind the walk (each feature with its numbers, final outcome per step) | 66 | 66 | 0 |

The three browser failures are frontend defects, handed to the frontend polish builder (see "Handed over"). Twelve
backend defects were found on the way and fixed, each in its own commit (see "Fixed in the backend"); the API steps
that failed on their first attempt are listed with what was wrong.

## The stack

| Part | How it ran |
|---|---|
| Postgres | the shared server, a fresh database `meridian_accept`, `alembic upgrade head` from empty to 116 in one go; the API and workers connect as `meridian_app` (no superuser, no BYPASSRLS), so row-level security applies |
| Redis | `redis-server --port 6399 --save "" --appendonly no` |
| API | `uvicorn api.main:app --port 8010`, `MERIDIAN_ENV=development`, `AUTH_MODE=local`, `LLM_PROVIDER=none`, `LLM_KEK` and `CREDENTIAL_MASTER_KEY` generated locally |
| Worker and beat | `celery -A workers.celery_app worker --concurrency 2` and `beat` |
| Object storage | a small S3-compatible stand-in on port 9010 (Garage is not installable here); buckets created by the API at start |
| Email | a local SMTP sink on port 1025 with STARTTLS (the mail code always calls STARTTLS) |
| Webhook listener | a local https listener on port 8443 with a self-signed certificate the workers trust (`REQUESTS_CA_BUNDLE`); webhooks accept https only |
| Frontend | `npm run build`, then `next start` on port 3010 with `INTERNAL_API_URL` pointing at the API |
| Browser | the preinstalled Chromium through Playwright |

No SAP system is reachable. The data came in through the upload path with the deterministic synthetic extracts the
repository ships for tests (`tests/fixtures/realistic_sap_data.py`): business partner, 5,151 rows (5,000 partners and
their seeded duplicates, seed 42), and material master, 5,000 rows (seed 43), with seeded failures: bad partner
numbers, missing countries, `00000000` dates, missing material types and descriptions. No customer data.

## The walk, step by step

Numbers are the product's own, read from the screens and the API in this run.

### 1. Sign-in and users

| Step | What the screen or API showed | Result |
|---|---|---|
| First start | The API created `admin@meridian.local` with the password `admin` and logged it | pass |
| Default password | Sign-in answered `must_change_password: false`: the public default password went straight into the product | **defect, fixed** (now `true`; the interface sends the administrator to the change screen) |
| Change the password | 200 after a password not containing the email name ("Password must not contain your email name" for the first choice: correct) | pass |
| Six role users | Invited as programme lead, data steward, data owner, SAP Basis, analyst and auditor; each invitation link accepted and signed in. The sixth acceptance inside one minute got 429 (5 per minute per address, by design) and went through a minute later | pass |
| Users screen | "7 seats in use", every role named: Platform admin, Programme lead / CIO, Data steward, Data owner / approver, SAP Basis / integration admin, Analyst, Auditor | pass |
| Each role signs in and sees the landscape | lead, steward, owner and Basis: their role on the account button. Analyst and auditor (and the administrator): the account button says "Programme lead" | **3 fail, frontend** |

### 2. Data and the analysis

| Step | What happened | Result |
|---|---|---|
| Upload without a system | Business partner and material master uploaded, both runs finished in the worker (5 s and 15 s scoring). The landscape then said "No SAP system is connected yet" while Work listed 5,367 records to fix | pass, **frontend finding** |
| Register an ECC system | `ECC acceptance`, client 100. Connection test: "PyRFC is not installed", HTTP 200, no 500. A configuration load started by itself and failed; the job line read "Configuration load of Configuration load: ecc failed: pyrfc_not_installed: build the API image ..." | pass, **job label defect, fixed** |
| Uploads attached to the system | Business partner run 1: 5,151 records, 11 rules measured, measured 97.9, shown 70.0, capped by 4 critical rules over tolerance. Material master: 5,000 records, 34 rules, measured 98.9, shown 70.0, capped by 2 | pass |
| Business partner run 2 | The same extract with 400 countries filled in and 300 creation dates corrected: 3 critical rules over tolerance, still capped at 70.0 | pass |
| Work after the system runs | Work read material master from the old upload without a system (5,000 rows from the wrong run), because the current state kept only the system's newest run | **defect, fixed** |

### 3. The landscape, object, rule, run

| Step | What the screen showed | Result |
|---|---|---|
| Landscape (lead) | "2 of 2 objects are held under 85 by 5 critical rules over tolerance." 5,151 records checked, 11 rules measured. 0 go, 0 at risk, 2 no-go. Fixing BP002 and BP003 would release business partner | pass |
| Object canvas, business partner | 263 to fix, ZAR 132 k at risk, 0 features blocked, no-go for wave 1. Receipt: completeness 99.4 (weight 56%), uniqueness 100.0 (22%), validity 92.1 (22%), weighted 97.9, coverage 3.6% (low confidence), cap 70.0 by BP002, BP003, BP004 | pass |
| The receipt's formula line | "DQS = 0.25(U+00B7)C + ..." with the middle dot, from the API | **defect, fixed** (now "0.25 x C", the multiplication sign) |
| Object tabs | Rules (11), Records (263), Fixes, Runs, Readiness, Processes, Lineage, Glossary, Golden records: each opened, none showed the not-found page or a read error | pass |
| Rule canvas BP002 | Critical, validity, "184 failing across 1 object", 3.57% of records checked, ZAR 92 k at risk, over tolerance. Definition (regex `^[A-Z0-9]{1,10}$` on `BUT000.PARTNER`, SAP hard constraint), Failing records, Impact and History tabs all opened. The first visit took over 4 seconds to leave its skeleton | pass |
| Run canvas | Run of 04:15: 5,151 records, 11 rules, 1 object no-go | pass |
| Compare | The run canvas compared the business partner run with the system's previous run, which was the material master run: "the 0 rules that ran cleanly in both runs", nothing to read | **fail, frontend** |
| Compare through the API (run 1 against run 2) | 193 records no longer failing (the countries filled in), 264 still failing, 0 new; BP002 184 persisting | pass |
| Time travel | Business partner as of run 1: score 70.0, 5,151 records; failing records read 0 because the old run's work list is pruned | **defect, fixed** (now 367, from the run's stored failing records) |
| Runs | The attached uploads showed no trigger ("—") | **defect, fixed** (now "upload") |

### 4. Work: decision, fix, approval, exception, write-back

| Step | What happened | Result |
|---|---|---|
| Steward decides in the ledger | A new value and "fix" on one record and "not an issue" on another, from the row's own controls: "Waiting for approval" went from 0 to 1 | pass |
| Four eyes | The batch author was refused: "The batch creator cannot approve it." (403) | pass |
| Owner approves | "Approve batch B-..." on the Waiting for approval chip, the row left the list | pass |
| Fix batch through the API | 5 records of BP002 with corrected partner numbers, approved by the owner | pass |
| Send to SAP | The first export answered 200 with no body and dropped the connection, after marking the batch exported | **defect, fixed**; now a 13,127 byte workbook with its SHA-256 |
| Live write-back | Off by default (`live_enabled: false`). `POST /writeback` with a rule id instead of a finding id answered 500 | **defect, fixed** (422) |
| Write-back with a real finding, no SAP reachable | 200: "No structured auto_fix proposals found, nothing to apply", applied 0; no stack trace, no 500 | pass |
| Exception | The steward raised one; the lead and the Work chip show it (Exceptions 1, then 2) | pass |
| Auditor tries to change a record | 403 "Your role cannot apply." | pass |
| Record history (auditor) | The record across 3 runs, failing BP002 in each; events: fix proposed (1000009001), approved, exported | pass |

### 5. Fix simulation, reports, people

| Step | Numbers | Result |
|---|---|---|
| Top fixes | BP002 184 failing, BP004 60, BP003 20; each alone leaves the score at 70.0 (other breaches remain) | pass |
| Simulate BP002 and BP004 | 70.0 to 85.0, both breaches cleared, verdict changes | pass |
| Run prediction (Basis) | 10,151 records, 21.6 s (21.4 to 21.7), confidence low, no cost (no run cost set), starts next in the queue | pass |
| Analysis PDF | 53,159 bytes | pass |
| Board pack PDF from the Reports screen | downloaded `meridian_board_<run>.pdf` (60 kB) | pass |
| People | "0 of 1 person holds open work"; 1 batch waits for approval | pass |

### 6. Administration

| Step | Numbers | Result |
|---|---|---|
| Roles | Built-in roles listed | pass |
| Policy packs | GDPR (46 fields, 173 rules), SOX (48 fields, 128 rules), GxP (79 rules); GDPR and SOX applied. 0 rules measured: the test extract carries none of the classified fields (names, bank details) | pass |
| Webhook | Created to `https://localhost:8443/hook`; test send delivered in 1 attempt, listener answered 200, headers `X-Meridian-Event`, `X-Meridian-Delivery`, `X-Meridian-Timestamp`, `X-Meridian-Signature` | pass |
| Digest | Weekly for programme leads, Mondays 07:00 Africa/Johannesburg (next 2 Nov 2026 05:00 UTC); preview: the landscape, score moves, waves, approvals waiting (HTML 9,999 characters); send now: delivered 1, the SMTP sink holds "Meridian digest: Weekly leads digest" to lead@acceptance.test | pass |
| Sandbox | Entered from Settings: the latest run copied (11 findings, 264 failing records, 264 work rows, 3 groups), the banner "Sandbox: nothing leaves this deployment." on every screen; a decision made inside; exited and discarded | pass |
| Sandbox, second entry | The first time from the screen, entering committed and then answered 500: the tenant stayed in sandbox with an error on screen | **defect, fixed** (tenant context in every transaction) |
| Status page, signed out | Operational; API, database, cache and queue, workers, object storage up. Uptime first read 0% for the API: the worker probes `http://api:8000`, the compose name | config, **fixed for Helm** (the chart sets `MERIDIAN_API_INTERNAL_URL`); 90.91% at the end of the run |

### 7. Command line, help, themes, languages

| Step | What happened | Result |
|---|---|---|
| Command line | "BP019" finds the rule. "?critical business partner issues" shows "The filter that will run" and opens `/work?module=business_partner&severity=critical&filter=open` | pass |
| Plain words through the API | answered `href /v2/work`, the pre-cut-over address | **defect, fixed** (`/work`) |
| Help panel | Opens on the screen's chapter ("You are on Landscape"), the role walkthrough first, chapters searchable; "The Work ledger" chapter opens | pass |
| Themes | Dark and Light from the account menu; `data-theme` follows | pass |
| German and Japanese | "Landschaft", then "ランドスケープ", then back to "Landscape" | pass, **frontend finding** (help chapters stay in English) |
| Live job events | `/api/v1/jobs/events` answered 500 on every screen through the frontend: an idle stream never sent a byte | **defect, fixed** (heartbeat) |

## Fixed in the backend

One commit each; tests added where the defect could be pinned down.

1. The first-start administrator now has to change the public default password.
2. SSE streams send a first comment at once and a heartbeat every 15 seconds while idle (the heartbeat never fired).
3. The Helm chart sets `MERIDIAN_API_INTERNAL_URL` for the status page probe; `.env.example` and the install guide name it.
4. `POST /writeback` refuses a finding id that is not a UUID with 422.
5. The current state keeps every object of a system whose objects are run apart (Work, Home and every `scope=current` screen read material master from the wrong run).
6. The batch load file is sent as a plain response (it answered 200 with no body).
7. Work lists are pruned per object, not per system, and time travel reads a pruned run's stored failing records.
8. Plain-words questions link to `/work`, digests to `/`.
9. No middle dot in API answers (receipt formula, command line titles, the process deck); a test scans the backend.
10. Configuration and discovery jobs use the "Kind | object" label the job line strips, and a failed configuration load reads as a sentence.
11. Uploads attached to a system show as uploads on Runs.
12. The tenant context is set in every transaction of a request's session (reads after a commit ran with another or no tenant; the sandbox entry answered 500).

## Handed over to the frontend polish builder

| # | Screen | Steps | Expected |
|---|---|---|---|
| F1 | Account button and Preferences, start screen | Sign in as the platform administrator, an analyst or an auditor | The account button says the person's role (Platform admin, Analyst, Auditor); today it says "Programme lead" because `personaOf` in `lib/v2/hooks.ts` falls back to the lead persona and the label is the persona's. Preferences, start screen says "My role's default (Programme lead)" for the same users |
| F2 | Run canvas, Compare | Open the newest business partner run of a system whose material master was run separately; Compare with the default | The default "Compare with" is the previous run that measured the same objects (here business partner run 1), not the system's previous run of another object, which compares nothing ("0 rules that ran cleanly in both runs") |
| F3 | Landscape, empty state | Upload files without attaching them to a system | The landscape says "No SAP system is connected yet" while Work lists 5,367 records. Show the uploaded objects, or say that uploads without a system are on Work and Runs and offer to attach them to a system |
| F4 | Every status line (`.m2-dot`) | Any screen: "5,151 records checked (dot) 11 rules measured" | `design/v2/v2.css` line 39 drew the middle dot through a CSS escape in `content`, which the no-middle-dot test could not see; **fixed**: the separator is a disc and the test now checks CSS escapes and HTML entities too |
| F5 | Object receipt fixtures | `lib/api/v2/fixtures/receipts.json`, `design/v2/__tests__/Object.test.tsx` | The API's formula is now "DQS = 0.25 x C + ..." (U+00D7); the fixture and the test still expect U+00B7 |
| F6 | Help panel in German and Japanese | Switch the language, open Help | Chapter titles and summaries are English ("Walkthrough: SAP Basis", "Meridian in three minutes") inside German or Japanese chrome |
| F7 | Command line, the filter chips | Type "?critical business partner issues" | The chip reads "Severity severity critical (critical)": the slot name is repeated before the API's own label |
| F8 | Every screen, background reads | Open any screen for 30 seconds | `GET /api/v1/jobs?limit=100` ran 84 times in 30 seconds across six screens; the rule canvas took over 4 seconds to leave its skeleton on first visit. Poll the job list once per shell, and lean on `/jobs/events` |
| F9 | Run canvas, Runs | A run uploaded before the trigger fix | Shows "trigger —"; the API's run timeline now answers "upload" for these, the run canvas reads `metadata.trigger` only |

## Rerunning the walk

`frontend/e2e/acceptance.spec.ts` is skipped unless `ACCEPTANCE_BASE_URL` is set. Its header lists what the stack must
hold first. It signs in once per role and reuses the session (the API allows ten sign-ins a minute from one address).
It changes data: run it on an acceptance tenant only.
