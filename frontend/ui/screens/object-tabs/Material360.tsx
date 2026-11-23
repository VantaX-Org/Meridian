"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getDuplicates, getMaterial, getMaterialFindings, getSupersession, type CellState, type FailingRule, type Material360 as M360 } from "@/lib/api/v2/materials";
import { t } from "@/lib/v2/i18n";
import { describeField } from "@/lib/v2/sap-fields";
import { Card, DataTable, EmptyState, ErrorState, FieldChip, Skeleton, StatTile, SeverityPill } from "@/ui/kit";
import type { Severity } from "@/ui/kit/SeverityStrip";
import { sevLabel } from "./Records";

const statusOf = (e: unknown): number | undefined => (e as { status?: number; response?: { status?: number } } | null)?.status ?? (e as { response?: { status?: number } } | null)?.response?.status;
const retry = (n: number, e: unknown) => ![403, 404, 409].includes(statusOf(e) ?? 0) && n < 2;

/** The follow-up and BOM flags the supersession route raises (api/routes/materials.py), each with its text. */
export const FLAG_TEXT: Record<string, () => string> = {
  MM544: () => t("Follow-up material is not in the same plant"),
  MM545: () => t("Follow-up material does not exist"),
  MM546: () => t("Follow-up material is flagged for deletion"),
  MM547: () => t("Follow-up material is flagged for deletion in the plant"),
  MM548: () => t("Follow-up material is blocked by its plant status"),
  MM549: () => t("Follow-up material has MRP type ND, so it is not planned"),
  MM550: () => t("Discontinued with no successor"),
  MM551: () => t("Follow-up materials form a loop"),
  MM552: () => t("Follow-up chain is longer than three links"),
  MM560: () => t("Discontinued part in an active BOM with no discontinuation group"),
  MM563: () => t("Follow-up item has no discontinuation group"),
};
const flagText = (f: string) => FLAG_TEXT[f]?.();

/** "plant:1000" reads "Plant 1000"; "client" reads "Client". */
export function levelText(id: string): string {
  const [kind, rest] = id.split(":");
  const k: Record<string, string> = { client: t("Client"), plant: t("Plant"), sales: t("Sales area"), valuation: t("Valuation area"), sloc: t("Storage location"), warehouse: t("Warehouse") };
  return rest ? `${k[kind] ?? kind} ${rest}` : (k[kind] ?? kind);
}

/** A cell that exists but carries a failing rule on the same view and level reads "failing". Pure, so it has a test. */
export function cellState(state: CellState, view: string, level: string, failing: Map<string, FailingRule[]>): CellState | "failing" {
  return state === "ok" && failing.get(`${view}|${level}`)?.length ? "failing" : state;
}

const CELL: Record<CellState | "failing", () => string> = {
  ok: () => t("Complete"), failing: () => t("Failing"), missing: () => t("Missing"), na: () => t("Not needed"), none: () => "",
};
const CELL_SEV: Partial<Record<CellState | "failing", Severity>> = { ok: "low", failing: "high", missing: "critical" };

function errorText(e: unknown): string {
  const s = statusOf(e);
  return s === 404 ? t("This material is not in the material master.") : s === 409 ? t("No run has data for this system yet.") : s === 403 ? t("Your role cannot read material records.") : t("The material could not be loaded.");
}

/** Material 360: every view of one material at every org level, the rules failing by view, its follow-up chain and look-alikes. */
export function Material360({ matnr }: { matnr: string }) {
  const fx = useFixture();
  const mat = useQuery({ queryKey: ["m360", fx, matnr], queryFn: () => getMaterial(matnr), retry });
  const fin = useQuery({ queryKey: ["m360", "findings", fx, matnr], queryFn: () => getMaterialFindings(matnr), retry, enabled: mat.isSuccess });
  const sup = useQuery({ queryKey: ["m360", "supersession", fx, matnr], queryFn: () => getSupersession(matnr), retry, enabled: mat.isSuccess });
  const dup = useQuery({ queryKey: ["m360", "duplicates", fx, matnr], queryFn: () => getDuplicates(matnr), retry, enabled: mat.isSuccess });

  if (mat.isLoading) return <Skeleton lines={6} label={t("Loading material")} />;
  if (mat.isError) return <ErrorState heading={errorText(mat.error)} retryLabel={t("Try again")} onRetry={() => void mat.refetch()} />;
  const m = mat.data as M360;

  const failing = new Map<string, FailingRule[]>();
  for (const v of fin.data?.by_view ?? []) for (const r of v.failing) failing.set(`${v.view}|${r.level}`, [...(failing.get(`${v.view}|${r.level}`) ?? []), r]);
  const rulesFailing = new Set((fin.data?.by_view ?? []).flatMap((v) => v.failing.map((r) => r.check_id))).size;
  const missing = m.views.reduce((n, v) => n + v.cells.filter((c) => c.state === "missing").length, 0);
  const failRows = (fin.data?.by_view ?? []).flatMap((v) => v.failing.map((r) => ({ ...r, view: v.label })));
  const chains = sup.data?.plants ?? [];
  const boms = sup.data?.bom_usage ?? [];
  const dups = dup.data?.items ?? [];

  return (
    <div className="mx-col" data-testid="material-360">
      <dl className="mx-tiles">
        <StatTile label={t("Rules failing")} value={String(rulesFailing)} note={fin.data ? t("of {n} rules", { n: fin.data.rules_total }) : undefined} />
        <StatTile label={t("Views missing")} value={String(missing)} note={t("across {n} org levels", { n: m.levels_total })} />
        <StatTile label={t("Plants phasing out")} value={String(m.phasing.phasing_out)} note={t("of {n} plants", { n: m.phasing.plants })} />
      </dl>

      <Card title={t("Views by level")} sub={m.expected_known ? t("Each view the material type needs, at each org level") : t("The material type's expected views are not configured, so every view is shown")}>
        <DataTable label={t("Views by level")} rows={m.views} rowKey={(v) => v.view} height={Math.min(420, 60 + 40 * m.views.length)} columns={[
          { key: "view", label: t("View"), render: (v) => v.label },
          ...m.levels.map((l) => ({
            key: l.id, label: levelText(l.id), render: (v: M360["views"][number]) => {
              const st = cellState(v.cells.find((c) => c.level === l.id)?.state ?? "none", v.view, l.id, failing);
              const sev = CELL_SEV[st];
              return sev ? <SeverityPill sev={sev} label={CELL[st]()} /> : CELL[st]();
            },
          })),
        ]} />
      </Card>

      <Card title={t("Rules failing by view")} sub={t("The rule, the field and the value it found")}>
        {fin.isLoading ? <Skeleton lines={3} label={t("Loading findings")} /> : failRows.length ? (
          <DataTable label={t("Rules failing by view")} rows={failRows} rowKey={(r) => `${r.check_id}${r.level}${r.field ?? ""}`} height={Math.min(360, 60 + 44 * failRows.length)} columns={[
            { key: "view", label: t("View"), render: (r) => r.view },
            { key: "rule", label: t("Rule"), render: (r) => <FieldChip code={r.check_id} description={r.message ?? undefined} /> },
            { key: "sev", label: t("Severity"), render: (r) => <SeverityPill sev={r.severity as Severity} label={sevLabel(r.severity)} /> },
            { key: "level", label: t("Level"), render: (r) => levelText(r.level) },
            { key: "field", label: t("Field"), render: (r) => r.field ? <FieldChip code={r.field} description={m.labels[r.field] ?? describeField(r.field, null) ?? undefined} /> : null },
            { key: "now", label: t("Current value"), render: (r) => r.actual_value ?? t("empty") },
          ]} />
        ) : <EmptyState heading={t("No rule fails on this material.")} body={t("This material passes every rule in this run. Open another material to continue.")} />}
      </Card>

      <Card title={t("Follow-up chain")} sub={t("The successor of this material in each plant where it is discontinued")}>
        {chains.length ? chains.map((p) => (
          <section key={p.werks}>
            <h3 className="mx-card-t">{t("Plant {werks}", { werks: p.werks })}{p.ausdt ? t(", runs out {date}", { date: p.ausdt }) : ""}</h3>
            <DataTable label={t("Follow-up chain in plant {werks}", { werks: p.werks })} rows={p.chain} rowKey={(c) => c.matnr} height={Math.min(280, 60 + 40 * p.chain.length)} columns={[
              { key: "m", label: t("Material"), render: (c) => <FieldChip code={c.matnr} description={c.maktx ?? undefined} /> },
              { key: "d", label: t("MRP type"), render: (c) => c.dismm ? <code className="mx-code">{c.dismm}</code> : null },
              { key: "a", label: t("Runs out"), render: (c) => c.ausdt ?? "" },
              { key: "f", label: t("Flags"), render: (c) => c.flags.map((f) => <FieldChip key={f} code={f} description={flagText(f)} />) },
            ]} />
          </section>
        )) : <EmptyState heading={t("This material is not discontinued in any plant.")} body={t("Nothing to review here. Open another material to continue.")} />}
        {boms.length ? (
          <DataTable label={t("Bills of material that use it")} rows={boms} rowKey={(b) => `${b.stlnr}${b.posnr}${b.werks}`} height={Math.min(280, 60 + 40 * boms.length)} columns={[
            { key: "s", label: t("BOM"), render: (b) => b.stlnr ?? "" },
            { key: "p", label: t("Item"), render: (b) => b.posnr ?? "" },
            { key: "w", label: t("Plant"), render: (b) => b.werks ?? "" },
            { key: "g", label: t("Discontinuation group"), render: (b) => b.nfgrp ?? t("none") },
            { key: "f", label: t("Flags"), render: (b) => b.flags.map((f) => <FieldChip key={f} code={f} description={flagText(f)} />) },
          ]} />
        ) : null}
      </Card>

      <Card title={t("Materials that look like it")} sub={dup.data ? t("Matched at {n} % or more", { n: dup.data.threshold }) : undefined}>
        {dups.length ? (
          <DataTable label={t("Materials that look like it")} rows={dups} rowKey={(d) => d.matnr} height={Math.min(320, 60 + 40 * dups.length)} columns={[
            { key: "m", label: t("Material"), render: (d) => <FieldChip code={d.matnr} description={d.maktx ?? undefined} /> },
            { key: "t", label: t("Material type"), render: (d) => d.mtart ? <code className="mx-code">{d.mtart}</code> : null },
            { key: "g", label: t("Material group"), render: (d) => d.matkl ? <code className="mx-code">{d.matkl}</code> : null },
            { key: "on", label: t("Matches on"), render: (d) => d.matches_on.join(", ") },
            { key: "s", label: t("Score"), render: (d) => String(d.score), sort: (d) => d.score, align: "end" },
          ]} />
        ) : <EmptyState heading={t("No other material looks like this one.")} body={t("Similar materials appear here when matching finds a close description.")} />}
      </Card>
    </div>
  );
}
