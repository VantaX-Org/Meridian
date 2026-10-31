# Wave 2: the screens for workflows and change requests, the next-step inbox, and the journey fixes

Source of scope: PR #541's body ("The screens for workflows and requests, the per-role next-step inbox and the
screen side of the journey fixes come in the next wave") and `docs/journeys/friction-audit.md` (F01 to F35).

Base: `main` after #541 is merged. Each package is built in its own worktree on its own branch, then merged into one
branch `claude/wave2-journeys` and opened as one PR.

## Rules every package follows

- Read `CLAUDE.md` and `frontend/DESIGN.md` first. One interface (`frontend/app/(v2)`), one component library
  (`frontend/design/v2`), tokens only (`npm run lint:tokens`), no middle dot, every string through `lib/v2/i18n` with
  en, de and ja entries (`node scripts/i18n-extract.mjs` reports 0 untranslated, 0 missing, 0 gaps).
- Fixture mode (`?fixture=1`) answers every new read; add fixtures for every new endpoint the screens call.
- Every new route under `app/(v2)` maps to a help chapter (`lib/v2/help.test.ts`).
- Backend: Python 3.12, type hints, Pydantic bodies, tenant RLS, permission checks. Tests in `tests/`.
- Commit messages in plain prose, ending with the session trailers. No pushing; the coordinator merges.
- Verify before reporting: `cd frontend && npx tsc --noEmit && npx vitest run <touched tests> && npm run lint:tokens &&
  node scripts/i18n-extract.mjs`; backend `pytest` on touched tests.

## Package A: workflows and change requests screens

- Change requests: a Requests screen (list with views mine, to approve, all; status, object and kind filters), a
  new request form (object, kind, fields; validate shows the rule pre-checks and duplicates; submit), a change
  request inspector kind (`?open=request:{id}`) with workflow steps, history, comments, attachments, decide, cancel,
  retry, export.
- Workflows administration: `/admin/workflows` listing definitions and versions, a version editor, the validate dry
  run with sample facts, activate. Gated on `manage_workflows` (already in `lib/rbac.ts`).
- Workflow tasks decide (approve or reject with a reason) from the inspector of the thing being approved.
- Help chapters and fixtures for both.

## Package B: the next-step inbox per role and the hand-offs

- A per-role next-step inbox: one ordered list of what waits for this person (workflow tasks, batches waiting for
  their approval, change requests to approve, batches back with them, loads to confirm, overdue assignments, failed
  jobs for Basis), each with its one action. Lives in the inbox inspector and leads the start screen.
- F06, F07 screen side: the notices link to **Open the batch**; the SLA clock on the batch for steward and owner.
- F11: steward next step names the rule and count and opens Work on their rows with the confirmation bar ready.
- F29: **Request access** on permission refusals (backend from wave 1).
- F30: overdue counts link to `/work?assigned={id}&due=overdue`; **Remind** sends a notice (add the endpoint if
  missing).
- F32: People and Work say what each total counts.

## Package C: Work and the batch

- F08 remaining screen side: **Export load file** wording and one confirmation without live write-back; named loader.
- F09: "Verified on run {date}: n fixed, m still failing" with **Open the m** on the batch inspector.
- F10: chips for Approved, Sent to SAP and Fixed, grouped by batch.
- F12: "n records have no new value: approve the other m or send back".
- F13: SAP key form in the batch (same as Work).
- F14: Work's wave filter and the sentence naming the wave.
- F26: grid exports fetch every row of the filter, with the count in the file and the toast.
- F28: at 390, chips and one **Filters** button above the rows.

## Package D: migration waves

- F35: wave headings with gate state, **Edit** and **Certificate** at every width.
- F15: `?open=waves:{id}` opens that wave, gate first, the others collapsed.
- F16: one threshold word ("Gate: min score 85.0") on Readiness, the cockpit and the gate.
- F17: guides and the panel line describe the issued and signed certificate.
- F18: refusal stays in the certificate inspector as a list of linked objects and rules.
- F19: readiness and records blocked filled for no-go objects, or the columns hidden with the reason.
- F31: score trend per object on the Landscape; **Compare with last month** on the run.

## Package E: Basis, administration and audit

- F01: checklist invites Basis and the SAP team in section 3; admin start screen on a new tenant offers
  **Invite SAP Basis**.
- F02: **Connect a system** in the Basis home Connections header and in the map's Systems heading.
- F03: **Prove three rules** on the run; **Prove in SAP** near the top of the rule inspector.
- F04: reconciliation workbook leads with the rules the person opened under Prove in SAP.
- F05: unsaved-block markers in admin settings and a leave warning.
- F20: Basis next step **Fix the {system} sign-in** (screen side).
- F21: **Connection settings** on a credential-error job; **Save and retry the failed job** in the editor.
- F22: one authorisation error row per system and cause.
- F23: schedule rows open the schedule; **Add a schedule** on not-scheduled rows.
- F24: Basis home tables become cards at 390.
- F25: audit **Who** filter for view audit (screen side).
- F27: Landscape, Work, Runs and People at the top of the admin index.
- F33: one-line status strip at 390.
- F34: forward links in inspectors at 390 (Open the system, and the like).
