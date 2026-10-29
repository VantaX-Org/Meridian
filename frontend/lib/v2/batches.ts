/**
 * Fix batches as the interface words them: the pure parts (labels, the row a batch becomes, the trail of its events,
 * and the grouping of ledger rows under their batch). No React and no network, so each can be tested on its own.
 */
import type { BatchEvent } from "@/lib/api/remediation";
import type { BatchRowApi } from "@/lib/api/v2/batches";
import type { WorkRow } from "@/lib/api/v2/types";
import { t } from "@/lib/v2/i18n";
import { whole } from "./format";

export type BatchStatus = "draft" | "approved" | "exported";

/** A draft batch waits for a second person; an approved one is ready for SAP; an exported one has gone. */
export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = { get draft() { return t("Waiting for approval"); }, get approved() { return t("Approved"); }, get exported() { return t("Sent to SAP"); } };

/** "B-1A2B3C" for an id the database made; an id that already reads as a label (B-241) is kept. */
export function batchLabel(id: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? `B-${id.slice(0, 6).toUpperCase()}` : id;
}

export interface Returned {
  by: string | null;
  note: string | null;
  at: string | null;
}

export interface BatchRow {
  id: string;
  label: string;
  name: string;
  status: BatchStatus;
  /** Who built the batch. */
  owner: string | null;
  ownerId: string | null;
  steward: string | null;
  records: number;
  valueAtRisk: number | null;
  dueAt: string | null;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  /** The last time an approver sent it back, with the reason. */
  returned: Returned | null;
}

function returnedOf(b: BatchRowApi): Returned | null {
  const r = (b.filter as unknown as { returned?: { by?: string; note?: string; at?: string } } | null)?.returned;
  return r ? { by: r.by ?? null, note: r.note ?? null, at: r.at ?? null } : null;
}

export function toBatchRow(b: BatchRowApi): BatchRow {
  return {
    id: b.id,
    label: batchLabel(b.id),
    name: b.name,
    status: b.status,
    owner: b.created_by_label ?? null,
    ownerId: b.created_by ?? null,
    steward: b.steward_label ?? null,
    records: b.items,
    valueAtRisk: b.value_at_risk ?? null,
    dueAt: b.due_at ?? null,
    createdAt: b.created_at,
    approvedBy: b.approved_by_label ?? null,
    approvedAt: b.approved_at ?? null,
    sentAt: b.exported_at ?? null,
    returned: returnedOf(b),
  };
}

/** Batches with records in them, newest first. */
export const withRecords = (rows: readonly BatchRow[]): BatchRow[] => rows.filter((b) => b.records > 0).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export interface BatchGroup {
  batch: BatchRow;
  rows: WorkRow[];
}

/**
 * The loaded rows under their batch, in the batch order given. A row that names a batch not in the list, or none, is
 * `loose`: the API does not send `batch_id` on a row yet, and until it does every row is loose.
 */
export function groupByBatch(batches: readonly BatchRow[], rows: readonly WorkRow[]): { groups: BatchGroup[]; loose: WorkRow[] } {
  const known = new Set(batches.map((b) => b.id));
  const groups = batches.map((batch) => ({ batch, rows: rows.filter((r) => r.batch_id === batch.id) }));
  const loose = rows.filter((r) => !r.batch_id || !known.has(r.batch_id));
  return { groups, loose };
}

// The trail ------------------------------------------------------------------------------------------------------

const EVENT_WORD: Record<string, string> = {
  get created() { return t("Drafted"); },
  get proposed() { return t("Values proposed"); },
  get accepted() { return t("Suggestions accepted"); },
  get approved() { return t("Approved"); },
  get sent_back() { return t("Sent back"); },
  get exported() { return t("Sent to SAP"); },
  get reconciled() { return t("Checked against the next run"); },
};

/** An event of GET /remediation/batches/{id}/events; the action is a free word (the API also writes sent_back). */
export type TrailEvent = Omit<BatchEvent, "action"> & { action: string };

export interface TrailEntry {
  key: string;
  action: string;
  /** "Approved", "Sent back". */
  word: string;
  user: string | null;
  at: string;
  /** Records the step covered (one event is written per record). */
  records: number;
  /** The reason, for a send-back. */
  note: string | null;
}

/**
 * The approval trail: the API writes one event per record, so consecutive events of one action by one person are one
 * step ("Approved by T. Mokoena, 328 records"). A send-back carries its reason in `to_value`.
 */
export function trailOf(events: readonly TrailEvent[]): TrailEntry[] {
  const sorted = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const out: TrailEntry[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    const perRecord = e.item_id != null && e.action !== "sent_back";
    if (last && last.action === e.action && last.user === (e.user_label ?? null) && perRecord) {
      last.records += 1;
      last.at = e.created_at;
      continue;
    }
    out.push({
      key: `${e.action}:${e.created_at}:${out.length}`,
      action: e.action,
      word: EVENT_WORD[e.action] ?? e.action.replace(/_/g, " "),
      user: e.user_label ?? null,
      at: e.created_at,
      records: perRecord ? 1 : 0,
      note: e.action === "sent_back" ? e.to_value : null,
    });
  }
  return out;
}

const n = (x: number): string => whole(x);

/** "Sent to SAP, 96 records, 9 Oct", the line of a batch that has gone. */
export function sentLine(b: Pick<BatchRow, "records" | "sentAt">, date: (iso: string | null) => string): string {
  return t("Sent to SAP, {n} {records, plural, one {record} other {records}}, {date}", { n: n(b.records), records: b.records, date: date(b.sentAt) });
}

/** Why a person cannot approve or send back a batch, or null when they can. */
export function approveBlock(b: Pick<BatchRow, "status" | "ownerId">, can: { approve: boolean }, me: string | null): string | null {
  if (!can.approve) return t("Your role cannot approve.");
  if (b.status !== "draft") return t("This batch is already {value}.", { value: b.status === "approved" ? t("approved") : t("sent to SAP") });
  if (b.ownerId && me && b.ownerId === me) return t("You built this batch; a second person approves it.");
  return null;
}
