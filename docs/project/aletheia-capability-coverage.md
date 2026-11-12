# Aletheia capability coverage for cleaning

This page takes every capability the Aletheia engine offers and says whether Meridian uses it to inform people and to help them clean data, where it is used, and why the rest are left alone. The route-by-route inventory of the engine, with what each route does, lives in the [Aletheia capability map](aletheia-capability-map.md); this page builds on it and covers the cleaning plan added on 12 November 2026.

The rules that bound every use are unchanged. Only aggregates reach the engine: rule ids, field names, counts and scores. No SAP or SuccessFactors record value, personal data or free text leaves Meridian. When a suggestion needs a record value, deterministic code computes it locally and only the resulting pattern counts and rule-defined fix values are shown. Every engine result sits beside a deterministic result that still answers when the engine is off, unreachable or unlicensed, and every result shows its evidence: the rule id, the field, and the counts it rests on.

## The cleaning plan

The cleaning plan answers five questions for one object in one run. It is served by `GET /api/v1/aletheia/cleaning-plan?module=&version_id=` (`api/routes/aletheia_engine.py`) and built by `api/services/aletheia_cleaning.py`.

Why each failing record is wrong. For every failing rule Meridian writes a plain sentence from the rule's own definition (its check type, field, allowed values or pattern) and the run's counts. When the failing values share a shape, the sentence names the shape, for example "blank" or "lower-case letters with a trailing space", using the value-pattern statistics from `fix_drafter.build_shape`. The sentence never contains a value.

What value would fix it, how sure Meridian is, and why. A suggestion comes from one of three sources, in this order: the rule's automatic fix as already applied in the run, the rule's value map (`value_fix_map` in the YAML), or a fix the tenant drafted earlier. Confidence is a number from 0 to 100. For the first two sources it is the share of failing records the fix covers, so "86 out of 100, rests on 50 of 58 records" is literal. For a drafted fix it is the draft's own confidence level. A rule with no defensible fix gets no number and is marked for a person to review.

Which records to fix together. Failing rules are grouped into fix batches by field and kind of fix: a suggested value, a required field to fill, a value to pick from an allowed list, or a review by hand. Each batch shows its rules, the number of records it touches, and an instruction written for the person doing the work.

What to write in the cleaning workbook. The same batches and instructions appear as a "Fix batches" sheet in the cleaning workbook (`api/services/cleaning_workbook.py`), so the steward who downloads the workbook reads the same plan as the screen.

What changed since the last run. Meridian compares the rule failure counts of this run with the object's previous run and writes a short narrative: how the failing record total moved, which rules now pass, which fail for the first time, and which grew or shrank most. Each statement is backed by a table of rule, before count and after count.

## Engine capabilities and their use

Self-learning (`POST /api/{tenant}/learn`) is used. The cleaning plan sends the per-rule failure counts of the object's last runs, keyed by rule id and nothing else, and the engine returns each rule's learned normal range. The screen lists the rules whose latest count sits outside that range. The call is gated: with fewer than three runs, no engine configured, the engine unreachable, no token or an invalid licence, the plan says so in words and the deterministic parts still show. The same capability already backs "What moves the score" on Insights and the composite's normal range on Foresight.

World-model surprise (`POST /api/{tenant}/model-insights`) stays on Foresight and is not used per rule in the cleaning plan. The engine needs at least six runs to say anything, and per-rule series rarely have that many on a project. The learned range from `/learn` answers the same question for a steward with half the history.

Dynamic reasoning (`POST /api/{tenant}/reason`) is not called. Its request and response contract is not published, so Meridian does not guess at it. The Reason screen's deterministic layer answers in the meantime.

Business findings costed in money (`POST /api/{tenant}/insights`) are not used. They cost business KPIs, not data quality, and Meridian's money figure stays the tenant-set config impact model.

Grounded question answering and conversation (`/ask`, `/converse`, search and node lookups) are not used. They answer over a text corpus held by the engine. Filling it would mean sending record text, which the aggregates-only rule forbids.

The OpenAI-compatible chat surface (`/v1/models`, chat completions) is not used. All explanation and instruction text in the cleaning plan is written by deterministic code, which is safer and repeatable, and Meridian's language model boundary stays `llm/provider.py`.

Voice, operator routes (metrics, status, updates, terms) and licensor routes (admin billing, downloads) are not used. They are not product features for cleaning.

Library-only modules in the engine (forecasting, causal discovery, golden records, reconciliation and the others listed in the capability map) have no HTTP route, so Meridian cannot reach them. Meridian has deterministic equivalents for most.

## Where people see it

- Object Fixes tab: the cleaning plan for the object's selected run, under the cleaned upload.
- Run detail: one cleaning plan per object in the run, after the proof section.
- Cleaning workbook: the "Fix batches" sheet.

Every code on screen shows its description beside it: rule ids with the rule message, fields with their text label. Fixture mode answers the plan from `frontend/lib/api/v2/fixtures/insights.ts`, built from real material master rules with synthetic counts.

## Tests

- `tests/test_aletheia_cleaning.py`: explanations, suggestions and confidence, batches, the change narrative, the engine gate, and a check that no failing value appears in the plan.
- `tests/test_cleaning_workbook.py`: the workbook still builds with the new sheet in place; the sheet rows are checked in `test_workbook_rows_follow_batches`.
- `frontend/design/v2/__tests__/AletheiaCleaningPlan.test.tsx`: the plan from the fixture, and the plan with the engine off.
