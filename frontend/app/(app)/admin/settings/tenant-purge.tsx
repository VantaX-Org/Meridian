"use client";

/**
 * Settings › Retention › Delete all data. The API purges a tenant in two steps: a request issues a token that becomes
 * usable 24 hours later, and the purge itself needs that token. The pending token is kept in this browser so the
 * second step can follow the next day. Both steps are typed confirmations; the second saves the deletion certificate.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, ConfirmDialog, Notice, toast } from "@/design";
import { executeTenantPurge, requestTenantPurge, type TenantPurgeRequest } from "@/lib/api/retention";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";

export const PURGE_PHRASE = "purge all data";
const STORE = "meridian:tenant-purge";

function load(): TenantPurgeRequest | null {
  try {
    const raw = window.localStorage.getItem(STORE);
    const v = raw ? (JSON.parse(raw) as Partial<TenantPurgeRequest>) : null;
    return v && typeof v.token === "string" && typeof v.executes_after === "string" ? { token: v.token, executes_after: v.executes_after } : null;
  } catch {
    return null;
  }
}
function save(v: TenantPurgeRequest | null): void {
  try {
    if (v) window.localStorage.setItem(STORE, JSON.stringify(v));
    else window.localStorage.removeItem(STORE);
  } catch {
    /* storage can be blocked: the request still shows for this visit */
  }
}

export function TenantPurge({ now = () => Date.now() }: { now?: () => number }) {
  const { can } = usePermissions();
  const [pending, setPending] = useState<TenantPurgeRequest | null>(() => load());
  const [asking, setAsking] = useState(false);
  const [running, setRunning] = useState(false);

  const request = useMutation({
    mutationFn: requestTenantPurge,
    onSuccess: (r) => { save(r); setPending(r); setAsking(false); toast("Purge requested: it can run after the delay"); },
    onError: (e) => { setAsking(false); toast.error(apiErrorMessage(e)); },
  });
  const run = useMutation({
    mutationFn: (token: string) => executeTenantPurge(token),
    onSuccess: () => { save(null); setPending(null); setRunning(false); toast.success("Data purged: the deletion certificate was saved"); },
    onError: (e) => { setRunning(false); toast.error(apiErrorMessage(e)); },
  });

  // The API gates the purge on manage_settings; manage_system (the licence admin) is the second key in the plan.
  if (!can("manage_system") || !can("manage_settings")) return null;
  const ready = pending ? now() >= Date.parse(pending.executes_after) : false;

  return (
    <div className="flex flex-col gap-3" data-testid="tenant-purge">
      <h3 className="font-semibold m-text-h">Delete all data</h3>
      <p className="m-text-body m-ink-2">
        Removes every run, report and audit row of this organisation, and its stored files, for good. A request issues a token that works after 24 hours, so a mistake can be caught. The purge log keeps the record of the deletion.
      </p>
      {pending ? (
        <Notice tone="warning">
          <span>
            {ready ? "The purge can run now." : `The purge can run after ${formatDate(pending.executes_after, "datetime")}.`}
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!ready} onClick={() => setRunning(true)}>Purge now</Button>
            <Button variant="ghost" onClick={() => { save(null); setPending(null); }}>Forget this request</Button>
          </div>
        </Notice>
      ) : (
        <div><Button variant="secondary" onClick={() => setAsking(true)}>Request purge</Button></div>
      )}

      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Request a purge of all data"
        tone="danger"
        typeToConfirm={PURGE_PHRASE}
        body={`Nothing is deleted yet. This issues a token that works 24 hours from now. Type "${PURGE_PHRASE}" to continue.`}
        confirmLabel="Request purge"
        cancelLabel="Keep my data"
        pending={request.isPending}
        onConfirm={() => request.mutate()}
      />
      <ConfirmDialog
        open={running}
        onOpenChange={setRunning}
        title="Purge all data now"
        tone="danger"
        typeToConfirm={PURGE_PHRASE}
        body={`Every run, report and audit row is deleted for good and a deletion certificate is saved. Type "${PURGE_PHRASE}" to purge.`}
        confirmLabel="Purge now"
        cancelLabel="Keep my data"
        pending={run.isPending}
        onConfirm={() => pending && run.mutate(pending.token)}
      />
    </div>
  );
}
