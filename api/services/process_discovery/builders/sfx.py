"""SFX (SuccessFactors) event builder (spec §2.2, §2.3 SFX).

Cases: ``requisition`` = requisitionId, ``emp_event`` = hash(userId)/startDate/seqNumber,
``time_record`` = hash(userId)/startDate/timeType. Raw userId never leaves this module (spec §2.1).
One application's ``lastModifiedDate`` gives only its latest status, so SFX rework cannot be measured."""

from __future__ import annotations

from typing import Iterator, Optional

from api.services.process_discovery.builders._cloud import in_window
from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, dyn, event, iso_ts, norm_key, rows, sorted_rows,
)

A = ActivityMap
_REQ = "SFX-RCM-MANAGE_JOB_REQUISITIONS"
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_REQUISITION", "Create job requisition", f"{_REQ}-01", "requisition",
      "JobRequisition.requisitionId", "JobRequisition row", "JobRequisition.createdDate", 1, True),
    A("RECEIVE_APPLICATION", "Receive application", f"{_REQ}-02", "requisition", "JobApplication.applicationId",
      "JobApplication for the requisition", "JobApplication.appliedDate", 2, True),
    A("APPLICATION_<STATUS>", "Application reached <status>", f"{_REQ}-X_APP_<STATUS>", "requisition",
      "JobApplication.status", "JobApplication status set", "JobApplication.lastModifiedDate", 3, False),
    A("HIRE", "Hire employee", "SFX-EC-ADD_NEW_EMPLOYEE-02", "emp_event", "EmpJob.event",
      "EmpJob event='H'", "EmpJob.startDate", 1, True),
    A("EVENT_<EVENT>", "Job event <event>", "SFX-DSC-EVENT_<EVENT>-01", "emp_event", "EmpJob.event",
      "EmpJob, any other event", "EmpJob.startDate", 1, True),
    A("RECORD_TIME", "Record time", "SFX-TIM-MY_TIMESHEET-01", "time_record", "EmployeeTime.timeType",
      "EmployeeTime row", "EmployeeTime.startDate", 1, True),
)
M = {m.key: m for m in MAPPING}


def application_status(status: str) -> ActivityMap:
    """``APPLICATION_<STATUS>`` under the requisition L4 (spec §4.2 rule 2). ``norm_key`` keeps ``ID_PATTERN``."""
    key = norm_key(status, 24)
    return dyn(M["APPLICATION_<STATUS>"], f"APPLICATION_{key}", f"Application reached {status}",
               f"{_REQ}-X_APP_{key}")


def job_event(code: str) -> ActivityMap:
    """``HIRE`` for event 'H', else the discovered ``EVENT_<event>`` branch (spec §4.2 rule 3)."""
    if code == "H":
        return M["HIRE"]
    key = "EVENT_" + (norm_key(code, 24) or "NONE")
    return dyn(M["EVENT_<EVENT>"], key, f"Job event {code or 'none'}", f"SFX-DSC-{key}-01")


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    # Sorted by full row first, so the last row per requisitionId does not depend on input order.
    reqs = {r["requisitionId"]: r for r in sorted_rows(frames.get(
        "JobRequisition", ["requisitionId", "status", "createdDate", "hiringManager"]))}
    for req, r in reqs.items():
        yield event(ctx, M["CREATE_REQUISITION"], req, in_window(ctx, iso_ts(ctx, r["createdDate"])),
                    "JobRequisition", user=r["hiringManager"], hashed=True, attrs={"status": r["status"]})
    for r in rows(frames.get("JobApplication", ["applicationId", "requisitionId", "status", "appliedDate",
                                                "lastModifiedDate"])):
        if r["requisitionId"] not in reqs:
            continue
        refs = [("applicationId", r["applicationId"])]
        yield event(ctx, M["RECEIVE_APPLICATION"], r["requisitionId"], in_window(ctx, iso_ts(ctx, r["appliedDate"])),
                    "JobApplication", refs=refs)
        if r["status"]:
            yield event(ctx, application_status(r["status"]), r["requisitionId"],
                        in_window(ctx, iso_ts(ctx, r["lastModifiedDate"])), "JobApplication", refs=refs,
                        attrs={"status": r["status"]})

    for r in rows(frames.get("EmpJob", ["userId", "startDate", "seqNumber", "event", "eventReason", "company"])):
        when = in_window(ctx, iso_ts(ctx, r["startDate"], day=True))
        if not r["userId"] or when is None:
            continue
        case = f"{ctx.hash(r['userId'])}/{when[0].date().isoformat()}/{r['seqNumber']}"
        yield event(ctx, job_event(r["event"]), case, when, "EmpJob", doc_type=r["event"],
                    org={"company": r["company"]}, attrs={"event": r["event"], "eventReason": r["eventReason"]})

    for r in rows(frames.get("EmployeeTime", ["userId", "timeType", "startDate", "approvalStatus"])):
        when = in_window(ctx, iso_ts(ctx, r["startDate"], day=True))
        if not r["userId"] or when is None:
            continue
        case = f"{ctx.hash(r['userId'])}/{when[0].date().isoformat()}/{r['timeType']}"
        yield event(ctx, M["RECORD_TIME"], case, when, "EmployeeTime", doc_type=r["timeType"],
                    attrs={"timeType": r["timeType"], "approvalStatus": r["approvalStatus"]})
