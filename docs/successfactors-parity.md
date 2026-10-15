# SuccessFactors parity: why coverage is 0–70% (measured, 2026-10-15)

The SuccessFactors objects do not reach parity with the ECC ones, and the cause is
not the rules. Their rule packs hold 80–473 proved rules each, but only 0–227
evaluate, because the **extraction mapping does not match the tenant's OData API**.

This records the measurement so the next pass does not have to rediscover it.

## The measurement

`§ SuccessFactors extractions` in `sap/extraction_registry.py` was validated against
the tenant's own `$metadata` (`https://api2.successfactors.eu/odata/v2/$metadata`,
9.7 MB, 818 entity sets):

| | count |
|---|---|
| extraction targets shipped | **37** |
| fully valid against the tenant | **16** |
| targets selecting a property the tenant does not expose | **17** |
| targets naming an entity set the tenant does not serve | **4** |

The four missing entity sets are `BenefitEnrollment`, `EmpPayrollRunResults`,
`SuccessionNominee` and `LearningHistoryV1` — which is why `benefits`,
`payroll_integration`, `succession_planning` and `learning_management` cannot
evaluate at all.

`coverage` in the run metadata already reports this per table
(`unavailable_fields`, `not_in_system`, `failed`); the run is not silent about it.

## The three distinct causes

**1. Wrong property names (fixable, mechanical).** The registry guesses camelCase
names that the canonical dictionary already states exactly. Examples where the
canonical `source:` is right and the target is wrong:

| target | registry asks for | tenant exposes |
|---|---|---|
| `JobRequisition` | `requisitionId`, `department`, `location`, `createdDate` | `id`, `department`, `location`, `createdDateTime` |
| `GoalPlanTemplate` | `goalPlanId`, `goalPlanName`, `category`, `status` | `id`, `name`, `dueDate`, `defaultTemplate` |
| `JobApplication` | `requisitionId`, `appliedDate`, `lastModifiedDate` | `applicationId`, `candidateId`, `lastModifiedDateTime` |
| `TimeType` | `name`, `status` | `externalCode`, `name_*`, … |
| `EmpEmployment` | `employmentStatus`, `hireDate`, `seniorityDate` | not selectable on this entity |

**2. Child entities cannot be read at the top level (capability gap).** Some
canonical sources name a *child* or *dynamic* entity, which OData only serves under
a parent or per-instance:

- `Successor` — the entity type exists with 11 properties (`nomineeUserId`, `rank`,
  `readiness`, `status`, …), but a top-level read returns **403**, not 404: it is
  reached under a nomination.
- `Goal` — not an entity set at all; the entity is `Goal_<planId>` per plan (hence
  the `Goal_1` entry, which the tenant serves but with 0 rows).
- `TimeAccountBalance`, `DevelopmentGoal`, `Item` — **404**.

**3. Rules read fields no OData property carries (design gap).** Several canonical
fields map to something that is not a selectable property, so no mapping can fix
them:

- `Successor.approvalStatus`, `.emergencySuccessor`, `.calibrationDate`,
  `.eligibilityFlag` do not exist on this tenant's `Successor` (it has `status`,
  `readiness`, `rank`, `isEmergencyCover`, `nomineeUserId`, …).
- `JobRequisition.hiringManager.userId`, `.jobReqLocale.jobTitle`,
  `.recruiter.userId` are navigation paths, not properties.
- `JobOffer` has no `salary`; `PerPerson` no `placeOfBirth`; `EmpCompensation` no
  `payGrade`; `EmpJob` no `workScheduleCode`.
- `NominationTarget` exposes only `nominationId`, `nominationType` — no
  `positionCode`.

## What this means for the handover

The ECC objects are at parity and can be baselined. **The SuccessFactors objects
cannot reach ECC-level coverage until the extraction mapping is redesigned against
the tenant's real API**, and three modules additionally need data the tenant does
not serve through OData at all:

| module | blocker |
|---|---|
| `learning_management` | Learning is a separate SAP SuccessFactors module (`LearningHistoryV1` not served); needs the Learning OData API or an upload |
| `time_attendance` | `EmployeeTime` is served (100,826 rows) but `EmployeeTimeSheet`/`EmployeeTimeSheetEntry` return 0; `TimeAccountBalance` is 404 |
| `benefits` | `BenefitEnrollment` not served; `BenefitEnrollment` has no entity set in `$metadata` |
| `payroll_integration` | `EmpPayrollRunResults` not served; EC Payroll results need the export/upload path |
| `performance_goals`, `succession_planning`, `recruiting_onboarding` | child/dynamic entities (`Goal_<planId>`, `Successor`) and navigation-only fields |

## The right next step

**Derive the extraction targets from the tenant's `$metadata` instead of
hand-maintaining a second list.** The canonical dictionary already states each
field's intended `Entity.property` (`sap/dictionaries/canonical/successfactors.yaml`);
the registry duplicates that by hand and the two have drifted. A generator that
intersects the canonical map with the tenant's `$metadata`, validated the way the
audit above was (a property that is not selectable either vanishes silently or, if
it is not a property at all, fails the whole `$select`), would make this class of
drift impossible and would make "what can this tenant actually validate" a computed
answer rather than a guess.

Until then, treat SuccessFactors coverage as **bounded by the mapping, not by the
rules**, and do not read a low coverage there as a data-quality result.
