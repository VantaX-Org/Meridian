"use client";

/** What every part of the migration analysis shares: the query hook, the status, verdict, mode and gap texts, and the pager. */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import type { FieldDef, MigrationMode } from "@/lib/api/v2/migration";
import type { Delta, DeltaKind } from "@/lib/v2/field-delta";
import { t } from "@/lib/v2/i18n";
import { f1, int } from "@/lib/v2/score";
import { Button, Code, DataTable, Stepper, type DataTableProps, type StepItem } from "../../kit";
import type { Verdict } from "../parts";

export const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
export const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };
export const PAGE = 50;

export const VERDICT: Record<string, Verdict> = { go: "go", conditional: "at-risk", "no-go": "no-go" };
export const VERDICT_TEXT: Record<string, () => string> = {
  go: () => t("Ready to load"),
  conditional: () => t("Ready with conditions"),
  "no-go": () => t("Not ready to load"),
};
// migration_runs.status: queued|running|analysed|exported|failed (db/schema.py). An exported run was analysed first.
export const analysed = (r: { status: string }) => r.status === "analysed" || r.status === "exported";
export const STATUS_TEXT: Record<string, () => string> = {
  queued: () => t("Queued"),
  running: () => t("Running"),
  analysed: () => t("Analysed"),
  exported: () => t("Exported"),
  failed: () => t("Failed"),
};
export const MODE: Record<MigrationMode, () => string> = {
  source_to_destination: () => t("Source to target system"),
  source_to_source: () => t("Source to source"),
  s4_dry_run: () => t("S/4HANA dry run"),
};
const GAP: Record<string, () => string> = {
  unmapped_field: () => t("Field with no mapping"),
  obsolete_target: () => t("Target field no longer exists"),
  target_field_missing: () => t("Target field missing"),
  value_unmapped: () => t("Value with no target value"),
  target_mandatory: () => t("Mandatory target field empty"),
  key_missing: () => t("Key missing"),
  key_collision: () => t("Two records get the same key"),
  target_key_exists: () => t("Key already in the target"),
  length_truncation: () => t("Value longer than the target field"),
  type_conversion: () => t("Type does not convert"),
  precision_loss: () => t("Decimals lost"),
  case_change: () => t("Case changes"),
  domain_value: () => t("Value outside the field's domain"),
  check_table_value: () => t("Value not in the check table"),
  target_config_unverified: () => t("Target configuration not verified"),
};
export const gapText = (g: string) => GAP[g]?.() ?? (g.startsWith("field_status_") ? t("Field status in the target: {kind}", { kind: g.slice(13) }) : g);
/** Severity as the bar and chip tone: critical is bad, high and medium warn, low is plain data. */
export const tone = (sev: string) => (sev === "critical" ? "bad" : sev === "high" || sev === "medium" ? "warn" : "data") as "bad" | "warn" | "data";
export const SEVERITIES = ["critical", "high", "medium", "low"];

export function useMig<T>(key: unknown[], fn: () => Promise<T>, enabled = true, poll: number | false = false) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["migration", ...key, fixture], queryFn: fn, staleTime: 60_000, retry, enabled, refetchInterval: poll });
}

export const DELTA: Record<DeltaKind, (d: Delta) => string> = {
  dropped: () => t("Not carried to the target"),
  unknown: () => t("Definition not in the dictionary"),
  type: (d) => t("Type changes from {a} to {b}", { a: String(d.from), b: String(d.to) }),
  shorter: (d) => t("Shortened from {a} to {b} characters", { a: int(Number(d.from)), b: int(Number(d.to)) }),
  longer: (d) => t("Lengthened from {a} to {b} characters", { a: int(Number(d.from)), b: int(Number(d.to)) }),
  decimals: (d) => t("Decimals change from {a} to {b}", { a: int(Number(d.from)), b: int(Number(d.to)) }),
  check_table: (d) => t("Checked against {b} instead of {a}", { a: d.from ? String(d.from) : t("no table"), b: d.to ? String(d.to) : t("no table") }),
  same: () => t("Same definition"),
};
export const ORIGIN: Record<string, () => string> = {
  identity: () => t("Same field name"),
  sap_standard: () => t("SAP standard conversion"),
  steward: () => t("Set by a steward"),
};
export const defText = (d: FieldDef | null) => d?.type ? [d.type, int(d.length), d.decimals ? t("{n} decimals", { n: int(d.decimals) }) : null, d.check_table].filter(Boolean).join(" ") : f1(null);

/** TABLE.FIELD with its dictionary description beside it. */
export function Field({ name, def }: { name: string | null; def?: FieldDef | null }) {
  if (!name) return <>{f1(null)}</>;
  return <Code code={name} text={def?.description ?? undefined} />;
}

/** Previous and next over a server-paged list of PAGE rows. */
export function Pager({ offset, total, onMove }: { offset: number; total: number; onMove: (n: number) => void }) {
  if (total <= PAGE) return null;
  return (
    <div className="nx-ld-actions">
      <Button variant="secondary" size={32} disabled={offset === 0} onClick={() => onMove(Math.max(0, offset - PAGE))}>{t("Previous")}</Button>
      <span className="nx-ld-meta">{t("{from} to {to} of {n}", { from: int(offset + 1), to: int(Math.min(total, offset + PAGE)), n: int(total) })}</span>
      <Button variant="secondary" size={32} disabled={offset + PAGE >= total} onClick={() => onMove(offset + PAGE)}>{t("Next")}</Button>
    </div>
  );
}

/** A labelled native control: the kit has no select or file input yet. */
export function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return <label className="nx-field"><span>{label}</span>{children}</label>;
}

/** Kit DataTable with a test id around it: the kit table takes none. */
export function Table<R>({ testId, ...p }: DataTableProps<R> & { testId?: string }) {
  return <div data-testid={testId}><DataTable {...p} /></div>;
}

/** Kit Stepper over plain labels: steps before the current one are done. */
export function Steps({ labels, current, label, testId }: { labels: string[]; current: number; label: string; testId?: string }) {
  const steps: StepItem[] = labels.map((l, i) => ({ id: String(i), label: l, state: i < current ? "done" : i === current ? "current" : "future" }));
  return <div data-testid={testId}><Stepper steps={steps} label={label} /></div>;
}

/** A sheet-and-column row as the workbook and template checks report it. */
export interface SheetColumn { sheet: string; id: string; label?: string | null }
export const sheetColumns = (): { id: string; label: string; cell: (r: SheetColumn) => ReactNode }[] => [
  { id: "sheet", label: t("Sheet"), cell: (r) => <span className="nx-ld-lede">{r.sheet}</span> },
  { id: "column", label: t("Column"), cell: (r) => <Code code={r.id} text={r.label ?? undefined} /> },
];
