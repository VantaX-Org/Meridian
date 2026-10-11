"""ARB (Ariba) event builder (spec §2.2, §2.3 ARB).

Cases: ``requisition`` = requisitionId (primary), ``supplier`` = supplierId, ``contract`` = contractId."""

from __future__ import annotations

from typing import Iterator, Optional

from api.services.process_discovery.builders._cloud import in_window
from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, event, iso_ts, rows,
)

A = ActivityMap
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_REQUISITION", "Create requisition", "ARB-PRC-PROCUREMENT-X_CREATE_REQUISITION", "requisition",
      "requisitions.requisitionId", "requisitions row", "requisitions.createdDate", 1, True),
    A("REGISTER_SUPPLIER", "Register supplier", "ARB-SUP-SUPPLIER_MANAGEMENT-01", "supplier",
      "suppliers.supplierId", "suppliers row", "suppliers.registrationDate", 1, True),
    A("CONTRACT_EFFECTIVE", "Contract effective", "ARB-CON-CONTRACTS-01", "contract", "contracts.contractId",
      "contracts row", "contracts.effectiveDate", 1, True),
    A("CONTRACT_EXPIRED", "Contract expired", "ARB-CON-CONTRACTS-X_EXPIRED", "contract", "contracts.expirationDate",
      "expirationDate not after the run date", "contracts.expirationDate", 2, False),
)
M = {m.key: m for m in MAPPING}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    for r in rows(frames.get("requisitions", ["requisitionId", "requestor", "status", "createdDate",
                                              "approvalStatus"])):
        yield event(ctx, M["CREATE_REQUISITION"], r["requisitionId"], in_window(ctx, iso_ts(ctx, r["createdDate"])),
                    "requisitions", user=r["requestor"], hashed=True,
                    attrs={"status": r["status"], "approvalStatus": r["approvalStatus"]})
    for r in rows(frames.get("suppliers", ["supplierId", "qualificationStatus", "registrationDate"])):
        yield event(ctx, M["REGISTER_SUPPLIER"], r["supplierId"], in_window(ctx, iso_ts(ctx, r["registrationDate"])),
                    "suppliers", attrs={"qualificationStatus": r["qualificationStatus"]})
    for r in rows(frames.get("contracts", ["contractId", "status", "effectiveDate", "expirationDate", "owner"])):
        attrs = {"status": r["status"]}
        yield event(ctx, M["CONTRACT_EFFECTIVE"], r["contractId"], in_window(ctx, iso_ts(ctx, r["effectiveDate"])),
                    "contracts", user=r["owner"], hashed=True, attrs=attrs)
        expired = in_window(ctx, iso_ts(ctx, r["expirationDate"]))
        if expired and expired[0].date() <= ctx.run_date:
            yield event(ctx, M["CONTRACT_EXPIRED"], r["contractId"], expired, "contracts", user=r["owner"], hashed=True,
                        attrs=attrs)
