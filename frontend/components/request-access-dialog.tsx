"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Dialog, Mono } from "@/design";
import { createAccessRequest } from "@/lib/api/me";
import { apiErrorMessage } from "@/lib/error";
import type { RequestTarget } from "@/lib/rbac";

const field = "w-full rounded-md border px-2 py-1 text-[13px]";
const fieldStyle = { borderColor: "var(--m-line)", color: "var(--m-ink)" };

/**
 * Request access (rbac.md §5): resource, action and scope prefilled, a reason,
 * submit to POST /access-requests. The API's own message (e.g. the 422 for a
 * pair no role confers) is shown in the Dialog; nothing is pre-hidden.
 */
export function RequestAccessDialog({ target, onClose }: { target: RequestTarget | null; onClose: () => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()} title="Request access">
      {/* Keyed so each new target starts with an empty reason and no stale error. */}
      {target && <RequestForm key={`${target.resource}/${target.action}/${target.system_id ?? ""}/${target.module ?? ""}`} target={target} onClose={onClose} />}
    </Dialog>
  );
}

function RequestForm({ target, onClose }: { target: RequestTarget; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const send = useMutation({
    mutationFn: () =>
      createAccessRequest({
        resource: target.resource,
        action: target.action,
        system_id: target.system_id ?? null,
        module: target.module ?? null,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Request sent to admins");
      onClose();
    },
  });
  const scope = `${target.systemLabel ?? target.system_id ?? "all systems"}, ${target.module ?? "all modules"}`;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-[13px]" style={{ color: "var(--m-ink)" }}>
        <dt style={{ color: "var(--m-ink-3)" }}>Resource</dt>
        <dd><Mono>{target.resource}</Mono></dd>
        <dt style={{ color: "var(--m-ink-3)" }}>Action</dt>
        <dd><Mono>{target.action}</Mono></dd>
        <dt style={{ color: "var(--m-ink-3)" }}>Scope</dt>
        <dd>{scope}</dd>
      </dl>
      <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
        Reason
        <textarea className={field} style={fieldStyle} rows={3} maxLength={2000} value={reason}
          onChange={(e) => setReason(e.target.value)} />
      </label>
      {send.isError && (
        <p role="alert" className="text-[12px] leading-4" style={{ color: "var(--m-critical)" }}>
          {apiErrorMessage(send.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>Not now</Button>
        <Button type="submit" disabled={send.isPending}>Send request</Button>
      </div>
    </form>
  );
}
