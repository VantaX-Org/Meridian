# People data rule coverage

The depth pass adds 120 rules to the people-data packs: the ECC `hcm` pack (PA067 to PA120), the SuccessFactors packs (`employee_central`, `payroll_integration`, `compensation`, `recruiting_onboarding`, `learning_management`, `performance_goals`, `time_attendance`, `benefits`, `succession_planning`) and eight `S4R-HCM-*` rules in `checks/rules/ecc/s4_readiness.yaml` (new area `hcm`, HCM compatibility pack and employee Business Partner). No new check class and no new pack were added. Every rule has the full metadata set. HCM rules resolve in the ECC 6.0 DDIC (`sap/dictionaries/ecc6`), SuccessFactors rules use only canonical `TABLE.FIELD` names from `sap/dictionaries/canonical/successfactors.yaml`, and every rule is proven by `tests/checks/test_rule_proofs.py`.

`tests/test_people_depth_rules.py` holds the integrity checks and hand-written pass/fail fixtures, including conditional-branch proofs. No rule message, template, evidence or fixture contains a personal value; the sensitive fields were added to `checks/profiling.py`.

## Coverage by view

Counts are the new rules only. The matrix lists, for each view, the tables its rules are anchored on (the rule grain table, or the field table when no grain is set) and how many rules each table carries.

| View | Tables (rules) | Rules |
|---|---|---|
| HCM (ECC) | HRP1000 4, HRP1001 6, PA0000 7, PA0001 10, PA0002 7, PA0003 1, PA0006 3, PA0007 5, PA0008 1, PA0009 5, PA0014 1, PA0015 1, PA0105 1, PA0185 2 | 54 |
| S/4 readiness (HCM area) | PA0001 2, PA0002 3, PA0006 2, PA0009 1 | 8 |
| SF employee_central | EMPEMPLOYMENT 8, FOCOMPANY 1, FODEPARTMENT 2, PERADDRESS 1, POSITION 1 | 13 |
| SF compensation | COMPINFO 5 | 5 |
| SF recruiting_onboarding | JOBREQUISITION 1, ONBOARDINGCANDIDATEINFO 2 | 3 |
| SF learning_management | LEARNINGASSIGNMENT 2, LEARNINGCOMPLETION 3 | 5 |
| SF performance_goals | GOALPLAN 2, PMREVIEWRESULT 2 | 4 |
| SF succession_planning | SUCCESSIONCANDIDATE 2 | 2 |
| SF time_attendance | TIMESHEET 4 | 4 |
| SF benefits | BENEFITENROLLMENT 3 | 3 |
| SF payroll_integration | HRPY_RGDIR 2, PA0008 7, PA0014 2, PA0015 1, PAYRESULT 7 | 19 |
| **Total** | | **120** |

### Dimension

| Dimension | Rules |
|---|---|
| consistency | 39 |
| validity | 38 |
| completeness | 29 |
| timeliness | 10 |
| uniqueness | 4 |
| **Total** | **120** |

### Severity

| Severity | Rules |
|---|---|
| medium | 69 |
| high | 37 |
| low | 13 |
| critical | 1 |
| **Total** | **120** |

### Check class

| Check class | Rules |
|---|---|
| cross_field_check | 52 |
| exists_check | 26 |
| null_check | 25 |
| regex_check | 10 |
| uniqueness_check | 4 |
| domain_value_check | 2 |
| interval_check | 1 |
| **Total** | **120** |

## What the rules cover

- Action and reason validity: PA067 to PA078 check action reasons (T530) and reasons for change per infotype, and the STAT1/STAT2/STAT3 status derived from the action (T529A).
- Infotype consistency: PA079 to PA100 cover org assignment, personal data, address, working time and bank hygiene.
- Terminated employees: PA105 to PA110 and EC115 flag leavers with open payroll, position, recurring payment or bank data.
- Org structure (HRP1000/HRP1001): PA111 to PA119 check dangling and duplicate relationships, cost centre and superior per unit.
- Payroll integration: HPY019 to HPY030 and PAY024 to PAY030 reconcile gross, tax, deductions and net pay and the replication keys.
- S/4HANA: `S4R-HCM-*` rules (employee Business Partner fields, e-mail, 10-year leavers) and the `hcm` area tags in `s4_readiness` (EC field-fit rules EC108 to EC114 and PA ids in `related.blocking` or `related.warning`).

## Not expressible or not verified

- Org-structure loop check (hierarchy over HRP1001 with a relationship filter): the engine cannot apply a filter to a hierarchy, so it was dropped.
- Holder percentage (PROZT) sum per position: no group-sum on HRP1001 with a position grain.
- T510 and T512Z are not country-aware in the DDIC bundle, so pay scale versus grade is limited to existence.
- SF fields `ORIGINAL_START_DATE` and `SENIORITY_DATE` and the EVENT_REASON mapping length are not in the canonical yaml, so no rule was written.
- `ONBOARDINGCANDIDATEINFO.TASK_COMPLETION` is string typed; the numeric rule was dropped.
- `FOCOMPANY.STATUS` and `FODEPARTMENT.STATUS` value sets are not known, so no rule was written.
- Code-fit rules for location, position, department and job codes were removed: Employee Central codes are alphanumeric by design and are mapped on replication, so a pattern rule flags every record.
