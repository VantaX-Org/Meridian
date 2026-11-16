"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  getDuplicates, getMaterial, getMaterialFindings, getSupersession,
  type CellState, type ChainNode, type Duplicates, type FailingRule, type MaterialFindings, type Supersession,
} from "@/lib/api/v2/materials";
import { getWork } from "@/lib/api/v2/work";
import type { WorkPage } from "@/lib/api/v2/types";
import { formatDate } from "@/lib/format";
import { useUrlParam } from "@/lib/v2/hooks";
import { splitKey } from "@/lib/v2/work";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { Button, Chip, Code, DataTable, EmptyState, ErrorState, Skeleton, type Column } from "../kit";
import { ExportTable } from "./ExportTable";
import { SegBar } from "../kit/viz/SegBar";
import { About, Banner, Fold, HBars, Panel } from "./cfg-parts";

/**
 * Material 360: one material across every view and organisational level, the rules it fails in each view, its
 * follow-up chain per plant with the bills of material that still use it, and the materials that look like it. The
 * matrix marks a cell failing when a failing rule sits on that view and level; the route leaves that to the client.
 */

const DASH = "—";

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && s !== 409 && n < 2; };

const TONE = { critical: "bad", high: "bad", medium: "warn", low: "neutral", info: "neutral" } as const;
const SEVERITY: Record<string, () => string> = { critical: () => t("Critical"), high: () => t("High"), medium: () => t("Medium"), low: () => t("Low"), info: () => t("Info") };

function Sev({ severity }: { severity: string | null | undefined }) {
  if (!severity) return <>{DASH}</>;
  return <Chip tone={TONE[severity as keyof typeof TONE] ?? "neutral"}>{SEVERITY[severity]?.() ?? severity}</Chip>;
}

const VIEW_TEXT: Record<string, () => string> = {
  basic_data: () => t("Basic data"),
  classification: () => t("Classification"),
  sales: () => t("Sales"),
  purchasing: () => t("Purchasing"),
  mrp: () => t("MRP"),
  work_scheduling: () => t("Work scheduling"),
  storage: () => t("Storage"),
  quality: () => t("Quality"),
  accounting: () => t("Accounting"),
};
const viewText = (view: string, label: string) => VIEW_TEXT[view]?.() ?? label;

/** What each chain and BOM flag means (checks/rules/ecc/material_master.yaml). */
const FLAG_TEXT: Record<string, () => string> = {
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

function levelText(id: string): string {
  const [kind, key = ""] = id.split(":");
  if (kind === "client") return t("Client");
  if (kind === "plant") return t("Plant {k}", { k: key });
  if (kind === "sales") return t("Sales area {k}", { k: key });
  if (kind === "valuation") return t("Valuation {k}", { k: key });
  if (kind === "sloc") return t("Storage location {k}", { k: key });
  if (kind === "warehouse") return t("Warehouse {k}", { k: key });
  return id;
}

const CELL: Record<CellState | "failing", { band: string; text: () => string }> = {
  ok: { band: "0", text: () => t("Maintained") },
  failing: { band: "2", text: () => t("Failing") },
  missing: { band: "3", text: () => t("Missing") },
  na: { band: "na", text: () => t("Not needed") },
  none: { band: "na", text: () => "" },
};

const ERR: Record<number, () => string> = {
  404: () => t("This material is not in the material master."),
  409: () => t("No run has data for this system yet."),
  403: () => t("Your role cannot read material records."),
};

export function Materials() {
  const [m, setM] = useUrlParam<string>("m", "");
  const [draft, setDraft] = useState(m);
  const submit = (e: FormEvent) => { e.preventDefault(); setM(draft.trim()); };
  return (
    <div className="nx-body" data-testid="materials-page">
      <About
        shows={t("Gathers one material across its views, plants, rule findings and follow-up chain.")}
        next={{ href: "/issues?module=material-master", label: t("Open the issues") }}
        why={t("This screen only reads. Nothing in SAP is changed.")}
        means={[
          [t("Rules failing"), t("Rules this material fails, out of all rules that apply to it.")],
          [t("Views missing"), t("Material views that are not maintained at the levels expected.")],
          [t("Plants phasing out"), t("Plants where the material is being phased out.")],
        ]}
      />
      <form className="nx-mat-search" onSubmit={submit} aria-label={t("Find a material")} data-testid="material-search">
        <label className="nx-field">
          {t("Material number")}
          <input className="nx-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("For example 10004711")} />
        </label>
        <Button type="submit" disabled={!draft.trim()}>{t("Open material")}</Button>
      </form>
      {m ? <MaterialBody m={m} /> : (
        <>
          <EmptyState heading={t("Material 360")}>{t("Type a material number to see it across every view, plant and level.")}</EmptyState>
          <WorstMaterials onPick={(k) => { setDraft(k); setM(k); }} />
        </>
      )}
    </div>
  );
}

type WorkItem = WorkPage["items"][number];

/** The materials with the most serious open findings, so the screen has somewhere to start before a number is typed. */
function WorstMaterials({ onPick }: { onPick: (key: string) => void }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["material-worst", fixture], queryFn: () => getWork({ module: "material_master", sort: "-severity,-value", limit: 12 }), retry: false });
  const title = t("Materials with the most serious open findings");
  // The work key is MATNR=...|WERKS=...; the material number is its MATNR part.
  const matnrOf = (r: WorkItem) => splitKey(r.record_key).find((k) => k.field === "MATNR")?.value ?? r.record_key;
  const cols: Column<WorkItem>[] = [
    {
      id: "material", label: t("Material"),
      cell: (r) => (
        <span data-testid={`material-pick-${r.record_key}`}>
          <Code code={r.record_key} text={r.name ?? undefined} />
        </span>
      ),
    },
    { id: "severity", label: t("Severity"), cell: (r) => <Sev severity={r.severity} /> },
    { id: "issues", label: t("Open issues"), align: "end", cell: (r) => int(r.issues), compare: (a, b) => a.issues - b.issues },
    { id: "top", label: t("Top issue"), cell: (r) => (r.top_field ? <Code code={r.top_field} text={r.top_message ?? undefined} /> : r.top_message ?? DASH) },
  ];
  return (
    <Panel title={title} meta={q.data ? t("{n} open", { n: int(q.data.total) }) : undefined} testId="material-worst">
      {q.isPending ? <Skeleton lines={4} label={title} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data.items.length === 0 ? (
        <EmptyState heading={t("No material has an open finding.")} />
      ) : (
        <DataTable rows={q.data.items} columns={cols} rowKey={(r) => r.record_key} rowLabel={(r) => r.record_key} caption={title} total={q.data.total} onOpenRow={(r) => onPick(matnrOf(r))} />
      )}
    </Panel>
  );
}

function MaterialBody({ m }: { m: string }) {
  const fixture = useFixture();
  const opts = { staleTime: 60_000, retry };
  const mat = useQuery({ queryKey: ["material", fixture, m], queryFn: () => getMaterial(m), ...opts });
  const found = mat.isSuccess;
  const fin = useQuery({ queryKey: ["material-findings", fixture, m], queryFn: () => getMaterialFindings(m), enabled: found, ...opts });
  const sup = useQuery({ queryKey: ["material-supersession", fixture, m], queryFn: () => getSupersession(m), enabled: found, ...opts });
  const dup = useQuery({ queryKey: ["material-duplicates", fixture, m], queryFn: () => getDuplicates(m), enabled: found, ...opts });

  if (mat.isPending) return <Skeleton lines={8} label={t("Material 360")} />;
  if (mat.isError) {
    const why = ERR[status(mat.error) ?? 0];
    return why ? <EmptyState heading={t("Material 360")}><span data-testid="material-error">{why()}</span></EmptyState> : <ErrorState sentence={t("The material could not be read.")} onRetry={() => void mat.refetch()} />;
  }
  const d = mat.data;
  const failing = fin.data?.by_view.flatMap((v) => v.failing) ?? [];
  const failingAt = new Set(fin.data?.by_view.flatMap((v) => v.failing.map((f) => `${v.view}|${f.level}`)) ?? []);
  const stateOf = (view: string, c: { level: string; state: CellState }): CellState | "failing" =>
    c.state === "ok" && failingAt.has(`${view}|${c.level}`) ? "failing" : c.state;
  const states = d.views.flatMap((v) => v.cells.map((c) => stateOf(v.view, c)));
  const count = (s: CellState | "failing") => states.filter((x) => x === s).length;
  const missing = count("missing");
  const mara = d.mara as Record<string, string | undefined>;

  return (
    <>
      <Banner
        testId="material-banner"
        label={t("Material 360")}
        meta={t("Material 360")}
        title={d.description ?? d.matnr}
        why={t("{type}, {group}, base unit {unit}", { type: d.labels.MTART ?? mara.MTART ?? "", group: d.labels.MATKL ?? mara.MATKL ?? "", unit: d.labels.MEINS ?? mara.MEINS ?? "" })}
        figs={[
          { label: t("Material"), value: d.matnr },
          { label: t("Rules failing"), value: fin.data ? int(failing.length) : DASH, note: fin.data ? t("of {n} rules", { n: int(fin.data.rules_total) }) : undefined },
          { label: t("Views missing"), value: int(missing), note: t("across {n} levels", { n: int(d.levels_total) }) },
          { label: t("Plants phasing out"), value: int(d.phasing.phasing_out), note: t("of {n} plants", { n: int(d.phasing.plants) }) },
        ]}
      />

      <Panel title={t("Views by level")} testId="material-matrix">
        <SegBar
          testid="material-matrix-mix"
          format={int}
          segs={[
            { key: "ok", label: CELL.ok.text(), value: count("ok"), tone: "good" },
            { key: "failing", label: CELL.failing.text(), value: count("failing"), tone: "warn" },
            { key: "missing", label: CELL.missing.text(), value: missing, tone: "bad" },
          ]}
        />
        {d.levels_total > d.levels.length ? <p className="nx-sub">{t("Showing the first {n} of {total} levels.", { n: int(d.levels.length), total: int(d.levels_total) })}</p> : null}
        <ExportTable><div className="nx-table-scroll">
          <table className="nx-table nx-mat-matrix">
            <caption className="nx-sr">{t("Views by level")}</caption>
            <thead>
              <tr>
                <th scope="col" className="nx-th">{t("View")}</th>
                {d.levels.map((l) => <th key={l.id} scope="col" className="nx-th">{levelText(l.id)}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.views.map((v) => (
                <tr key={v.view} className="nx-tr">
                  <th scope="row" className="nx-td">
                    {viewText(v.view, v.label)}
                    {d.expected_known && v.expected === false ? <span className="nx-sub"> {t("Not expected for this type")}</span> : null}
                  </th>
                  {v.cells.map((c) => {
                    const s = stateOf(v.view, c);
                    return <td key={c.level} className="nx-td nx-mat-cell" data-band={CELL[s].band}>{CELL[s].text()}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div></ExportTable>
      </Panel>

      <Panel title={t("Rules failing, by view")} meta={fin.data ? t("{n} failing", { n: int(failing.length) }) : undefined} testId="material-findings">
        {fin.isError ? <p className="nx-sub">{t("The findings could not be read.")}</p> : !fin.data ? <Skeleton lines={4} label={t("Rules failing, by view")} /> : <Findings f={fin.data} />}
      </Panel>

      <Fold title={t("Follow-up chain")} hint={t("Which material replaces this one, plant by plant.")}>
        <Panel title={t("Follow-up chain")} meta={t("{n} plants phasing out", { n: int(d.phasing.phasing_out) })} testId="material-chain">
          {sup.isError ? <p className="nx-sub">{t("The follow-up chain could not be read.")}</p> : !sup.data ? <Skeleton lines={4} label={t("Follow-up chain")} /> : <Chain s={sup.data} />}
        </Panel>
      </Fold>

      <Fold title={t("Materials that look like it")} hint={t("Possible duplicates of this material.")}>
        <Panel title={t("Materials that look like it")} meta={dup.data ? t("Match score {n} and up", { n: int(dup.data.threshold) }) : undefined} testId="material-duplicates">
          {dup.isError ? <p className="nx-sub">{t("The likely duplicates could not be read.")}</p> : !dup.data ? <Skeleton lines={3} label={t("Materials that look like it")} /> : dup.data.items.length === 0 ? (
            <p className="nx-sub">{t("No other material looks like this one.")}</p>
          ) : <DupTable items={dup.data.items} />}
        </Panel>
      </Fold>
    </>
  );
}

type Failing = FailingRule & { view: string; viewLabel: string };

function Findings({ f }: { f: MaterialFindings }) {
  const views = [...f.by_view].sort((a, b) => b.failing.length - a.failing.length);
  if (views.every((v) => v.failing.length === 0)) return <p className="nx-sub">{t("Every rule that ran on this material passes.")}</p>;
  const rows: Failing[] = views.flatMap((v) => v.failing.map((r) => ({ ...r, view: v.view, viewLabel: v.label })));
  const cols: Column<Failing>[] = [
    { id: "rule", label: t("Rule"), cell: (r) => <Link href={`/r/${encodeURIComponent(r.check_id)}`}><Code code={r.check_id} text={r.message ?? undefined} /></Link> },
    { id: "view", label: t("View"), cell: (r) => viewText(r.view, r.viewLabel) },
    { id: "level", label: t("Level"), cell: (r) => levelText(r.level) },
    { id: "field", label: t("Field"), cell: (r) => (r.field ? <Code code={r.field} /> : DASH) },
    { id: "value", label: t("Value"), cell: (r) => (r.actual_value ? <Code code={r.actual_value} /> : <span className="nx-sub">{t("Blank")}</span>) },
    { id: "severity", label: t("Severity"), cell: (r) => <Sev severity={r.severity} /> },
    { id: "issue", label: t("Issue"), cell: (r) => (r.issue_id ? <Link href={`/issues?search=${encodeURIComponent(r.record_key)}`}>{t("Open issue")}</Link> : DASH) },
  ];
  return (
    <>
      <HBars
        label={t("Rules failing, by view")}
        rows={views.filter((v) => v.failing.length > 0).map((v) => ({
          key: v.view,
          label: viewText(v.view, v.label),
          value: v.failing.length,
          text: t("{n} failing", { n: int(v.failing.length) }),
          tone: v.failing.some((r) => r.severity === "critical" || r.severity === "high") ? "bad" : "warn",
        }))}
      />
      <ExportTable><DataTable rows={rows} columns={cols} rowKey={(r) => `${r.view}-${r.check_id}-${r.level}`} rowLabel={(r) => r.check_id} caption={t("Rules failing, by view")} /></ExportTable>
    </>
  );
}

type Bom = NonNullable<Supersession["bom_usage"]>[number];

function Chain({ s }: { s: Supersession }) {
  const bomCols: Column<Bom>[] = [
    { id: "stlnr", label: t("Bill of material"), cell: (b) => (b.stlnr ? <Code code={b.stlnr} /> : DASH) },
    { id: "posnr", label: t("Item"), cell: (b) => (b.posnr ? <Code code={b.posnr} /> : DASH) },
    { id: "werks", label: t("Plant"), cell: (b) => (b.werks ? <Code code={b.werks} text={levelText(`plant:${b.werks}`)} /> : DASH) },
    { id: "nfgrp", label: t("Discontinuation group"), cell: (b) => (b.nfgrp ? <Code code={b.nfgrp} /> : DASH) },
    { id: "flags", label: t("Problems"), cell: (b) => <Flags flags={b.flags} /> },
  ];
  return (
    <>
      {s.plants.length === 0 ? <p className="nx-sub">{t("No plant is phasing this material out.")}</p> : s.plants.map((p) => (
        <div key={p.werks} className="nx-mat-plant" data-testid="material-chain-plant">
          <h3>
            {levelText(`plant:${p.werks}`)}
            {p.ausdt ? <span className="nx-sub"> {t("Discontinued on {d}", { d: formatDate(p.ausdt, "date") })}</span> : null}
            {p.dead_end ? <span className="nx-sub"> {t("Ends with no successor")}</span> : null}
            {p.loop_at ? <span className="nx-sub"> {t("Loops back at {m}", { m: p.loop_at })}</span> : null}
            {p.truncated ? <span className="nx-sub"> {t("Cut at {n} links", { n: int(p.depth) })}</span> : null}
          </h3>
          <ol className="nx-mat-chain">{p.chain.map((n) => <ChainStep key={n.matnr} n={n} />)}</ol>
        </div>
      ))}
      <h3>{t("Bills of material that use it")}</h3>
      {s.bom_usage == null ? (
        <p className="nx-sub">{t("Bills of material were not extracted.")}</p>
      ) : s.bom_usage.length === 0 ? (
        <p className="nx-sub">{t("No bill of material uses this material.")}</p>
      ) : (
        <ExportTable><DataTable rows={s.bom_usage} columns={bomCols} rowKey={(b) => `${b.stlnr}-${b.posnr}-${b.werks}`} rowLabel={(b) => b.stlnr ?? DASH} caption={t("Bills of material that use it")} /></ExportTable>
      )}
    </>
  );
}

function ChainStep({ n }: { n: ChainNode }) {
  const code = <Code code={n.matnr} text={n.maktx ?? undefined} />;
  return (
    <li>
      {n.this ? code : <Link href={`/materials?m=${encodeURIComponent(n.matnr)}`}>{code}</Link>}
      {n.this ? <span className="nx-sub"> {t("This material")}</span> : null}
      {n.dismm ? <span className="nx-sub"> {t("MRP type {v}", { v: n.dismm })}</span> : null}
      {n.ausdt ? <span className="nx-sub"> {t("Discontinued on {d}", { d: formatDate(n.ausdt, "date") })}</span> : null}
      {n.flags.length ? <> <Flags flags={n.flags} /></> : null}
    </li>
  );
}

function Flags({ flags }: { flags: string[] }) {
  if (!flags.length) return <>{DASH}</>;
  return <>{flags.map((f, i) => <span key={f}>{i ? ", " : null}<Code code={f} text={FLAG_TEXT[f]?.()} /></span>)}</>;
}

type Dup = Duplicates["items"][number];

function DupTable({ items }: { items: Dup[] }) {
  const cols: Column<Dup>[] = [
    { id: "material", label: t("Material"), cell: (x) => <Link href={`/materials?m=${encodeURIComponent(x.matnr)}`}><Code code={x.matnr} text={x.maktx ?? undefined} /></Link> },
    { id: "type", label: t("Type"), cell: (x) => (x.mtart ? <Code code={x.mtart} /> : DASH) },
    { id: "group", label: t("Group"), cell: (x) => (x.matkl ? <Code code={x.matkl} /> : DASH) },
    { id: "matches", label: t("Matches on"), cell: (x) => x.matches_on.join(", ") },
    { id: "score", label: t("Score"), align: "end", cell: (x) => int(x.score), compare: (a, b) => a.score - b.score },
  ];
  return <ExportTable><DataTable rows={items} columns={cols} rowKey={(x) => x.matnr} rowLabel={(x) => x.matnr} caption={t("Materials that look like it")} /></ExportTable>;
}
