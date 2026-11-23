# Outcome flows

Spec: `frontend/e2e/sweep-flows.spec.ts`. Run on a production build (`next build`, `next start`) with `PLAYWRIGHT_BASE_URL` set. Fixture mode, no backend.

| Flow | Asserts | Result |
|---|---|---|
| Issues: tick a row, Start work | selected count, "+ " mark, toast "Issues updated", status "In progress", selection cleared | pass |
| Issues: Resolve | toast and status "Resolved". Failed before the fix: Resolve sent no resolution and the route refuses that | pass after fix |
| Issues: Comment | toast "Comment added", box cleared, text in History | pass |
| Issues: search with no match | "No issues match" | pass |
| Issues: CSV export | saved file ends .csv. Failed before the fix: the menu offered CSV and the client always asked for xlsx | pass after fix |
| Audit: CSV export | header `time,actor,action,object,method,path,status`, every row has 7 fields | pass |
| Error state | with the API answering 500, "Try again" is shown and sends a new request | pass |

Also fixed with vitest: `lib/api/v2/issues-export.test.ts` (format and file name follow the picked format).

## Not covered, and why

- Request payload assertions: fixture mode never calls the API. Payload shape is covered only where a vitest test mocks the client (as in `issues-export.test.ts`).
- Downloaded xlsx and pdf files: fixture downloads are text stand-ins. Only the audit CSV is real parseable text. Real files need the backend.
- Uploads accepted by the API: needs a real backend. Client-side checks are covered by existing vitest and Playwright specs.
- Real SAP extraction, real sign-in, production data: out of scope, never touched.
