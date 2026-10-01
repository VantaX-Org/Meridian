# Payroll amounts: the Meridian read-only RFC function

Payroll results live in the payroll cluster (PCL2), which RFC_READ_TABLE
cannot read. To check payroll amounts, Meridian calls one small custom
function module. It is read-only and remote-enabled, and it returns only the
totals of a few wage types per payroll result. Nothing else leaves the
payroll cluster, and nothing is written.

Without the function, every other HR check still runs. The extraction
coverage then lists `ZMERIDIAN_PAYRT` as **not installed**, and the payroll
amount rules are reported as not evaluated, never as passed.

## What it returns

For each payroll result (`PERNR` + `SEQNR`, taken from the HRPY_RGDIR rows
Meridian already extracted), it returns the totals of these wage types from
the results table RT:

| Wage type | Meaning |
|-----------|---------|
| `/101` | Total gross |
| `/559` | Bank transfer |
| `/560` | Amount paid |
| `/561` | Claim (employee owes the company) |

Pass `IT_WAGETYPES` to choose other wage types. The function never returns
names, bank details or any other personal data.

## Install (Basis / ABAP developer, about 15 minutes)

1. In SE11, create the three structures listed at the end of
   `sap/abap/Z_MERIDIAN_PAYROLL_TOTALS.abap`: `ZMERIDIAN_S_RGKEY`,
   `ZMERIDIAN_S_LGART` and `ZMERIDIAN_PAYRT`.
   - The name `ZMERIDIAN_PAYRT` must be exact: Meridian reads its field list
     through DDIF_FIELDINFO_GET like any other table.
2. In SE37 / SE80, create function group `ZMERIDIAN`. Create function module
   `Z_MERIDIAN_PAYROLL_TOTALS` with processing type **Remote-Enabled Module**.
   Paste the source and activate it.
3. Transport it to the systems Meridian connects to.

## Authorisations for the Meridian RFC user

| Object | Values |
|--------|--------|
| `S_RFC` | `RFC_TYPE = FUGR`, `RFC_NAME = ZMERIDIAN`, `ACTVT = 16` |
| `P_PCLX` | `RELID` = the cluster id of your country grouping (T500L-RELID for the MOLGA), `AUTHC = R` |

The function checks `P_PCLX` for each employee. Employees the user may not
read are skipped and counted in `EV_SKIPPED`; this count appears in the
extraction coverage.

## Data protection (POPIA / GDPR)

- The totals stay inside the customer's Meridian deployment, like all SAP
  data.
- The LLM receives only aggregated finding counts and messages, never
  amounts or personnel numbers.

## Reading the HR infotypes (no custom code)

The HR checks read the infotype tables (PA0000, PA0001, PA0002, PA0006,
PA0007, PA0008, PA0009, PA0014, PA0015, PA0105 and PA0185), HRPY_RGDIR, and
the configuration tables T582A, T500P, T501, T503K, T549A, T001P, T529A,
T510A and T512Z. Meridian reads them with RFC_READ_TABLE.

- **Authorisation.** The infotype tables carry table authorisation group
  `PA`, so the RFC user needs `S_TABU_NAM` (or `S_TABU_DIS` for group `PA`)
  with `ACTVT = 03`.
- **Bypassed HR authorisations.** Table reads do not apply HR master-data
  authorisations (`P_ORGIN`) or structural authorisations. Give the
  Meridian user these rights only on a decision of the data owner, and
  restrict the user in the same way as any other technical HR reader.
- **Licensing.** HR rules run under the existing licence modules
  `employee_central` (personnel administration) and `payroll_integration`
  (pay and payroll results), the same modules used for SuccessFactors.
