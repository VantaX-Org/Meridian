"use client";

import { Money } from "../Money";
import { useCallback, useState, type ReactNode } from "react";
import { formatDate } from "@/lib/format";
import { errorSentence } from "@/lib/api/v2/client";
import type { RowRef } from "@/lib/v2/work-actions";
import { useWorkActions } from "@/lib/v2/work-actions";
import { approveBlock, type BatchRow } from "@/lib/v2/batches";
import { useBatchActions, useBatchCan } from "@/lib/v2/batch-actions";
import { useAssignable } from "@/lib/v2/approvals-queries";
import { int } from "@/lib/v2/score";
import { useToast } from "../Toast";
import { MenuButton, type MenuEntry } from "../Menu";
import { Dash } from "../parts";
import type { Outcome } from "../inspector/shared";
import { PromptDialog } from "./work-parts";
import { t } from "@/lib/v2/i18n";

export const money = (n: number | null | undefined): ReactNode => (n == null ? <Dash why={t("The cost model has not priced this batch")} /> : <Money amount={n} />);
export const day = (iso: string | null | undefined): string => (iso ? formatDate(iso, "date") : "—");

/**
 * What a batch's buttons do, shared by the ledger's batch rows, the batch inspector and the person inspector. A result
 * (the file handed to SAP, a refusal) goes to `onResult` when the caller shows it in its own frame, else to a notice.
 */
export function useBatchControls(onResult?: (o: Outcome) => void) {
  const can = useBatchCan();
  const actions = useBatchActions();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [back, setBack] = useState<BatchRow | null>(null);

  const fail = useCallback(
    (e: unknown, fallback: string) => {
      const detail = errorSentence(e, fallback);
      if (onResult) onResult({ tone: "fail", title: t("It did not go through"), detail });
      else toast.show(detail, "error");
    },
    [onResult, toast],
  );

  const approve = useCallback(
    async (b: BatchRow) => {
      setBusy(`approve:${b.id}`);
      try {
        await actions.approve(b.id, b.label);
      } catch (e) {
        fail(e, t("The batch could not be approved."));
      } finally {
        setBusy(null);
      }
    },
    [actions, fail],
  );

  const sendBack = useCallback(
    async (b: BatchRow, note: string) => {
      setBusy(`back:${b.id}`);
      try {
        await actions.sendBack(b.id, b.label, note);
      } catch (e) {
        fail(e, t("The batch could not be sent back."));
      } finally {
        setBusy(null);
      }
    },
    [actions, fail],
  );

  const send = useCallback(
    async (b: BatchRow) => {
      setBusy(`send:${b.id}`);
      try {
        const r = await actions.sendToSap(b.id, b.records);
        const sum = r.sha256 ? t(", sha256 {sha256}", { sha256: r.sha256.slice(0, 12) }) : "";
        onResult?.({ tone: "ok", title: t("Sent to SAP, {records} {records2, plural, one {record} other {records}}", { records: int(r.records ?? b.records), records2: (r.records ?? b.records) }), detail: t("{filename}{sum}. Load it into SAP with the Migration Cockpit.", { filename: r.filename, sum }), job: r.job_id });
        if (!onResult) toast.show(t("Sent batch {label} to SAP as {filename}", { label: b.label, filename: r.filename }));
      } catch (e) {
        fail(e, t("The batch could not be sent to SAP."));
      } finally {
        setBusy(null);
      }
    },
    [actions, fail, onResult, toast],
  );

  const dialog = back ? (
    <PromptDialog
      title={t("Send the batch back")}
      description={t("Batch {label} returns to its author with your reason.", { label: back.label })}
      label={t("What the author has to change")}
      confirm={t("Send back")}
      multiline
      onCancel={() => setBack(null)}
      onConfirm={(note) => {
        const b = back;
        setBack(null);
        void sendBack(b, note);
      }}
    />
  ) : null;

  return { can, busy, approve, send, askSendBack: setBack, dialog };
}

export type BatchControls = ReturnType<typeof useBatchControls>;

/** The buttons a batch offers this person: Approve and Send back on a draft, Send to SAP on an approved batch. */
export function BatchButtons({ b, c, sm = true }: { b: BatchRow; c: BatchControls; sm?: boolean }) {
  const cls = `m2-btn${sm ? " m2-sm" : ""}`;
  const block = approveBlock(b, c.can, c.can.me);
  if (b.status === "draft") {
    if (!c.can.approve) return null;
    return (
      <>
        <button type="button" className={`${cls} m2-strong`} disabled={block !== null || c.busy !== null} title={block ?? undefined} aria-label={t("Approve batch {label}", { label: b.label })} onClick={() => void c.approve(b)}>
          {c.busy === `approve:${b.id}` ? t("Approving…") : t("Approve")}
        </button>
        <button type="button" className={cls} disabled={block !== null || c.busy !== null} title={block ?? undefined} aria-label={t("Send batch {label} back", { label: b.label })} onClick={() => c.askSendBack(b)}>
          {t("Send back")}
        </button>
      </>
    );
  }
  if (b.status === "approved") {
    if (!c.can.send) return null;
    const mine = b.ownerId != null && b.ownerId === c.can.me;
    return (
      <button type="button" className={`${cls} m2-strong`} disabled={c.busy !== null || mine} title={mine ? t("You built this batch; a second person sends it.") : undefined} aria-label={t("Send batch {label} to SAP", { label: b.label })} onClick={() => void c.send(b)}>
        {c.busy === `send:${b.id}` ? t("Sending…") : t("Send to SAP")}
      </button>
    );
  }
  return null;
}

/** Reassign…: the people work can be assigned to, loaded when the menu opens. `rows` reads the records to move. */
export function ReassignMenu({ rows, disabled, className = "m2-btn", subject }: { rows: () => Promise<{ rows: RowRef[]; total: number }>; disabled?: boolean; className?: string; subject: string }) {
  const [open, setOpen] = useState(false);
  const users = useAssignable(open);
  const actions = useWorkActions();
  const toast = useToast();
  const entries: MenuEntry[] = [
    { kind: "heading", label: t("Reassign to") },
    ...(users.data ?? []).map<MenuEntry>((u) => ({
      kind: "item",
      id: u.id,
      label: u.name,
      sub: u.email,
      onSelect: () => {
        void (async () => {
          try {
            const r = await rows();
            if (r.rows.length === 0) {
              toast.show(t("There are no open records to reassign."));
              return;
            }
            const more = r.total > r.rows.length ? t("; {count} more remain, reassign again for the rest", { count: int(r.total - r.rows.length) }) : "";
            await actions.decide(r.rows, "assign", { assignee: u.id, label: t("Reassigned {rowsCount} {rowsCount2, plural, one {record} other {records}} of {subject} to {name}{more}", { rowsCount: int(r.rows.length), rowsCount2: r.rows.length, subject, name: u.name, more }) });
          } catch (e) {
            toast.show(errorSentence(e, t("The records could not be reassigned.")), "error");
          }
        })();
      },
    })),
    ...(users.isLoading ? [{ kind: "item", id: "loading", label: t("Reading the people…"), disabled: true } as MenuEntry] : []),
    ...(users.isError ? [{ kind: "item", id: "error", label: t("The people could not be read"), disabled: true } as MenuEntry] : []),
  ];
  return (
    <span style={{ display: "inline-flex" }} aria-disabled={disabled ? "true" : undefined}>
      <MenuButton label={t("Reassign")} buttonLabel={t("Reassign…")} entries={disabled ? [{ kind: "item", id: "off", label: t("Your role cannot assign work"), disabled: true }] : entries} className={className} onOpen={() => setOpen(true)}>
        {t("Reassign…")}
      </MenuButton>
    </span>
  );
}
