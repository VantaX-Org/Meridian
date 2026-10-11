# Premium Redesign ("The Instrument") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan wave by wave.

**Goal:** Rebuild the Meridian frontend, auth pages, brand assets, report branding and persona RBAC to the "Instrument" spec.

**Architecture:** One wave per task, in the order of spec §10. Each wave edits the existing `@/design` library and routes in place (no renames, no new dependencies) and ends green on `lint:tokens`, `lint` and `typecheck`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Tailwind v4, FastAPI, SQLAlchemy/Alembic, WeasyPrint, openpyxl.

**Spec:** `docs/superpowers/specs/premium-redesign/spec.md` (binding), with `screens.md` (screen inventory and insight layer) and `rbac.md` (persona RBAC). Logo sources sit beside them.

## Global Constraints

- Spec is binding. Each wave's files and acceptance checks are the row for that wave in spec §10.
- No renames of exported components, props or `--m-*` tokens. Additions only, except deleting the `MeridianMark` `"tile"` variant (wave 2).
- No new npm or Python dependencies.
- Raw hex, gradients, blur, shadows, motion and duration literals live only in `frontend/design/tokens.css`. Gradients, glass and blur only as the named tokens/classes the spec defines.
- Never add a line to `frontend/scripts/lint-tokens.allow.txt`.
- No `any` (TS) or `Any` (Python).
- No customer names in code, comments, commits or fixtures.
- Rule IDs are append-only; existing rbac (role, action) behaviour must not change.
- Every wave ends with `npm run lint:tokens`, `npm run lint`, `npm run typecheck` green in `frontend/`. Do not run `npm run build`.
- Tests: any pytest/vitest run must collect more than 0 tests.
- Commit messages in normal prose, ending with the session attribution lines.

## Tasks

### Task 1: Wave 1 — tokens, fonts, globals
Spec §1–§3, §10 row 1. Also `frontend/DESIGN.md` rewrite and `frontend/public/brand/brand.json`, new `frontend/scripts/check-contrast.mjs`.

### Task 2: Wave 2 — brand assets
Spec §4, §10 row 2.

### Task 3: Wave 3 — shell
Spec §5, §10 row 3.

### Task 4: Wave 4 — auth pages
Spec §6, §10 row 4.

### Task 5: Wave 5 — primitives A
Spec §7.1–7.7, 7.18, §10 row 5.

### Task 6: Wave 6 — primitives B and charts
Spec §7.9–7.17, 7.12, §10 row 6.

### Task 7: Wave 7 — table and drawers
Spec §7.8, §10 row 7.

### Task 8: Wave 8 — templates and persona home
Spec §8, screens.md home sections, §10 row 8.

### Task 9: Wave 9 — routes A
Spec §10 row 9, screens.md matching routes.

### Task 10: Wave 10 — routes B
Spec §10 row 10, screens.md matching routes.

### Task 11: Wave 11 — report branding
Spec §9, §10 row 11.

### Task 12: Wave 12 — QA and accessibility
Spec §10 row 12.

### Task 13: Wave 13 — RBAC backend
rbac.md, spec §10 row 13.

### Tasks 14–18: Waves 14–18
Spec §10 rows 14–18, rbac.md §6, screens.md.
