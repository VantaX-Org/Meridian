"use client";

import { useState } from "react";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { useWorkActions, useWorkCan, type DecideKind, type RowRef } from "@/lib/v2/work-actions";
import { Button, Confirm } from "../kit";

type Pending = { kind: DecideKind; title: string; consequence: string; confirm: string; needsNote: boolean; danger?: boolean };

/**
 * What can be done to the chosen records. Every action states its count first and waits for a yes. The undo notice
 * comes from the work actions themselves, so it only appears where the server has a real inverse to run.
 */
export function WorkBulkBar({ rows, onDone }: { rows: RowRef[]; onDone: () => void }) {
  const act = useWorkActions();
  const can = useWorkCan();
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!rows.length) return null;

  const withValue = rows.filter((r) => r.suggested_value).length;
  const n = formatInt(rows.length);
  const no = (ok: boolean) => (ok ? undefined : t("Your role cannot do this."));

  const ask = (p: Pending) => {
    setNote("");
    setPending(p);
  };
  const run = async () => {
    if (!pending) return;
    setBusy(true);
    const ok = await act.decide(rows, pending.kind, pending.kind === "assign" ? { assignee: "me" } : pending.needsNote ? { note: note.trim() } : {});
    setBusy(false);
    setPending(null);
    if (ok) onDone();
  };

  return (
    <>
      <Button
        variant="primary"
        size={32}
        icon="check"
        disabled={!can.approve && !can.apply}
        reason={no(can.approve || can.apply) ?? (withValue === 0 ? t("None of these has a suggested value.") : undefined)}
        onClick={() =>
          ask({
            kind: "accept",
            title: t("Approve the suggested fix"),
            consequence: t("This approves the suggested value for {m} of {n} records. Records without a suggested value are left as they are.", { m: formatInt(withValue), n }),
            confirm: t("Approve {m}", { m: formatInt(withValue) }),
            needsNote: false,
          })
        }
      >
        {t("Approve")}
      </Button>
      <Button
        size={32}
       
        disabled={!can.assign}
        reason={no(can.assign)}
        onClick={() =>
          ask({ kind: "assign", title: t("Assign to me"), consequence: t("This assigns {n} records to you.", { n }), confirm: t("Assign {n}", { n }), needsNote: false })
        }
      >
        {t("Assign to me")}
      </Button>
      <Button
        size={32}
        disabled={!can.approve}
        reason={no(can.approve)}
        onClick={() =>
          ask({
            kind: "accept_risk",
            title: t("Accept the risk"),
            consequence: t("This signs off {n} records as an accepted risk. They leave the open list and stay in Exceptions with your reason.", { n }),
            confirm: t("Accept risk on {n}", { n }),
            needsNote: true,
            danger: true,
          })
        }
      >
        {t("Accept risk")}
      </Button>
      <Button
        size={32}
        disabled={!can.approve}
        reason={no(can.approve)}
        onClick={() =>
          ask({
            kind: "not_an_issue",
            title: t("Mark as not an issue"),
            consequence: t("This marks {n} records as not an issue. They leave the open list and stay in Exceptions with your reason.", { n }),
            confirm: t("Mark {n}", { n }),
            needsNote: true,
          })
        }
      >
        {t("Not an issue")}
      </Button>
      <Confirm
        open={pending !== null}
        title={pending?.title ?? ""}
        danger={pending?.danger}
        confirmLabel={busy ? t("Working") : (pending?.confirm ?? "")}
        consequence={
          <>
            <p>{pending?.consequence}</p>
            {pending?.needsNote ? (
              <label className="nx-wk-note">
                {t("Why (required)")}
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
              </label>
            ) : null}
          </>
        }
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (busy || (pending?.needsNote && !note.trim())) return;
          void run();
        }}
      />
    </>
  );
}
