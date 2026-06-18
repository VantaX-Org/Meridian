"""One-shot: add missing enrichment (why_it_matters, sap_impact, fix_map,
record_fix_template) to the 24 freshness_check rules that lacked it.

Locates each rule by its `- id: <ID>` line and inserts the new fields directly
after that rule's `rule_authority:` line, preserving all existing formatting
byte-for-byte (no YAML round-trip). Idempotent: skips a rule that already has
why_it_matters.
"""
from pathlib import Path

ROOT = Path(__file__).parent.parent / "checks" / "rules"

# rule_id -> (file relative to checks/rules, why_it_matters, sap_impact, fix_blank, record_fix_template)
E = {
    "AP033": ("ecc/accounts_payable.yaml",
        "Vendor master records untouched for 2+ years often carry outdated bank details, payment terms, or addresses. Stale banking data is a primary vector for misdirected and fraudulent payments.",
        "Payments may be remitted to closed or changed bank accounts; duplicate or one-time vendors accumulate; supplier reconciliation drifts.",
        "Re-validate the vendor in FK02 / XK02 (ECC) or Fiori app F3893 Manage Business Partner (S/4HANA): confirm bank details, payment terms, and address against a current supplier statement, then save to refresh the change date.",
        "Vendor {field} last changed {age_days} days ago. Re-validate bank, payment terms, and address in FK02/XK02 or BP, then save."),
    "AR026": ("ecc/accounts_receivable.yaml",
        "Customer master records unchanged for 2+ years may hold outdated credit limits, payment terms, or addresses, weakening credit control and dunning accuracy.",
        "Credit exposure is assessed on stale limits; invoices and dunning letters reach wrong addresses; collection effectiveness drops.",
        "Review the customer in FD02 / XD02 (ECC) or Fiori Manage Business Partner (S/4HANA): reassess credit limit, payment terms, and address, then save to refresh the change date.",
        "Customer {field} last changed {age_days} days ago. Reassess credit limit, terms, and address in FD02/XD02 or BP, then save."),
    "AA031": ("ecc/asset_accounting.yaml",
        "Assets capitalised more than 10 years ago frequently outlive their planned useful life; depreciation terms and impairment status may no longer reflect reality.",
        "Balance sheet may overstate net book value; depreciation runs post against outdated useful life; retired assets linger as active.",
        "Review the asset in AS02: confirm useful life, depreciation key, and whether the asset is still in use; retire via ABAVN if disposed, or update depreciation terms.",
        "Asset {field} capitalised {age_days} days ago. Confirm useful life/depreciation key in AS02, or retire via ABAVN if disposed."),
    "GL026": ("ecc/fi_gl.yaml",
        "GL accounts created 5+ years ago may retain outdated field-status, tax, or open-item configuration that no longer matches current accounting policy.",
        "Postings may apply wrong tax categories or field status; reconciliation accounts behave unexpectedly; reporting hierarchies misclassify the account.",
        "Review the account in FS00: verify account group, field-status, tax category, and open-item management against current chart-of-accounts policy; block via FS00 if obsolete.",
        "GL account {field} created {age_days} days ago. Verify field-status, tax category, and open-item settings in FS00; block if obsolete."),
    "PUR043": ("ecc/mm_purchasing.yaml",
        "Purchase orders open beyond 12 months usually represent abandoned commitments, over-delivery risk, or uncleared GR/IR that distorts open-commitment reporting.",
        "Open commitment and accrual figures are overstated; GR/IR clearing is blocked; MRP plans against orders that will never be received.",
        "Review the PO in ME23N / ME2M: confirm whether goods/invoice are still expected; close the line with a delivery-completed flag (ME22N) or set a deletion indicator if abandoned.",
        "PO {field} dated {age_days} days ago. Confirm delivery still expected in ME23N; set delivery-completed or deletion indicator if abandoned."),
    "PM034": ("ecc/plant_maintenance.yaml",
        "Equipment master records created 10+ years ago often carry outdated technical data, warranty status, or location assignments that misroute maintenance planning.",
        "Maintenance plans and orders reference wrong technical objects; warranty claims are missed; functional-location structure drifts from reality.",
        "Review the equipment in IE02: verify technical data, warranty dates, functional location, and status; deactivate via IE02 if scrapped or replaced.",
        "Equipment {field} created {age_days} days ago. Verify technical data, warranty, and functional location in IE02; deactivate if scrapped."),
    "PP028": ("ecc/production_planning.yaml",
        "Routings not updated in 3+ years may specify obsolete operations, work centres, or standard values, corrupting capacity planning and product costing.",
        "Scheduling and capacity planning use wrong lead times; standard-cost estimates drift from actuals; shop-floor papers list retired work centres.",
        "Review the routing in CA02: validate the operation sequence, work centres, and standard values against the current process; update or mark the group counter for deletion if superseded.",
        "Routing {field} last changed {age_days} days ago. Validate operations, work centres, and standard values in CA02; supersede if obsolete."),
    "SDCM026": ("ecc/sd_customer_master.yaml",
        "Sales-area customer data unchanged for 2+ years may hold outdated pricing, shipping, or payment determination that produces wrong order conditions.",
        "Sales orders derive incorrect pricing procedures, shipping points, or payment terms; deliveries route to obsolete addresses.",
        "Review the customer sales area in VD02 / XD02: verify pricing procedure, shipping conditions, incoterms, and payment terms, then save to refresh the change date.",
        "SD customer {field} last changed {age_days} days ago. Verify pricing, shipping, and payment terms in VD02/XD02, then save."),
    "SDSO034": ("ecc/sd_sales_orders.yaml",
        "Sales orders open beyond 12 months usually represent stuck or abandoned demand that inflates the order backlog and misleads revenue forecasting.",
        "Backlog and forecast figures are overstated; ATP and MRP plan against demand that will not convert; incomplete orders block billing.",
        "Review the order in VA02 / VA05: confirm whether it will still be delivered; complete the open items, reject the lines (reason for rejection), or close the order.",
        "Sales order {field} dated {age_days} days ago. Confirm in VA02 whether still valid; reject lines or close if abandoned."),
    "BEN012": ("successfactors/benefits.yaml",
        "Benefit enrollments older than 2 years may reflect lapsed elections, changed dependents, or superseded plans, producing incorrect coverage and deductions.",
        "Payroll deducts for stale or invalid benefit elections; carriers receive outdated enrollment files; employees may be under- or over-covered.",
        "Review the enrollment in the SuccessFactors Benefits module: confirm the elected plan, coverage tier, and dependents against current life events; re-enroll or terminate as needed.",
        "Benefit enrollment {field} is {age_days} days old. Confirm plan, tier, and dependents in the Benefits module; re-enroll or terminate."),
    "COMP017": ("successfactors/compensation.yaml",
        "Compensation records unchanged for 2+ years usually mean a missed review cycle; the stored salary likely lags market and internal-equity benchmarks.",
        "Pay-equity and budget reports use outdated figures; merit and bonus calculations seed from a stale base; retention risk goes unflagged.",
        "Review the record in the SuccessFactors Compensation module: validate base pay against the latest comp review and pay range; process an adjustment or document why no change applies.",
        "Compensation record {field} is {age_days} days old. Validate base pay against the latest review and range; adjust or document."),
    "LMS014": ("successfactors/learning_management.yaml",
        "Learning assignments past their due date represent overdue mandatory training — a direct compliance and audit exposure, especially for regulated curricula.",
        "Compliance dashboards report false completion; audits flag overdue mandatory training; certifications lapse and access entitlements based on training become invalid.",
        "In SuccessFactors Learning: notify the assignee and manager, extend or reassign the item if appropriate, and escalate persistently overdue mandatory training to the compliance owner.",
        "Learning assignment {field} is overdue by {age_days} days. Notify assignee/manager, reassign or extend, and escalate if mandatory."),
    "PAY017": ("successfactors/payroll_integration.yaml",
        "Payroll results older than 3 months suggest the integration has stopped delivering, or a population is no longer being paid through the expected run.",
        "Downstream GL postings, statutory filings, and reconciliations run on stale results; missing pay results may hide employees dropped from the run.",
        "Verify the payroll integration job and connector logs: confirm the most recent run delivered for all populations; reprocess or backfill the missing period and fix the broken schedule.",
        "Payroll result {field} is {age_days} days old. Verify the integration job ran for all populations; reprocess the missing period."),
    "PERF016": ("successfactors/performance_goals.yaml",
        "Performance reviews older than 2 years indicate a stalled review cycle or an employee whose goals are no longer being managed.",
        "Talent calibration and succession decisions use outdated ratings; merit and promotion inputs are stale; the employee may be effectively unmanaged.",
        "In SuccessFactors Performance & Goals: confirm the employee's current cycle assignment, restart or reassign the form, and ensure the manager completes the outstanding review.",
        "Performance review {field} is {age_days} days old. Confirm cycle assignment and ensure the manager completes the outstanding review."),
    "REC020": ("successfactors/recruiting_onboarding.yaml",
        "Requisitions open for 6+ months are usually stale, mis-prioritised, or filled-but-not-closed, skewing time-to-fill and pipeline metrics.",
        "Recruiting analytics report inflated open headcount and time-to-fill; candidates sit in limbo; approved budget is tied to dormant openings.",
        "Review the requisition in SuccessFactors Recruiting: confirm it is still needed, refresh the posting and approvers, or close it if filled or cancelled.",
        "Requisition {field} has been open {age_days} days. Confirm still needed and refresh, or close if filled or cancelled."),
    "TIME014": ("successfactors/time_attendance.yaml",
        "Time records older than 3 months with no newer activity often indicate an inactive worker, a broken time feed, or unprocessed time off.",
        "Time evaluation and leave accruals run on stale data; payroll may miss or double-count time; inactive workers retain open time profiles.",
        "Review the time account in SuccessFactors Time: confirm the worker is active and the time feed is current; process outstanding time and close profiles for inactive workers.",
        "Time record {field} is {age_days} days old. Confirm the worker is active and the feed is current; process outstanding time."),
    "XSYS014": ("warehouse/cross_system_integration.yaml",
        "Cross-system postings older than 3 months with no newer activity suggest the integration between systems has stalled or a document is stuck in the queue.",
        "Inventory and financial positions diverge between the connected systems; stuck IDocs or queue entries block downstream postings; reconciliation breaks.",
        "Check the integration monitor and queue (e.g. SMQ1/SMQ2, BD87 for IDocs): clear stuck entries, reprocess failed documents, and confirm the connector schedule is running.",
        "Cross-system posting {field} is {age_days} days old. Clear stuck queue/IDoc entries (SMQ2/BD87) and confirm the connector is running."),
    "EWMS023": ("warehouse/ewms_stock.yaml",
        "Stock records unchanged for 1+ year typically represent slow-moving or dead stock that ties up bin capacity and working capital.",
        "Warehouse capacity and carrying cost are inflated by dead stock; valuation may overstate usable inventory; obsolescence provisions are missed.",
        "Run a slow/dead-stock analysis: confirm the material is still required, relocate or consolidate the stock, and initiate scrap, return, or a write-down for genuine dead stock.",
        "Stock record {field} unchanged {age_days} days. Confirm still required; relocate, return, or initiate scrap/write-down for dead stock."),
    "EWMS_TO019": ("warehouse/ewms_transfer_orders.yaml",
        "Transfer orders open beyond 30 days are almost always stuck: the move never confirmed, leaving bins blocked and stock in an in-transit limbo.",
        "Bin capacity is blocked by phantom moves; available stock is understated; putaway and picking are obstructed by unconfirmed TOs.",
        "Review the open TO in the EWM/WM warehouse monitor: confirm or cancel the transfer order, resolve the physical move, and release the blocked source/destination bins.",
        "Transfer order {field} open {age_days} days unconfirmed. Confirm or cancel in the warehouse monitor and release the blocked bins."),
    "FLEET018": ("warehouse/fleet_management.yaml",
        "Vehicles not serviced in 1+ year are overdue for preventive maintenance, creating safety, warranty, and regulatory-compliance exposure.",
        "Unserviced vehicles risk breakdown and accident liability; warranties may be voided; statutory roadworthiness/inspection requirements go unmet.",
        "Schedule the overdue service: raise a maintenance order against the vehicle, confirm odometer/usage, and record the completed service to refresh the service date.",
        "Vehicle {field} not serviced {age_days} days. Raise a maintenance order, perform the overdue service, and record completion."),
    "GRC014": ("warehouse/grc_compliance.yaml",
        "Role assignments older than 2 years usually violate least-privilege: access granted long ago is rarely revalidated and accumulates as excess entitlement.",
        "Stale access widens the attack surface and fails SoD and access-recertification audits; terminated or moved users may retain entitlements.",
        "Run an access recertification: confirm the assignment is still required for the user's current role, revoke if not, and record the review to reset the validity date.",
        "Role assignment {field} is {age_days} days old. Recertify against the user's current role; revoke if not required and record the review."),
    "MDG017": ("warehouse/mdg_master_data.yaml",
        "Change requests open for 1+ year are stalled governance items that hold master-data updates in limbo and clog the MDG workflow.",
        "Approved master-data changes never activate; the MDG worklist is cluttered with dormant CRs; data stewards lose visibility of real backlog.",
        "Review the change request in MDG: confirm whether it is still required, route it to the current approver to complete, or withdraw and close it if obsolete.",
        "Change request {field} open {age_days} days. Route to the current approver to complete, or withdraw and close if obsolete."),
    "TM017": ("warehouse/transport_management.yaml",
        "Shipments open 3+ months are usually completed-but-not-closed or abandoned, distorting freight cost accruals and on-time-delivery metrics.",
        "Freight accruals and settlement are overstated or stuck; transportation KPIs are skewed; carrier invoices cannot be matched and cleared.",
        "Review the shipment in the TM document: confirm execution status, complete the outstanding events and freight settlement, or cancel if the shipment did not occur.",
        "Shipment {field} open {age_days} days. Complete outstanding events and freight settlement, or cancel if it did not occur."),
    "WM014": ("warehouse/wm_interface.yaml",
        "WM interface records older than 1 year with no newer activity often indicate a broken or decommissioned interface that has silently stopped processing.",
        "Stock movements between the WM interface and connected systems stop reconciling; the silent failure can hide unprocessed inventory transactions.",
        "Check the WM interface monitor and connection: confirm the interface is still active and processing; reprocess any backlog and decommission or repair a dead interface.",
        "WM interface record {field} is {age_days} days old. Confirm the interface is active, reprocess backlog, and repair or decommission if dead."),
}


def insert_fields(path: Path, rule_id: str, why: str, impact: str, fix: str, tmpl: str) -> str:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    out, i, done = [], 0, False
    n = len(lines)
    while i < n:
        line = lines[i]
        out.append(line)
        if line.strip() == f"- id: {rule_id}":
            # scan this rule block to its rule_authority line (stop at next list item)
            j = i + 1
            while j < n and not lines[j].lstrip().startswith("- id:"):
                # already enriched? bail out of this rule
                if lines[j].lstrip().startswith("why_it_matters:"):
                    break
                out.append(lines[j])
                if lines[j].lstrip().startswith("rule_authority:"):
                    pad = lines[j][: len(lines[j]) - len(lines[j].lstrip())]  # match rule's key indent
                    block = (
                        f'{pad}why_it_matters: "{why}"\n'
                        f'{pad}sap_impact: "{impact}"\n'
                        f'{pad}fix_map:\n'
                        f'{pad}  __blank__: "{fix}"\n'
                        f'{pad}record_fix_template: "{tmpl}"\n'
                    )
                    out.append(block)
                    done = True
                    j += 1
                    break
                j += 1
            i = j
            continue
        i += 1
    if not done:
        raise SystemExit(f"FAILED to enrich {rule_id} in {path} (anchor not found)")
    return "".join(out)


def main() -> None:
    for rule_id, (rel, why, impact, fix, tmpl) in E.items():
        for s in (why, impact, fix, tmpl):
            assert '"' not in s, f"{rule_id}: double-quote in value would break YAML"
        path = ROOT / rel
        path.write_text(insert_fields(path, rule_id, why, impact, fix, tmpl), encoding="utf-8")
        print(f"enriched {rule_id:12} -> {rel}")


if __name__ == "__main__":
    main()
