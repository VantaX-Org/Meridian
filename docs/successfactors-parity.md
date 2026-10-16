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

## Portability: what transfers to another customer, and what does not

The SuccessFactors OData surface differs per tenant — entity names, property spellings and
which modules are licensed. That makes "the mapping" a layered thing, and it matters which
layer a correction belongs in:

| layer | lives in | transfers to a new customer? |
|---|---|---|
| canonical SAP field semantics | `sap/dictionaries/canonical/successfactors.yaml` | **yes** — this is what a field *means* |
| the OData `Entity.property` a field reads | same file, `source:` | **mostly**, but not always (see below) |
| which entity a tenant actually serves | resolved from `$metadata` at extraction time | automatic — `_extract_successfactors` only selects properties the tenant has |
| tenant-only spellings and aliases | **should be an override, not the canonical map** | no — they are this customer's API |

The corrections in this document sit in the second layer, and most are genuine API facts
rather than one-off quirks (`Goal_1` is the entity set; `workscheduleCode` is the spelling;
`TalentPool.code` is the identifier). A new customer is expected to differ in three ways:

1. **Different entity sets.** `Goal_<planId>` is per-tenant, and whether `Successor` is
   readable at all depends on the licence and the API user's permissions.
2. **Different property spellings.** `workscheduleCode` vs `workScheduleCode` is exactly the
   kind of variation that has no correct global answer.
3. **Different modules licensed.** Learning, Benefits and EC Payroll are add-on modules; a
   tenant without them cannot evaluate those rules however good the mapping is.

### Onboarding a new customer

Before trusting any SuccessFactors number for a new tenant:

```bash
# 1. capture the tenant's own metadata
curl -u "SF_API@<company>:<password>" \
     "https://api2.successfactors.eu/odata/v2/\$metadata" -o sf_metadata.xml
# 2. see exactly what the canonical map cannot source there
python -m scripts.successfactors_parity --metadata sf_metadata.xml
# 3. after resolving the tenant's differences, keep it honest in CI
python -m scripts.successfactors_parity --metadata sf_metadata.xml --strict
```

Step 2 is the real answer to "will this work for another customer": it reports, per table,
which declared sources their API does not serve — before an analysis rather than as
mysteriously low coverage afterwards.

**What is still missing for true multi-tenant support**: those per-tenant corrections have
nowhere to live yet. Today a tenant-specific spelling has to be written into the shared
canonical file, which is what this document had to do for Komatsu. The next step is a
tenant override layer — a `source:` remap keyed by system id, applied in
`_extract_successfactors` alongside the existing `field_status` overlay — so the canonical
map stays generic and each customer's quirks stay theirs. Until that exists, treat a new
SF customer as requiring a mapping review, not just a connection.

## Measured: what the remaining gaps actually are

Every declared entity was read directly with the tenant's own credentials (Oct 2026). The
result decides what is worth fixing: **22 entities serve data, 10 are not in the tenant's
OData catalogue, and 1 exists but the API user may not read it.** None of the remaining
gaps is a mapping wish — they are permissions and modules the tenant does not have.

| entity | result | rows | what it blocks |
|---|---|---|---|
| `Successor` | **403 — no permission** | — | `succession_planning`: 78 of its 81 checks |
| `Goal_1` | serves, **0 rows** | 0 | `performance_goals`: this tenant has no goal records |
| `Goal`, `DevelopmentGoal` | not in catalogue | — | the tables that alias onto them |
| `LearningAssignment`, `LearningCompletion`, `LearningActivity` | not in catalogue | — | `learning_management`: all 29 sources |
| `BenefitEnrollment`, `EmployeeBenefit` | not in catalogue | — | `benefits` |
| `PAYRESULT` | not in catalogue | — | `payroll_integration`: needs the EC Payroll export |
| `TimeAccountBalance`, `EmployeeTimeSheet` | not in catalogue / 0 rows | 0 | `time_attendance` |
| `PMReviewResult` | not in catalogue | — | `PMREVIEWRESULT` (its `FormHeader` parent does serve 5,905) |
| **`JobApplication`** | serves | 342,297 | recruiting — `rating` now reads correctly |
| **`FormHeader`** | serves | 5,905 | `formTemplateId` reads correctly |
| `NominationTarget`, `JobRequisition`, `JobOffer`, `ONB2Process`, `FODepartment`, `FOCostCenter`, `PerPersonal`, `PerPerson`, `PerPhone`, `EmpCompensation`, `EmpJob`, `EmpEmployment`, `Position`, `TalentPool`, `User`, `EmpPayCompRecurring`, `EmpPayCompNonRecurring`, `GoalPlanTemplate` | serve | 8 – 6,252 | — |

So the honest answer to "why is SuccessFactors coverage still short" is, in order:

1. **One permission.** `Successor` returns
   `[COE0020] You don't have permission to view the Successor entity`. That single grant
   is worth 78 checks in `succession_planning`. No code change substitutes for it — either
   the integration user gets the permission, or those rules are scoped out of acceptance.
2. **Four modules this tenant does not license** (Learning, Benefits, EC Payroll, and the
   `TimeAccountBalance` half of Time & Attendance). These raise the honest question of why
   those rule packs are in scope at all rather than being a defect.
3. **One empty entity.** `Goal_1` resolves and returns zero rows, so `performance_goals`
   cannot evaluate goal-level rules on this tenant's data. That is a data fact, not a
   mapping one — and it is why run 3 raised `performance_goals` coverage to 0.63 (the
   rules that read the *user* rather than the goal now have their fields).

### The extraction now selects the corrected fields

Verified in run 3's coverage metadata, after the `Dictionary.overlay` fix
(see "Portability", below): `GOALPLAN` unavailable fields fell 16 → 3, `SUCCESSIONCANDIDATE`
21 → 18, `JOBAPPLICATION` 4 → 3 and `PMREVIEWRESULT` 5 → 4. `JOBAPPLICATION.rating` and
`FORM_TEMPLATE_ID` were confirmed to read the right property from the live API.
