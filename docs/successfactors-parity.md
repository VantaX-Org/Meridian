# SuccessFactors coverage: measured against the tenant (2026-10-16)

The SuccessFactors objects do not reach parity with the ECC ones. The cause is in the
**canonical source map**, not in the rules: their packs are deep and every rule is
proved, but 126 of the 472 field sources that
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
| resolvable against this tenant | **346** |
| unresolvable | **126** |

Reproduce with `scripts/successfactors_parity.py --metadata <captured $metadata>`.

## Where the unresolvable 126 sit

| table | unresolvable | cause |
|---|---|---|
| `SUCCESSIONCANDIDATE` | 21 | `Successor` is a child entity (403 at top level) and lacks `approvalStatus`, `calibrationDate`, `eligibilityFlag`, …; `NominationTarget` has only `nominationId`/`nominationType`, no `positionCode` |
| `LEARNINGASSIGNMENT` | 18 | Learning is a separate SF module; `learning.*` is not served as OData |
| `LEARNINGCOMPLETION` | 13 | same — `learningHistory.*` is not served |
| `PAYRESULT` | 13 | `payroll_export.*` is not an OData entity; EC Payroll results need the export/upload path |
| `BENEFITENROLLMENT` | 10 | `BenefitEnrollment` has no entity set in `$metadata` |
| `JOBOFFER` | 8 | `JobOffer` has no `salary`, `offerId`, `offerDate`, `candidateId`, `jobReqId`, `startDate` |
| `JOBREQUISITION` | 7 | `department`/`location`/`hiringManager`/`recruiter`/`status`/`title` are navigation or locale paths the entity does not carry |
| `GOALPLAN` | 5 | `ACTUAL_ACHIEVEMENT`, `CASCADED_FROM`, `COMPLETION_PERCENT`, `GOAL_START_DATE`, `TARGET_DATE` |
| `COMPINFO`, `PERINFO`, `JOBAPPLICATION`, `EMPEMPLOYMENT`, `TIMESHEET`, `ONBOARDINGCANDIDATEINFO`, … | 3–5 each | one or two properties the tenant does not expose |

## What was corrected (13 sources, validated)

Only corrections that cannot change a rule's meaning were applied — an entity rename
with the property name unchanged, or a property differing only by case or punctuation:

- **`GOALPLAN`: `Goal.*` → `Goal_1.*`** (11 fields). `Goal` is not an entity set on
  this tenant; the goals live in `Goal_1`, which does carry `id`, `userId`, `name`,
  `metric`, `state`, `weight`, `flag`, `lastModified`, `modifier`, `currentOwner`,
  `category`. This is the substantive win: `performance_goals`' goal-level rules can
  now resolve 11 of the 16 fields they were missing.
- **`EMPEMPLOYMENT`/`EMPJOBHIST` `WORK_SCHEDULE`**: `EmpJob.workScheduleCode` →
  `EmpJob.workscheduleCode` (the tenant's spelling).
- `EmpJob.workScheduleCode` in `SF_EXTRACTIONS` was synced to match — the registry and
  the dictionary are deliberately kept in step (see
  `tests/sap/test_sf_ec_depth_extraction.py`), because this list also drives config
  sync and a `$select` of a non-existent property returns HTTP 400.

Deliberately **not** guessed: where a property is genuinely absent (e.g.
`SUCCESSIONCANDIDATE.NOMINEE_ID ← Successor.userId`, where `Successor` has
`nomineeUserId`), the source was left alone. A tempting fuzzy match
(`COMPLETION_PERCENT` → `metric`, `HIRING_MANAGER` → `age`) would have silently
changed what the rule reads, which is worse than an unevaluated rule.

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
