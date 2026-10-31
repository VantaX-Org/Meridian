"use client";

import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { WorkRow } from "@/lib/api/v2/types";
import type { DecideKind, RowRef } from "@/lib/v2/work-actions";
import { initials, possibleValues, splitKey } from "@/lib/v2/work";
import { MenuButton } from "../Menu";
import { Coded, Dash, Mono } from "../parts";
import { recordsByModule } from "@/lib/v2/step9";
import { moduleText } from "@/lib/v2/labels";
import { SimulateDialog } from "./step9/Simulation";
import { t } from "@/lib/v2/i18n";
import { alphaOut } from "@/lib/v2/format";

/** What the cells and the bulk bar call. The ledger supplies them; they are read when an event fires, never while drawing. */
export interface LedgerHandlers {
  can: { apply: boolean; approve: boolean; assign: boolean };
  /** The text typed in New value cells and not yet committed, so a row scrolled out of the window keeps it. */
  drafts: Map<string, string>;
  commit(row: WorkRow, value: string): void;
  decide(rows: readonly RowRef[], kind: DecideKind): void;
  assign(rows: readonly RowRef[], assignee: string): void;
  setValueFor(rows: readonly RowRef[], value: string): Promise<boolean>;
  fillDown(from: WorkRow, value: string): void;
  paste(from: WorkRow, lines: string[]): void;
  /** Initials for a row's owner, "you" included. */
  owner(row: WorkRow): string | null;
}

export const rowKeyOf = (r: Pick<WorkRow, "module" | "record_key">) => `${r.module}|${r.record_key}`;

/** The first key part's value ("000000000000000101"), leading zeros kept. */
export function keyValue(row: Pick<WorkRow, "record_key">, index: number): string | null {
  return splitKey(row.record_key)[index]?.value ?? null;
}

/** A record key as SAP shows it (ALPHA conversion), the full key in the title and in what is copied. */
export function KeyText({ value }: { value: string }) {
  const shown = alphaOut(value);
  return (
    <span className="m2-mono" title={shown === value ? undefined : value} data-key={value}>
      {shown}
    </span>
  );
}

export function PossibleValuesCell({ row }: { row: WorkRow }) {
  const pv = possibleValues(row);
  if (!pv) return <Dash why={t("The rule does not list values")} />;
  return (
    <span className="m2-pvl" title={pv.full}>
      <span className="m2-pvt m2-mono">{pv.text}</span>
      {pv.more > 0 ? <span className="m2-pvm">{t("+{more} more", { more: pv.more })}</span> : null}
    </span>
  );
}

export function CurrentValue({ value, label }: { value: string | null | undefined; label?: string | null }) {
  if (value === undefined) return <Dash why={t("The current value is not in the list yet")} />;
  if (value === null || value === "") return <Dash why={t("Blank in SAP")} />;
  return <Coded code={value} text={label} first />;
}

/** New value: an input in the cell. Enter commits through the API; Escape puts the stored value back. */
export function NewValueCell({ row, h }: { row: WorkRow; h: LedgerHandlers }) {
  const key = rowKeyOf(row);
  const committed = row.new_value ?? "";
  // What was typed and not yet saved; null shows the stored value. Kept in `drafts` too, so a row scrolled out of the window keeps it.
  const [draft, setDraft] = useState<string | null>(() => h.drafts.get(key) ?? null);
  const value = draft ?? committed;
  const label = t("New value for {keyValue}", { keyValue: keyValue(row, 0) ?? row.record_key });
  if (!h.can.apply) return value ? <Mono>{value}</Mono> : <Dash why={t("Read-only for your role")} />;
  const dirty = draft !== null && draft !== committed;
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (value.trim()) {
        setDraft(null);
        h.commit(row, value.trim());
      }
    } else if (e.key === "Escape") {
      h.drafts.delete(key);
      setDraft(null);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      if (value.trim()) h.fillDown(row, value.trim());
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    const lines = text.replace(/\r/g, "").split("\n");
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    if (lines.length < 2) return;
    e.preventDefault();
    h.paste(row, lines.map((l) => l.trim()));
  };
  return (
    <span className="m2-nv" data-dirty={dirty ? "true" : undefined}>
      {dirty ? <span className="m2-edot" title={t("Not saved yet: press Enter")} aria-hidden="true" /> : null}
      <input
        type="text"
        className="m2-inp m2-mono"
        aria-label={label}
        placeholder={t("Enter")}
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          h.drafts.set(key, e.target.value);
          setDraft(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
    </span>
  );
}

const DECISIONS: { value: string; label: string }[] = [
  { value: "fix", get label() { return t("fix"); } },
  { value: "not an issue", get label() { return t("not an issue"); } },
  { value: "accept risk", get label() { return t("accept risk"); } },
];

export function decisionOf(row: Pick<WorkRow, "status" | "resolution">): string {
  // i18n-ignore: these are the select's values, not its words (DECISIONS carries the words)
  if (row.status === "not_an_issue") return row.resolution === "accepted_risk" ? "accept risk" : "not an issue";
  return row.status === "to_fix" ? "" : "fix";
}

/** Decision: fix, not an issue or accept risk. The last two ask for a reason first. */
export function DecisionCell({ row, h, onChoose }: { row: WorkRow; h: LedgerHandlers; onChoose: (row: WorkRow, choice: string) => void }) {
  const value = decisionOf(row);
  const label = t("Decision for {keyValue}", { keyValue: keyValue(row, 0) ?? row.record_key });
  const allowed = (v: string) => (v === "fix" ? h.can.apply : h.can.approve);
  if (!h.can.apply && !h.can.approve) return <span>{DECISIONS.find((d) => d.value === value)?.label || "—"}</span>;
  return (
    <select className="m2-sel" aria-label={label} value={value} onChange={(e) => e.target.value && onChoose(row, e.target.value)}>
      {value === "" ? <option value="">{t("Decide")}</option> : null}
      {DECISIONS.map((d) => (
        <option key={d.value} value={d.value} disabled={!allowed(d.value)}>
          {d.label}
        </option>
      ))}
    </select>
  );
}

export function OwnerCell({ row, h }: { row: WorkRow; h: LedgerHandlers }) {
  const o = h.owner(row);
  return o ? <span title={row.assignee_email ?? undefined}>{o}</span> : <Dash why={t("Unassigned")} />;
}

export const ownerInitials = (row: Pick<WorkRow, "assignee_email">): string | null => initials(row.assignee_email);

// Dialogs -------------------------------------------------------------------------------------------------------

const FOCUSABLE = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])";

/** A small modal: a title, one field, Cancel and the confirming button. Esc cancels, Tab stays inside. */
export function PromptDialog({
  title,
  label,
  confirm,
  multiline,
  initial = "",
  description,
  onConfirm,
  onCancel,
}: {
  title: string;
  label: string;
  confirm: string;
  multiline?: boolean;
  initial?: string;
  description?: ReactNode;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const id = useId();
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    field.current?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);
  const ok = value.trim().length > 0;
  const submit = () => ok && onConfirm(value.trim());
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === "Tab" && root.current) {
      const els = Array.from(root.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  return (
    <div onKeyDown={onKeyDown}>
      <div className="m2-scrim" onClick={onCancel} aria-hidden="true" />
      <div ref={root} className="m2-pal m2-dlg" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} data-testid="prompt-dialog">
        <h2 id={`${id}-t`}>{title}</h2>
        {description ? <p className="m2-dlg-d">{description}</p> : null}
        <label htmlFor={`${id}-f`}>{label}</label>
        {multiline ? (
          <textarea id={`${id}-f`} ref={field} rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
        ) : (
          <input
            id={`${id}-f`}
            ref={field}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        )}
        <div className="m2-dlg-a">
          <button type="button" className="m2-btn" onClick={onCancel}>
            {t("Cancel")}
          </button>
          <button type="button" className="m2-btn m2-strong" disabled={!ok} onClick={submit}>
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

// Bulk bar ------------------------------------------------------------------------------------------------------

/** The actions of the bulk bar: they act on the rows selected, and clear the selection when they succeed. */
/** "Simulate fixing" for the selected rows: one object at a time, the one with the most rows selected. Read-only. */
function SimulateSelected({ rows }: { rows: WorkRow[] }) {
  const [open, setOpen] = useState(false);
  const groups = recordsByModule(rows);
  const first = groups[0];
  if (!first) return null;
  const label = moduleText(first.module);
  return (
    <>
      <button type="button" className="m2-btn m2-sm" onClick={() => setOpen(true)} title={groups.length > 1 ? t("Simulates the {count} rows of {label}: a simulation rescores one object at a time", { count: first.records.length, label }) : undefined}>
        {t("Simulate fixing")}
      </button>
      {/* The bulk bar is drawn in the inverse colours: the dialog goes to the canvas root so it reads in the page's own. */}
      {open ? createPortal(<SimulateDialog module={first.module} label={label} records={first.records} onClose={() => setOpen(false)} />, document.querySelector(".m2-root") ?? document.body) : null}
    </>
  );
}

export function BulkActions({ rows, clear, h, onReason }: { rows: WorkRow[]; clear: () => void; h: LedgerHandlers; onReason: (rows: WorkRow[], kind: "not_an_issue" | "accept_risk", clear: () => void) => void }) {
  const [setting, setSetting] = useState(false);
  const [value, setValue] = useState("");
  if (!h.can.apply && !h.can.approve && !h.can.assign) return <span className="m2-meta">{t("Read-only for your role")}</span>;
  const apply = async () => {
    if (!value.trim()) return;
    if (await h.setValueFor(rows, value.trim())) {
      setSetting(false);
      setValue("");
      clear();
    }
  };
  return (
    <>
      <SimulateSelected rows={rows} />
      {h.can.apply ? (
        <button type="button" className="m2-btn m2-sm" onClick={() => { h.decide(rows, "accept"); clear(); }}>
          {t("Accept suggested")}{" "}<kbd className="m2-kb">a</kbd>
        </button>
      ) : null}
      {h.can.apply ? (
        setting ? (
          <>
            <input
              className="m2-inp m2-mono m2-inp-bulk"
              aria-label={t("Value for all selected rows")}
              placeholder={t("Value for all")}
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void apply();
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setSetting(false);
                }
              }}
            />
            <button type="button" className="m2-btn m2-sm" onClick={() => void apply()}>
              {t("Apply")}
            </button>
          </>
        ) : (
          <button type="button" className="m2-btn m2-sm" onClick={() => setSetting(true)}>
            {t("Set value for all…")}
          </button>
        )
      ) : null}
      {h.can.approve ? (
        <>
          <button type="button" className="m2-btn m2-sm" onClick={() => onReason(rows, "not_an_issue", clear)}>
            {t("Not an issue")}{" "}<kbd className="m2-kb">n</kbd>
          </button>
          <button type="button" className="m2-btn m2-sm" onClick={() => onReason(rows, "accept_risk", clear)}>
            {t("Accept risk")}{" "}<kbd className="m2-kb">r</kbd>
          </button>
        </>
      ) : null}
      {h.can.assign ? (
        <MenuButton
          label={t("Assign")}
          buttonLabel={t("Assign…")}
          className="m2-btn m2-sm"
          entries={[
            { kind: "item", id: "me", label: t("Assign to me"), onSelect: () => { h.assign(rows, "me"); clear(); } },
            { kind: "item", id: "none", label: t("Unassign"), onSelect: () => { h.assign(rows, ""); clear(); } },
          ]}
        >
          {t("Assign…")}
        </MenuButton>
      ) : null}
    </>
  );
}
