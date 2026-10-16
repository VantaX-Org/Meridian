# Per-system source overrides

Copy this file to `sap/dictionaries/overrides/<system_type>.yaml` (for example
`sap/dictionaries/overrides/successfactors.yaml`) and fill in the differences for a specific
system. Nothing here is required — a deployment with no override file uses the built-in
defaults in `api/services/source_overrides.py`.

```yaml
# system id (sap_systems.id) -> {TABLE.FIELD: Entity.property}
921f509d-2731-43bc-9899-d89a1314f569:
  GOALPLAN.GOAL_ID: Goal_1.id
```

Precedence, most specific first:

1. `TABLE.FIELD` under this system's id, in the file above;
2. `TABLE.FIELD` under the `*` key, in the file above (deployment-wide defaults);
3. the built-in defaults in `api/services/source_overrides.py`;
4. the canonical `source` in `sap/dictionaries/canonical/<system_type>.yaml`.

## Why this exists instead of editing the canonical file

The canonical dictionaries describe the *standard* API surface. A tenant's differs: entity
sets can be suffixed per tenant (`Goal_<planId>`), properties are spelled differently
(`workscheduleCode` vs `workScheduleCode`), and some are not readable by the API user at all.
When a canonical source does not resolve, `_extract_successfactors` records the field as
unavailable and the rule reading it is **silently not evaluated** — it shows up as low
coverage, not as an error.

Editing the canonical file to fix that for one customer applies that customer's quirks to
every other customer, and it has already gone wrong once in this repository: a correction was
made to the canonical map, verified in the running image, and still did not reach extraction
because a saved per-system snapshot outranked it. See `tests/sap/test_dictionary_overlay.py`.

## Finding a tenant's differences

```bash
# capture the tenant's own OData $metadata
curl -u "SF_API@<company>:<password>" \
     "https://api2.successfactors.eu/odata/v2/\$metadata" -o sf_metadata.xml
# report, per table, which canonical sources this tenant does not serve
python -m scripts.successfactors_parity --metadata sf_metadata.xml
# and keep it honest in CI once resolved
python -m scripts.successfactors_parity --metadata sf_metadata.xml --strict
```

## What the built-in defaults cover

Verified against a live tenant's `$metadata`:

| canonical field | override | why |
|---|---|---|
| `GOALPLAN.*` (13 fields) | `Goal_1.*` | `Goal` is not an entity set; goals are served from `Goal_1` |
| `EMPEMPLOYMENT.WORK_SCHEDULE`, `EMPJOBHIST.WORK_SCHEDULE` | `EmpJob.workscheduleCode` | the property is spelled in lower case |
| `SUCCESSIONCANDIDATE.NOMINEE_ID` | `Successor.nomineeUserId` | `Successor` has no plain `userId` |
| `SUCCESSIONCANDIDATE.EMERGENCY_SUCCESSOR_FLAG` | `Successor.isEmergencyCover` | the entity's only emergency-cover flag |
| `SUCCESSIONCANDIDATE.TALENT_POOL_ID` | `TalentPool.code` | `TalentPool` exposes `code` as its identifier |
| `PMREVIEWRESULT.FORM_TEMPLATE_ID` | `FormHeader.formTemplateId` | tenant spelling |
| `JOBAPPLICATION.RATING` | `JobApplication.rating` | there is no `averageRating` |

`tests/test_source_overrides.py` asserts every built-in key names a field the canonical
dictionary actually declares, so a typo cannot silently do nothing.
