"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { approveWriteback, getPendingWritebacks } from "@/lib/api/v2/batches";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Session } from "@/lib/v2/hooks";
import { refreshV2 } from "@/lib/v2/queries";
import { t } from "@/lib/v2/i18n";
import { ConfirmBar, Gate } from "../forms";
import { Mono } from "../parts";
import { useToast } from "../Toast";
import { Panel } from "./Mining";

/**
 * Live write-back requests waiting for a second person (GET /writeback/approvals, POST /writeback/approve/{id}, needs approve).
 * Two steps: pick a request, then confirm in the page. The requester never approves their own.
 */
export function WritebackApprovals() {
  const { can, id: me } = useV2Session();
  const fx = useFixture();
  const toast = useToast();
  const qc = useQueryClient();
  const allowed = can("approve");
  const [pick, setPick] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["v2", "writeback-approvals", fx], queryFn: getPendingWritebacks, enabled: allowed, retry: false });
  const approve = useMutation({
    mutationFn: (id: string) => approveWriteback(id),
    onSuccess: async (r) => {
      setPick(null);
      await refreshV2(qc);
      if (r.errors.length > 0) toast.show(r.errors[0], "error");
      else toast.show(t("Write-back approved. {n} {count, plural, one {record} other {records}} written to SAP.", { n: r.applied, count: r.applied }));
    },
    onError: (e) => toast.show(errorSentence(e, t("The write-back could not be approved.")), "error"),
  });
  if (!allowed || !q.data || q.data.approvals.length === 0) return null;
  const sel = q.data.approvals.find((w) => w.id === pick);
  return (
    <Panel title={t("Write-back waiting for a second approver")} testId="writeback-approvals">
      {!q.data.live_enabled ? <Gate>{t("Live write-back is off on this deployment, so approving writes nothing. Deliver the fixes with the export.")}</Gate> : null}
      <table className="m2-tbl">
        <thead>
          <tr>
            <th>{t("Rule")}</th>
            <th>{t("Requested by")}</th>
            <th>{t("Records")}</th>
            <th>{t("Action")}</th>
          </tr>
        </thead>
        <tbody>
          {q.data.approvals.map((w) => {
            const own = w.requested_by !== null && w.requested_by === me;
            return (
              <tr key={w.id}>
                <td>
                  {w.check_id ? <Mono>{w.check_id}</Mono> : null} {w.rule_message ?? ""}
                </td>
                <td>{w.requested_by_name ?? w.requested_by ?? ""}</td>
                <td>{w.records_updated}</td>
                <td>
                  <button type="button" className="m2-btn m2-sm" disabled={own} title={own ? t("You asked for this write-back. A second person must approve it.") : undefined} onClick={() => setPick(w.id)}>
                    {t("Approve write-back")}
                  </button>
                  {own ? <span className="m2-prov"> {t("Four eyes: someone else approves.")}</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sel ? (
        <ConfirmBar
          message={t("Approving writes {n} {count, plural, one {record} other {records}} to SAP. This cannot be undone.", { n: sel.records_updated, count: sel.records_updated })}
          confirmLabel={t("Write to SAP")}
          pending={approve.isPending}
          onConfirm={() => approve.mutate(sel.id)}
          onCancel={() => setPick(null)}
        />
      ) : null}
    </Panel>
  );
}
