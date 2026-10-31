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
import { Dialog } from "../admin/kit";
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
  // F12: an approval the server refused because some records have no new value, with its sentence.
  const [blank, setBlank] = useState<{ b: BatchRow; sentence: string } | null>(null);
  // F08: the batch whose load file is about to be exported, and who loads it ("" for the SAP Basis people).
  const [exporting, setExporting] = useState<BatchRow | null>(null);
  const [loader, setLoader] = useState("");
  const people = useAssignable(exporting !== null);

  const fail = useCallback(
    (e: unknown, fallback: string) => {
      const detail = errorSentence(e, fallback);
      if (onResult) onResult({ tone: "fail", title: t("It did not go through"), detail });
      else toast.show(detail, "error");
    },
    [onResult, toast],
  );

  const approve = useCallback(
    async (b: BatchRow, withoutBlank = false) => {
      setBusy(`approve:${b.id}`);
      try {
        await actions.approve(b.id, b.label, withoutBlank);
      } catch (e) {
        const sentence = errorSentence(e, "");
        if (!withoutBlank && / no new value: /.test(sentence)) setBlank({ b, sentence });
        else fail(e, t("The batch could not be approved."));
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
    async (b: BatchRow, loaderId: string | null = null) => {
      setBusy(`send:${b.id}`);
      try {
        const r = await actions.sendToSap(b.id, b.records, loaderId);
        const sum = r.sha256 ? t(", sha256 {sha256}", { sha256: r.sha256.slice(0, 12) }) : "";
        onResult?.({ tone: "ok", title: t("Load file exported, {records} {records2, plural, one {record} other {records}}", { records: int(r.records ?? b.records), records2: (r.records ?? b.records) }), detail: t("{filename}{sum}. Load it into SAP with the Migration Cockpit, then confirm the load on the batch.", { filename: r.filename, sum }), job: r.job_id });
        if (!onResult) toast.show(t("Exported the load file of batch {label} as {filename}", { label: b.label, filename: r.filename }));
      } catch (e) {
        fail(e, t("The batch could not be sent to SAP."));
      } finally {
        setBusy(null);
      }
    },
    [actions, fail, onResult, toast],
  );

  const askSend = useCallback((b: BatchRow) => {
    setLoader("");
    setExporting(b);
  }, []);
  const loaderName = (people.data ?? []).find((u) => u.id === loader)?.name ?? t("The SAP Basis people");

  const dialog = exporting ? (
    <Dialog
      title={t("Export the load file")}
      description={t("Batch {label}: {records} {records2, plural, one {record goes} other {records go}} out as a Migration Cockpit file. Nothing changes in SAP until the file is loaded, and the export cannot be taken back.", { label: exporting.label, records: int(exporting.records), records2: exporting.records })}
      onClose={() => setExporting(null)}
    >
      <label>
        {t("Who loads it in SAP")}
        <select value={loader} onChange={(e) => setLoader(e.target.value)} disabled={people.isLoading}>
          <option value="">{t("The SAP Basis people")}</option>
          {(people.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      <p className="m2-dlg-d" data-testid="export-loader">{t("{who} gets the file in the inbox, loads it and confirms the load here.", { who: loaderName })}</p>
      <div className="m2-dlg-a">
        <button type="button" className="m2-btn" onClick={() => setExporting(null)}>
          {t("Cancel")}
        </button>
        <button
          type="button"
          className="m2-btn m2-strong"
          onClick={() => {
            const b = exporting;
            setExporting(null);
            void send(b, loader || null);
          }}
        >
          {t("Export load file")}
        </button>
      </div>
    </Dialog>
  ) : blank ? (
    <Dialog title={t("Some records have no new value")} description={blank.sentence} onClose={() => setBlank(null)}>
      <div className="m2-dlg-a">
        <button type="button" className="m2-btn" onClick={() => setBlank(null)}>
          {t("Cancel")}
        </button>
        <button
          type="button"
          className="m2-btn"
          onClick={() => {
            const b = blank.b;
            setBlank(null);
            setBack(b);
          }}
        >
          {t("Send back")}
        </button>
        <button
          type="button"
          className="m2-btn m2-strong"
          onClick={() => {
            const b = blank.b;
            setBlank(null);
            void approve(b, true);
          }}
        >
          {t("Approve the others")}
        </button>
      </div>
    </Dialog>
  ) : back ? (
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

  return { can, busy, approve, send, askSend, askSendBack: setBack, dialog, actions };
}

export type BatchControls = ReturnType<typeof useBatchControls>;

/**
 * The buttons a batch offers this person: Approve and Send back on a draft, Export load file on an approved batch (it
 * asks once, naming who loads the file). With `live` (the deployment writes to SAP itself) the live send is the
 * strong button, so the load file is the plain one.
 */
export function BatchButtons({ b, c, sm = true, live = false }: { b: BatchRow; c: BatchControls; sm?: boolean; live?: boolean }) {
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
      <button type="button" className={`${cls}${live ? "" : " m2-strong"}`} disabled={c.busy !== null || mine} title={mine ? t("You built this batch; a second person sends it.") : undefined} aria-label={t("Export batch {label} as a load file", { label: b.label })} onClick={() => c.askSend(b)}>
        {c.busy === `send:${b.id}` ? t("Exporting…") : t("Export load file")}
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
