# SuccessFactors coverage: measured against the tenant (2026-10-16)

The SuccessFactors objects do not reach parity with the ECC ones. The cause is in the
**canonical source map**, not in the rules: their packs are deep and every rule is
proved, but 119 of the 472 field sources that
`sap/dictionaries/canonical/successfactors.yaml` declares cannot be resolved against
this tenant's OData API.

## How this was measured

`sap/dictionaries/canonical/successfactors.yaml` states each field's intended OData
source as `Entity.property`. `api/services/connectivity_manager.py::_extract_successfactors`
resolves those sources **against the tenant's own `$metadata`** at extraction time and
only selects properties the tenant has — it already supports `nav/prop` paths through
`$expand`, drops a property the API user cannot view, and records what it could not
read as `unavailable_fields` in the run's coverage metadata. So the extraction path is
tenant-aware; what is wrong is the map it resolves.

Measured by comparing every declared source with the tenant's `$metadata`
(818 entity sets, captured 2026-10-15) and counting both properties and navigation
properties:

| | sources |
|---|---|
| declared in the canonical SF map | 472 |
| resolvable against this tenant | **353** |
| unresolvable | **119** |

Reproduce with `scripts/successfactors_parity.py --metadata <captured $metadata>`.

## Where the unresolvable 126 sit

| table | unresolvable | cause |
|---|---|---|
| `SUCCESSIONCANDIDATE` | 18 | `Successor` is a child entity (403 at top level) and lacks `approvalStatus`, `calibrationDate`, `eligibilityFlag`, …; `NominationTarget` has only `nominationId`/`nominationType`, no `positionCode` |
| `LEARNINGASSIGNMENT` | 18 | Learning is a separate SF module; `learning.*` is not served as OData |
| `LEARNINGCOMPLETION` | 13 | same — `learningHistory.*` is not served |
| `PAYRESULT` | 13 | `payroll_export.*` is not an OData entity; EC Payroll results need the export/upload path |
| `BENEFITENROLLMENT` | 10 | `BenefitEnrollment` has no entity set in `$metadata` |
| `JOBOFFER` | 8 | `JobOffer` has no `salary`, `offerId`, `offerDate`, `candidateId`, `jobReqId`, `startDate` |
| `JOBREQUISITION` | 7 | `department`/`location`/`hiringManager`/`recruiter`/`status`/`title` are navigation or locale paths the entity does not carry |
| `GOALPLAN` | 3 | `ACTUAL_ACHIEVEMENT`, `CASCADED_FROM`, `COMPLETION_PERCENT` |
| `COMPINFO`, `PERINFO`, `JOBAPPLICATION`, `EMPEMPLOYMENT`, `TIMESHEET`, `ONBOARDINGCANDIDATEINFO`, … | 3–5 each | one or two properties the tenant does not expose |

## What was corrected (20 sources, validated)

Two passes, both restricted to corrections that cannot change what a rule means.

**Pass 1 — name-level (13 sources).** Entity rename with the property name unchanged,
or a name differing only by case or punctuation. **`GOALPLAN`: `Goal.*` → `Goal_1.*`**
(11 fields): `Goal` is not an entity set on this tenant, and `Goal_1` carries `id`,
`userId`, `name`, `metric`, `state`, `weight`, `flag`, `lastModified`, `modifier`,
`currentOwner`, `category`. Plus `EmpJob.workScheduleCode` → `workscheduleCode` in
`EMPEMPLOYMENT`/`EMPJOBHIST`, with `SF_EXTRACTIONS` synced (that list also drives
config sync, and a `$select` of a missing property returns HTTP 400 — a test pins the
two in step).

**Pass 2 — semantic 1:1 (7 sources).** Each verified against the canonical
description, and each rejected if it would make two different canonical fields read one
property:

| field | was | now | why it is the same thing |
|---|---|---|---|
| `SUCCESSIONCANDIDATE.NOMINEE_ID` | `Successor.userId` | `Successor.nomineeUserId` | `Successor` has no plain `userId`; the nominee *is* `nomineeUserId` |
| `SUCCESSIONCANDIDATE.EMERGENCY_SUCCESSOR_FLAG` | `Successor.emergencySuccessor` | `Successor.isEmergencyCover` | the entity's only emergency-cover flag |
| `SUCCESSIONCANDIDATE.TALENT_POOL_ID` | `TalentPool.id` | `TalentPool.code` | `TalentPool` exposes `code` as its identifier, not `id` |
| `GOALPLAN.TARGET_DATE` | `Goal.dueDate` | `Goal_1.due` | same concept, entity rename |
| `GOALPLAN.GOAL_START_DATE` | `Goal.startDate` | `Goal_1.start` | same concept, entity rename |
| `PMREVIEWRESULT.FORM_TEMPLATE_ID` | `FormHeader.templateId` | `FormHeader.formTemplateId` | same concept, tenant spelling |
| `JOBAPPLICATION.RATING` | `JobApplication.averageRating` | `JobApplication.rating` | the entity exposes `rating`; there is no `averageRating` |

`SUCCESSIONCANDIDATE.NOMINATED_BY` was **rejected**: the canonical says "user ID of the
nominating manager", and the only candidate (`Successor.lastModifiedBy`) is a proxy,
not the same fact.

Deliberately not guessed: where a property is genuinely absent the source is left
alone. A fuzzy pass paired `COMPLETION_PERCENT` with `metric` and `HIRING_MANAGER`
with `age` — silently changing what a rule reads, which is worse than an unevaluated
rule.

## Where the remaining 119 sit

## What this means for handover

ECC objects are at parity and can be baselined. SuccessFactors coverage is **bounded by
what the tenant serves**, and four objects are bounded hard:

| object | status |
|---|---|
| `learning_management` | 0 of 29 sources resolvable — this tenant does not serve Learning over OData |
| `benefits` | `BenefitEnrollment` has no entity set |
| `payroll_integration` | `PAYRESULT` needs the EC Payroll export path |
| `succession_planning` | `Successor` is a child entity and lacks the fields the rules read |
| `performance_goals` | improved by the `Goal_1` correction; still bounded by 5 goal fields plus the `FormHeader`/`FormSummarySection` ratings |
| `employee_central`, `compensation`, `time_attendance` | near-parity — 89–95% of their sources resolve |

Two of these are decisions for the client, not code: whether their Learning/Benefits/
Payroll data arrives by export (the upload path exists and is wired), and whether the
succession rules should be scoped to the fields `Successor` actually carries.

## The next step, if more parity is wanted

Extend the correction beyond case/punctuation to **semantic** renames validated against
the tenant — `Successor.userId` → `Successor.nomineeUserId`, `Successor.approvalStatus`
→ `Successor.status`, `NominationTarget.positionCode` → the parent nomination's
position. Each needs a judgement about whether the tenant property means the same
thing; that is consultant work, not a script, which is why it is not done here.
