# Approval workflows and master data change requests

Meridian approves two kinds of object through one workflow engine:

- **fix batches** (`fix_batch`): the proposed values of a remediation batch, before they are exported or sent to SAP;
- **change requests** (`change_request`): a proposed new material, customer, vendor or business partner, or a change to
  an existing one, before it is created or changed in SAP.

The engine is `api/services/workflow.py`; the change request lifecycle is `api/services/change_requests.py`; the SAP
create paths are `sap/bapi_create.py`. Tables: migration 119 (workflows) and 120 (change requests).

## The engine

A tenant has, per object kind, one **active definition**. A definition is versioned: a new version is a new row with the
same `key`, and activating it changes what new approvals start on. An approval in progress (an **instance**) keeps the
definition version it started on until it ends.

When an instance starts, every step's conditions are evaluated against the object's **facts**. Evaluation is
deterministic: the same facts and the same definition always give the same plan. Steps whose conditions do not hold are
recorded as skipped, with the condition that failed. The steps that apply run in order: one is pending at a time.

A pending step resolves its **assignee rule** to users when it becomes pending, and they are told in their inbox.
Who may decide it:

- a user the rule resolved to;
- the **delegate** of one of them while that person's out-of-office delegation is active (the vote then counts for the
  person away; the delegate also receives a copy of the inbox notification);
- a person the **escalation chain** reached after the step's SLA passed;
- for a role rule naming a permission, anyone holding that permission at the time of the decision.

The requester never decides a step unless the step says `requester_may_approve`. With `distinct_approvers` (the default)
nobody approves two steps of one instance. A step with quorum `any` is approved by the first approval; with quorum `all`
every resolved assignee (or their delegate) must approve. Any rejection ends the instance.

Each transition (started, step waiting, step skipped, vote, step approved or rejected, escalated, approved, rejected,
cancelled, withdrawn) is:

- a row of `workflow_events` and of `audit_log`;
- a webhook event: `workflow.started`, `workflow.step_waiting`, `workflow.step_decided`, `workflow.escalated`,
  `workflow.completed`. These step events reach a webhook that names them or subscribes to `workflow.*`; the wildcard
  `*` does not include them, so a subscription made before workflows existed receives exactly what it did;
- an inbox notification for the people concerned: the deciders of a step that becomes pending, the requester when the
  instance ends (when `notify_requester`), the escalation target.

Every 15 minutes a worker (`workers/tasks/workflows.py`) sweeps pending steps past their due time. Each level of the
tenant's escalation chain (Triage, Escalation chain) fires once when the step is that many minutes past due; the person
it reaches is told and may decide the step. Without a chain, the step's deciders are told once that it is overdue.

## The definition format

```json
{
  "steps": [
    {
      "name": "Four-eyes approval",
      "assignee": {"rule": "role", "action": "approve"},
      "fallback": {"rule": "users", "users": ["<user id>"]},
      "quorum": "any",
      "when": [{"fact": "value_at_risk", "op": "gt", "value": 10000}],
      "sla_hours": 48,
      "escalate": true,
      "requester_may_approve": false
    }
  ],
  "notify_requester": true,
  "distinct_approvers": true
}
```

| Key | Meaning |
|-----|---------|
| `name` | Shown to approvers; unique within the definition. |
| `assignee.rule` | `role` (holders of the permission `action`, or of one of the role keys in `roles`), `users` (the named `users`), `data_owner` (`of: object`: the owner, else the steward, of each object touched in Data owners; `of: field`: the glossary steward of each field touched), `manager` (the requester's manager, `users.manager_id`, set with `PUT /api/v1/users/{id}/manager`). |
| `fallback` | Another assignee rule used when the first names nobody. With neither, anyone holding `approve` may decide, and the step says so. |
| `quorum` | `any` (one approval) or `all` (every assignee). |
| `when` | Conditions that must all hold for the step to apply; `{"any": [ ... ]}` holds when one of its conditions does. No conditions: the step always applies. At least one step must have none. |
| `sla_hours` | Due time after the step becomes pending; with `escalate`, the escalation chain applies past it. |
| `requester_may_approve` | Never by default. |

Facts a condition may test (`GET /api/v1/workflows/facts`):

| Fact | Object | Value |
|------|--------|-------|
| `object_kind` | both | `fix_batch` or `change_request` |
| `kind` | change request | `create` or `change` |
| `object` | change request | `material`, `customer`, `vendor`, `business_partner` |
| `modules` | both | Meridian objects touched, e.g. `material_master` |
| `fields` | both | SAP fields touched, `TABLE.FIELD` |
| `policy_classes` | both | the applied policy classes touched: the pack (`gxp`, `sox`, `gdpr`) and `pack:class` |
| `value_at_risk` | fix batch | value at risk of its records |
| `records` | fix batch | number of records |
| `target_system_id` | change request | the target SAP system |
| `rule_failures`, `critical_failures` | change request | Meridian rules the proposal fails, and the critical ones |
| `duplicates` | change request | likely duplicates found among the master records |

Operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `contains`, `contains_any`, `exists`, `not_exists`.
Text compares without regard to case. A fact the object does not have satisfies only `ne`, `not_in` and `not_exists`.

### Example: four eyes (the default)

Every tenant is seeded with this definition for both kinds (`default-fix-batch`, `default-change-request`). For fix
batches it is today's rule: anyone holding approve except the person who built the batch, and nobody is notified of
anything new (`notify_requester` is false for batches).

```json
{"steps": [{"name": "Four-eyes approval", "assignee": {"rule": "role", "action": "approve"},
            "quorum": "any", "requester_may_approve": false}],
 "notify_requester": false, "distinct_approvers": true}
```

### Example: a value threshold

Above 10,000 of value at risk, a programme lead approves after the four-eyes step, within a day.

```json
{"steps": [
  {"name": "Four-eyes approval", "assignee": {"rule": "role", "action": "approve"}},
  {"name": "Programme lead", "assignee": {"rule": "role", "roles": ["programme_lead"]},
   "when": [{"fact": "value_at_risk", "op": "gt", "value": 10000}], "sla_hours": 24}
]}
```

### Example: a GxP second approver

When a change request touches a field of the applied GxP pack, the data owner of the object approves first, then a
quality approver named in the definition, and both of the two quality approvers must agree for a new material.

```json
{"steps": [
  {"name": "Data owner", "assignee": {"rule": "data_owner", "of": "object"},
   "fallback": {"rule": "role", "action": "approve"}},
  {"name": "GxP second approver", "quorum": "all",
   "assignee": {"rule": "users", "users": ["<quality approver 1>", "<quality approver 2>"]},
   "when": [{"fact": "policy_classes", "op": "contains", "value": "gxp"},
            {"any": [{"fact": "kind", "op": "eq", "value": "create"},
                     {"fact": "critical_failures", "op": "gt", "value": 0}]}],
   "sla_hours": 48}
]}
```

### The API

| Method and path | Permission | What it does |
|-----------------|------------|--------------|
| `GET /api/v1/workflows/definitions` | view | Every version of every definition; the active one per kind is marked. |
| `GET /api/v1/workflows/definitions/{id}` | view | One version. |
| `POST /api/v1/workflows/definitions` | manage_workflows | Version 1 of a new workflow (`activate` to make it active). |
| `POST /api/v1/workflows/definitions/{id}/versions` | manage_workflows | The next version of its workflow. |
| `POST /api/v1/workflows/definitions/{id}/activate` | manage_workflows | Make this version the one new approvals start on. |
| `POST /api/v1/workflows/definitions/validate` | view | Dry run: problems, and for sample facts or a sample payload which steps would apply and to whom. Writes nothing. |
| `GET /api/v1/workflows/facts` | view | Facts, operators, assignee rules. |
| `GET /api/v1/workflows/tasks?scope=mine\|all` | view | Steps waiting; `mine` those the caller may decide. |
| `POST /api/v1/workflows/tasks/{id}/decide` | approve | Approve or reject (with a reason) a waiting step. |
| `GET /api/v1/workflows/instances/{id}` | view | An approval with its steps and history. |
| `PUT /api/v1/users/{id}/manager` | manage_users | Who the user reports to. |

`manage_workflows` is held by the administrator only (admin, platform_admin). A definition is checked on create, new
version and activate; an invalid one is refused with every problem listed.

### Fix batches

`POST /remediation/batches/{id}/approve` starts the batch's approval at its first decision and decides the waiting
step. The batch becomes approved when the instance is; until then it stays a draft and the response names the step
waiting. Send-back rejects the approval in progress (or withdraws one already given), and undoing an approval or a
send-back withdraws or reinstates it. The batch creator never approves, accepts or sends the batch, whatever the
definition says. A fix batch step decided through `POST /workflows/tasks/{id}/decide` goes through the batch's approve
or send-back, so the batch follows.

## Master data change requests

A change request proposes SAP fields with values (`payload`, `TABLE.FIELD: value`) for one object on one target system:

- `kind`: `create`, or `change` with `object_key` naming the record (`MATNR=...|WERKS=...`);
- `object`: `material` (MARA, MARC, MBEW, MVKE, MAKT, MARM), `business_partner` (BUT000, BUT100, ADRC), `customer`
  (KNA1, KNVV, KNB1, and BUT000, ADRC), `vendor` (LFA1, LFB1, LFM1, LFBK, and BUT000, ADRC).

Every field is checked against the SAP data dictionary (it exists, and text fits its length).

### Lifecycle

```
draft --validate--> draft --submit--> submitted --> in_approval --+--> rejected
  |                                                               |
  +--cancel--> cancelled <------------- cancel -------------------+--> approved --+--> (export: approved, with the load file)
                                                                                  |
                                                                                  +--> creating --+--> created
                                                                                                  +--> failed --retry--> creating
                                                                                                  +--> approved (no create function: export)
```

1. **Draft.** The requester (mdm.write) creates and edits the proposal.
2. **Validate.** Meridian's own rules run on the proposal as a one-row frame (`checks/runner.py`, with the tenant's
   rule overrides and authored rules), so the requester sees which rules it would fail; and the master records are
   searched for likely duplicates with the tenant's match rules (the shipped defaults where it has none). Nothing is
   blocked: the findings are kept with the request, shown to approvers, and the workflow may test them
   (`rule_failures`, `critical_failures`, `duplicates`).
3. **Submit.** Validated once more, then the tenant's change request workflow starts: `in_approval`.
4. **Decide.** Approvers (approve, and an approver of the step) approve or reject with a reason.
5. **Approved.** With live write-back on (`MERIDIAN_LIVE_WRITEBACK_ENABLED`), outside sandbox mode and with a
   registered ABAP system with stored credentials as target, the request moves to `creating` and a worker writes it.
   Otherwise it stays `approved` with an export load file (`GET /change-requests/{id}/export`) and the reason. In
   sandbox mode the refusal is also recorded in the sandbox's held-back deliveries.
6. **Creating.** The worker (`workers/tasks/change_requests.py`, retried three times on a connection failure before the
   commit) simulates, then creates or changes the record, and commits only when no RETURN holds an E or A message.
   SAP's RETURN messages and the created key are stored: `created`, or `failed` with the messages.

Idempotency: the worker acts only on a request in `creating`, holds a per-request lock, and stores `committing` before
the commit is sent. A request found in `committing` without a created key is never sent again automatically; it fails
with that reason, and `POST /retry` with `checked_in_sap: true` sends it again once someone has checked SAP.

### In SAP

Every function and every parameter, structure and field sent is checked against the connected system first
(`RFC_FUNCTION_SEARCH`, `RFC_GET_FUNCTION_INTERFACE`, `DDIF_FIELDINFO_GET`); whether a BAPI has `TESTRUN` is read
there too.

| Object | Create | Change |
|--------|--------|--------|
| material | `BAPI_MATERIAL_SAVEDATA` (HEADDATA with MATERIAL, MATL_TYPE, IND_SECTOR and view flags; CLIENTDATA, PLANTDATA, VALUATIONDATA, SALESDATA with their X structures; MATERIALDESCRIPTION; UNITSOFMEASURE). The number is MARA.MATNR when given, else `BAPI_MATERIAL_GETINTNUMBER` (MATERIAL_TYPE, INDUSTRY_SECTOR, REQUIRED_NUMBERS). | `BAPI_MATERIAL_SAVEDATA` (the write-back mapping) |
| business partner | `BAPI_BUPA_CREATE_FROM_DATA` (PARTNERCATEGORY, PARTNERGROUP, BUSINESSPARTNEREXTERN, CENTRALDATA, CENTRALDATAPERSON / ORGANIZATION / GROUP, ADDRESSDATA); roles from BUT100.RLTYP by `BAPI_BUPA_ROLE_ADD_2` or `BAPI_BUPA_ROLE_ADD`; the address by `BAPI_BUPA_ADDRESS_ADD` where the create BAPI takes none | `BAPI_BUPA_CENTRAL_CHANGE`, `BAPI_BUPA_ADDRESS_CHANGE` |
| customer, vendor | the business partner path under CVI with the role FLCU00 or FLVN00; the customer or vendor number is read from CVI_CUST_LINK / CVI_VEND_LINK after the commit. Sales area, company code, purchasing and bank data go with the export. | `BAPI_CUSTOMER_CHANGEFROMDATA1`; vendor through its business partner where it has one |

Simulation is `TESTRUN = 'X'` where the BAPI has it, otherwise the call followed by `BAPI_TRANSACTION_ROLLBACK`. The
real calls of one record run in one LUW and end in `BAPI_TRANSACTION_COMMIT` (WAIT) only when none returned E or A,
else `BAPI_TRANSACTION_ROLLBACK`. An internal material number is drawn before the simulation (the simulation needs
one), so a refused simulation can leave a gap in the number range, never a material. Where the create path's function
is not on the release, nothing is sent and the request ends approved with the export load file and that reason.

### The API

| Method and path | Permission |
|-----------------|------------|
| `POST /api/v1/change-requests` | mdm.write |
| `PATCH /api/v1/change-requests/{id}` (draft, requester) | mdm.write |
| `POST /api/v1/change-requests/{id}/validate` | mdm.write |
| `POST /api/v1/change-requests/{id}/submit` (requester) | mdm.write |
| `GET /api/v1/change-requests?view=mine\|to_approve\|all&status=&object=&kind=` | mdm.read |
| `GET /api/v1/change-requests/{id}` (with workflow, history, comments, attachments) | mdm.read |
| `POST /api/v1/change-requests/{id}/decide` | approve |
| `POST /api/v1/change-requests/{id}/cancel` (requester or administrator) | mdm.write |
| `POST /api/v1/change-requests/{id}/comments` | mdm.read |
| `POST /api/v1/change-requests/{id}/attachments` (metadata) | mdm.write |
| `POST /api/v1/change-requests/{id}/retry` | mdm.write |
| `GET /api/v1/change-requests/{id}/export` | mdm.read |

Webhook events: `change_request.submitted`, `.approved`, `.rejected`, `.created`, `.failed`, `.cancelled` (ids, kind,
object, status and title; never a field value or an SAP key).
