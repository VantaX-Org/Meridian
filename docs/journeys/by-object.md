# Journeys by object and action

This file describes what can be done to each scored object in Meridian, as built at v0.0.630 (`main`, merge
b772a6107). Rule counts come from the YAML packs in `checks/rules`. Rights come from `api/services/rbac.py`. Routes
come from `frontend/app/(v2)`. See [by-role.md](by-role.md) for the roles.

An object's address is `/o/{system}/{object}`. Use `_` as the system to open it on whichever system holds it, and `-`
for `_` in the object key. For example, `/o/_/material-master` opens `material_master`.

## Actions that exist for every object

The object page has these tabs: Overview, Rules, Records, Fixes, Trend, Readiness, Processes, Lineage, Profile,
Glossary, Golden records.

| Action | Right needed (code) | Route | Control | Outcome |
|---|---|---|---|---|
| Extract | trigger sync (`trigger_sync`) | `/?open=system:{id}` | **Extract**, then **Extract {n} objects** | A new extraction; with "Analyse straight after extracting" a run follows |
| Run analysis | analyse (`analyse`) | `/?open=system:{id}` | **Run analysis on {system}** | Toast "Analysis started"; a new run on `/runs` |
| Score again | analyse (`analyse`) | `/run/{id}` | **Score again** | The run is scored again |
| Read the score | view (`view`) | `/o/{system}/{object}` | none | Lede "{object} on {system}, {run} from {date}: measured {score} out of 100." |
| Read findings | view (`view`) | `/o/{system}/{object}/rules` | segment **All rules** or **Top fixes** | Heading "How {score} is made", rules with failing counts |
| Read records | view (`view`) | `/o/{system}/{object}/records` | a row | `/o/{system}/{object}/records/{key}` |
| Export findings | export (`export`) | `/run/{id}` | **Export findings** | A file; the button shows without the right, the API refuses |
| Export a grid | export (`export`) | any grid | **Share and export**, then **Export to Excel** or **Export to CSV** | A file |
| Accept suggested values (fix) | apply (`apply`) | `/o/{system}/{object}/rules` or `/work?rule={id}` | **Accept all**, or **Accept {n} suggested values on {rule}** | Values go into a draft batch |
| Edit one value | apply (`apply`) | `/work` | the value cell | Value goes into a draft batch |
| Mark as not an issue | approve (`approve`) | `/work` | **Mark as not an issue** or **Accept the risk** | The finding closes as an exception |
| Approve a batch | approve (`approve`), not the builder | `/work?open=batch:{id}` | **Approve** or **Send back** | The batch is approved or returned |
| Export the load file | export (`export`), not the builder | `/work?open=batch:{id}` | **Export load file** | File in one of the formats below |
| Mark loaded | approve (`approve`) or manage systems (`manage_systems`) | `/work?open=batch:{id}` | **Loaded in SAP** | The batch shows "Sent to SAP" |
| Live write-back | apply (`apply`) or approve (`approve`); approve to send | `/work?open=batch:{id}` | **Check with SAP**, **Send to SAP** | Only when the live write-back setting is on |
| Auto-cleanse: review | view (`view`) | `/cleansing` | **Review the proposals** | The proposals list |
| Auto-cleanse: approve | approve (`approve`) | `/cleansing` | **Approve the {n} confident**, **Approve**, **Reject**, **Compare and merge** | Proposals approved or rejected |
| Auto-cleanse: write | apply (`apply`) | `/cleansing` | **Write to SAP**, **Roll back** | Status changes in Meridian; see the note below |
| Auto-cleanse: export | export (`export`) | `/cleansing` | **Export the corrected records**, **Download** | A file |
| Monitoring after clean | view (`view`) | `/work/monitor` | **Open cleansing**, **Open the work list** | "{n} records failed a rule again since the last run." |
| Acknowledge a monitor | master data write (`mdm.write`) | `/monitors` | acknowledge | The break is acknowledged |
| Make a mined dependency a rule | manage rules (`manage_rules`) | `/o/{system}/{object}/profile` | **Make it a rule** | Toast "Rule {id} added. It runs from the next analysis." |
| Approve a learned rule | approve (`approve`) or review AI rules (`review_ai_rules`) | `/o/{system}/{object}/rules` | segment **Learned**, then **Approve** | The rule goes live |
| Verified fix drafts | manage rules (`manage_rules`) | `/fix-drafts` | **Draft and verify**, **Approve**, **Reject** | A verified fix rule |
| Compare runs | view (`view`) | `/o/{system}/{object}/trend` or `/runs` | "Compare two runs", or **Compare with previous** | `/run/{a}/vs/{b}` |
| Migration analysis | analyse (`analyse`) | `/migration` | **Start an analysis** | Verdict "Ready to load", "Ready with conditions" or "Not ready to load" |
| Field map | analyse (`analyse`) | `/migration` | **Propose from the source**, **Confirm** | The source to target field map |
| Value map | analyse to open, approve (`approve`) to save | `/migration` | "Value map for {field}", **Save the value map** | Saved and in force at once (no second approver) |
| Migration workbook | export (`export`), at least one system | `/migration` | "Workbook from the new system", **Check the workbook**, **Export in the same format** | A file in the new system's format; audited |
| Reconcile after load | analyse (`analyse`) | `/migration` | **Run reconciliation**, **Extract the target system** | Post-load reconciliation |
| New master data request | master data write (`mdm.write`) | `/requests` | **New request** | A request waits for approval |
| Approve a request | approve (`approve`) | `/requests?open=request:{id}` | **Approve**, **Reject** | The request is decided |
| Watch the object | none | `/o/{system}/{object}` | **Watch** | Shows **Watching** |

Load file formats:

| Code | Text |
|---|---|
| `cockpit_xlsx` | Migration Cockpit, Excel |
| `cockpit_csv` | Migration Cockpit, CSV |
| `ltmc_xlsx` | LTMC, Excel |
| `mass_change_csv` | Mass change, CSV |
| `mass_maintenance_zip` | Mass maintenance, ZIP |
| `mdg_cr_json` | MDG change request, JSON |

Notes:

- **Write to SAP** on `/cleansing` sets a status in Meridian. The handler makes no SAP call.
- The **Fixes** tab on the object page lists the fix batches that hold records of the object: batch, name, status,
  records, who built it, when, and how many records the next run found fixed. A row opens the batch.
- The licence is checked where data enters (extract, upload, connectivity, process discovery, reference data,
  migration, database sources). It is not checked on analyse or on reading.

## Role by action, for every object

The same rights apply to every object. A grant scoped to one object or system narrows this to that scope.

Codes: PA platform_admin (Platform admin), PL programme_lead (Programme lead / CIO), DS data_steward (Data steward),
DO data_owner (Data owner / approver), SB sap_basis (SAP Basis / integration admin), PrA process_analyst (Process
analyst), An analyst (Analyst), Au auditor (Auditor), Vi viewer (Viewer).

| Action | PA | PL | DS | DO | SB | PrA | An | Au | Vi |
|---|---|---|---|---|---|---|---|---|---|
| Read score, findings, records | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Extract | Y | Y | Y | | Y | | Y | | |
| Run analysis | Y | Y | Y | | Y | | Y | | |
| Export findings or grids | Y | Y | Y | Y | Y | | Y | Y | |
| Accept or edit suggested values | Y | Y | Y | | | | | | |
| Mark as not an issue | Y | Y | Y | Y | | | | | |
| Approve a batch (not own) | Y | Y | Y | Y | | | | | |
| Export the load file (not own) | Y | Y | Y | Y | Y | | Y | Y | |
| Mark loaded in SAP | Y | Y | Y | Y | Y | | | | |
| Auto-cleanse approve | Y | Y | Y | Y | | | | | |
| Auto-cleanse write | Y | Y | Y | | | | | | |
| Acknowledge a monitor | Y | Y | Y | | | | | | |
| Make a rule, verified fixes | Y | | Y | | | | | | |
| Approve a learned rule | Y | Y | Y | Y | | | | | |
| Migration analysis, field map | Y | Y | Y | | Y | | Y | | |
| Save a value map | Y | Y | Y | | | | | | |
| Migration workbook export | Y | Y | Y | Y | Y | | Y | Y | |
| New master data request | Y | Y | Y | | | | | | |
| Approve a request | Y | Y | Y | Y | | | | | |

Export of the load file needs an approved batch. The role that can export but not approve (SB, An, Au) can export
only after someone else approves.

---

## Material master (`material_master`, "Material master")

**Source.** SAP ECC or S/4HANA. Rule pack `checks/rules/ecc/material_master`, 1076 rules.

| Severity | Rules |
|---|---|
| critical | 21 |
| high | 372 |
| medium | 414 |
| low | 269 |

Most-checked tables:

| Table | Text | Rules |
|---|---|---|
| MARC | Plant data for material | 242 |
| MARA | General material data | 177 |
| MBEW | Material valuation | 92 |
| MVKE | Sales data for material | 60 |
| MDMA | MRP area data | 48 |
| MARM | Units of measure for material | 42 |
| MKAL | Production versions | 41 |

Sample critical rules:

| Rule | Field | Message |
|---|---|---|
| MM001 | MARA.MATNR (material number) | Material number is mandatory - primary key for all material transactions |
| MM003 | MARA.MTART (material type) | Material type is mandatory |
| MM008 | MARA.MEINS (base unit of measure) | Base unit of measure is mandatory |
| MM033 | MBEW.VPRSV (price control indicator) | Price control indicator must be S (standard) or V (moving average) |
| MM035 | MBEW.BKLAS (valuation class) | Valuation class is mandatory for FI account determination |

**Journey: fix a critical material rule**

1. `/o/_/material-master` (Overview). The lede shows the score out of 100.
2. Tab **Rules**. Segment **Top fixes**. Find the rule.
3. Click **Accept all** (steward). The values go into a draft batch.
4. Data owner: `/work?filter=approvals`, open the batch, click **Approve**.
5. Owner or steward (not the builder): **Export load file**, format `cockpit_xlsx` (Migration Cockpit, Excel).
6. After the load in SAP: **Loaded in SAP**. The next run shows the rule's count drop.
7. `/work/monitor` shows any records that fail again.

**Migration.** The workbook panel on `/migration` accepts Migration Cockpit templates with `TABLE.FIELD` columns, for
example `S_MARA`. Other views: `/materials` ("Material 360"), `/s4` ("S/4HANA readiness").

---

## SD customer master (`sd_customer_master`, "SD customer master")

**Source.** SAP ECC. Rule pack `checks/rules/ecc/sd_customer_master`, 803 rules.

| Severity | Rules |
|---|---|
| critical | 10 |
| high | 361 |
| medium | 263 |
| low | 169 |

Most-checked tables:

| Table | Text | Rules |
|---|---|---|
| KNA1 | General customer data | 201 |
| TIBAN | IBAN | 95 |
| KNVV | Customer sales data | 93 |
| IFLO | Functional location | 70 |
| KNB1 | Customer company code data | 56 |
| KNVK | Contact persons | 33 |
| ADRC | Addresses | 32 |
| KNVP | Customer partner functions | 31 |

Sample critical rules:

| Rule | Field | Message |
|---|---|---|
| SDCM001 | KNA1.KUNNR (customer number) | Customer number is mandatory |
| SDCM003 | KNA1.NAME1 (name) | Customer name is mandatory |
| SDCM005 | KNA1.LAND1 (country) | Country is mandatory |
| SDCM008 | KNA1.KTOKD (account group) | Customer account group is mandatory |

**Journey.** Same as material master, on `/o/_/sd-customer-master`. For S/4HANA, customers become business partners;
see `business_partner` below and `/s4`.

---

## Employee Central (`employee_central`, "Employee central")

**Source.** SAP SuccessFactors. Rule pack `checks/rules/successfactors/employee_central`, 781 rules.

| Severity | Rules |
|---|---|
| critical | 46 |
| high | 319 |
| medium | 290 |
| low | 126 |

Most-checked entities:

| Entity | Text | Rules |
|---|---|---|
| EMPEMPLOYMENT | Employment | 176 |
| PERINFO | Personal information | 154 |
| EMPJOBHIST | Job history | 73 |
| PERADDRESS | Address | 45 |
| POSITION | Position | 39 |
| USERACCOUNT | User account | 35 |
| COMPINFO | Compensation information | 22 |
| PEREMERGENCY | Emergency contact | 18 |
| PERPHONE | Phone | 17 |
| EMPWORKPERMIT | Work permit | 17 |
| PAYMENTINFO | Payment information | 16 |
| PEREMAIL | Email | 14 |

Foundation objects (FO entities) are also checked.

Sample critical rules:

| Rule | Field | Message |
|---|---|---|
| EC001 | EMPEMPLOYMENT.USERID (user ID) | User ID is mandatory |
| EC005 | EMPEMPLOYMENT.START_DATE (start date) | Start date is mandatory |
| EC007 | EMPEMPLOYMENT.COMPANY (company) | Company is mandatory |
| EC014 | EMPEMPLOYMENT.STATUS (status) | Valid code A (active), I (inactive), T (terminated), S (suspended), R (retired) |
| EC025 | EMPEMPLOYMENT.START_DATE (start date) | Start date not after end date |

Rules EC654 to EC693 check data against the migration workbook.

**Journey: migrate to a new HR system with its workbook**

1. `/migration`. Open "Workbook from the new system".
2. Step "Choose the run and workbook": pick the run and upload the new system's workbook.
3. Step "Check what fits": click **Check the workbook**. Nothing is stored. Rows show "Required for this country and
   empty" where a country rule fails. "Country rules not checked" lists countries without rules.
4. Step "Export the data": click **Export in the same format**, **Export as Excel** or **Export as CSV files**. Each
   export is written to the audit log.

Workbook sheets read: PerPerson, PerPersonal, PerNationalId, PerPhone, PerEmail, PerAddressDEFLT,
PaymentInformationDetailV3, EmpEmployment, EmpJob, EmpCompensation, User, FO sheets and Position.

The panel shows for any target, not only SuccessFactors: the same check and export read S/4HANA migration cockpit
templates and other load files. Fixes and approval follow the common actions above.

---

## Payroll integration (`payroll_integration`, "Payroll integration")

**Source.** SAP SuccessFactors to payroll. Rule pack `checks/rules/successfactors/payroll_integration`, 357 rules.
Fields come from PAYMENTINFO (payment information), PA0008 (basic pay), PERINFO (personal information), PAYRESULT
(payroll results), HRPY_RGDIR (payroll directory), PA0014 (recurring payments) and PA0015 (additional payments).
Actions are the common ones, on `/o/_/payroll-integration`.

---

## Business partner (`business_partner`, "Business partner")

**Source.** SAP S/4HANA. Rule pack `checks/rules/ecc/business_partner`, 173 rules. Related pack `s4hc_master_data`
("BP roles, CVI and product valuation"), 43 rules. Actions are the common ones, on `/o/_/business-partner`.

---

## Other scored objects

Each has the common actions. The label is the one shown on screen.

| Key | Label | Source | Rules |
|---|---|---|---|
| `mm_purchasing` | MM purchasing | ECC | 447 |
| `sd_sales_orders` | SD sales orders | ECC | 598 |
| `production_planning` | Production planning | ECC | 460 |
| `plant_maintenance` | Plant maintenance | ECC | 425 |
| `deliveries_billing` | Deliveries billing | ECC | 424 |
| `quality_management` | Quality management | ECC | 422 |
| `project_system` | Project system | ECC | 253 |
| `fi_gl` | FI general ledger | ECC | 251 |
| `accounts_payable` | Accounts payable | ECC | 251 |
| `hcm` | HCM personnel administration | ECC | 189 |
| `s4_readiness` | S/4HANA readiness | ECC | 158 |
| `accounts_receivable` | Accounts receivable | ECC | 155 |
| `asset_accounting` | Asset accounting | ECC | 150 |
| `controlling` | Controlling | ECC | 127 |
| `internal_orders` | Internal orders | ECC | 105 |
| `banking_tax` | Banking and tax master data | ECC | 97 |
| `interface_health` | Interface health (IDoc) | ECC | 58 |
| `compensation` | Compensation | SuccessFactors | 221 |
| `benefits` | Benefits | SuccessFactors | 98 |
| `performance_goals` | Performance and goals | SuccessFactors | 82 |
| `recruiting_onboarding` | Recruiting and onboarding | SuccessFactors | 82 |
| `time_attendance` | Time and attendance | SuccessFactors | 82 |
| `learning_management` | Learning management | SuccessFactors | 81 |
| `succession_planning` | Succession planning | SuccessFactors | 81 |
| `ewms_transfer_orders` | eWMS transfer orders | Warehouse | 102 |
| `ewms_stock` | eWMS stock | Warehouse | 89 |
| `transport_management` | Transport management | Warehouse | 75 |
| `fleet_management` | Fleet management | Warehouse | 64 |
| `wm_interface` | WM interface | Warehouse | 63 |
| `grc_compliance` | GRC compliance | Warehouse | 53 |
| `mdg_master_data` | MDG master data | Warehouse | 52 |
| `batch_management` | Batch management | Warehouse | 41 |
| `cross_system_integration` | Cross-system integration | Warehouse | 40 |
| `ariba_contracts` | Ariba contracts | Ariba | 44 |
| `ariba_procurement` | Ariba purchase orders and invoices | Ariba | 43 |
| `ariba_supplier` | Ariba suppliers | Ariba | 42 |
| `ariba_spend` | Ariba spend | Ariba | 12 |
| `concur_expense` | Concur expense reports | Concur | 41 |
| `concur_users` | Concur users and cost objects | Concur | 42 |
| `concur_travel` | Concur travel | Concur | 14 |

Which objects a tenant can extract depends on its licence. An extract of an object outside the licence returns
"This deployment's licence does not include: {objects}. Ask your administrator to add it in Meridian HQ."
