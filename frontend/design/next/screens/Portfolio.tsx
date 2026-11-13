"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { useV2Session } from "@/lib/v2/hooks";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { V2Link } from "@/design/v2/parts";
import { errorSentence } from "@/lib/api/v2/client";
import { analyseRun } from "@/lib/api/v2/runs";
import { downloadWorkbook, startObjects, usePortfolio, type CycleStep, type PortfolioQuery, type PortfolioRow } from "@/lib/api/next/portfolio";
import { Button, Confirm, EmptyState, ErrorState, SegmentedControl, Skeleton, Tabs, useToast } from "../kit";
import { BulkBar, type PortfolioActions } from "../portfolio/BulkBar";
import { Cards } from "../portfolio/Cards";
import { CompareObjects } from "../portfolio/CompareObjects";
import { StatRow } from "../portfolio/StatRow";
import { Table } from "../portfolio/Table";
import { UploadPanel } from "../panels/UploadPanel";
import "../portfolio/portfolio.css";

const PAGE = 50;
type View = "cards" | "table" | "compare";

/**
 * Home: every object at its newest run, where it stands in the pull, clean, upload, score, compare cycle, and the one
 * thing to do next. Filters, sort and paging run on the server, so a hundred objects and their runs stay quick.
 */
export function Portfolio() {
  const session = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const systems = useSystemsExtended().data ?? [];
  const [view, setView] = useState<View>("cards");
  const [f, setF] = useState<PortfolioQuery>({ sort: "-new_issues" });
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<Map<string, PortfolioRow>>(new Map());
  const [pulling, setPulling] = useState<PortfolioRow[] | null>(null);
  const [uploadFor, setUploadFor] = useState<PortfolioRow[] | null>(null);
  const [scoring, setScoring] = useState<Set<string>>(new Set());
  const [compared, setCompared] = useState<PortfolioRow[]>([]);

  const page = usePortfolio({ ...f, limit: PAGE, offset });
  const all = usePortfolio({ limit: 500 });
  const rows = page.data?.objects ?? [];
  const total = page.data?.total ?? 0;
  const owners = useMemo(() => [...new Set((all.data?.objects ?? []).map((r) => r.owner).filter((o): o is string => !!o))].sort(), [all.data]);
  const sysName = (id: string | null) => systems.find((s) => s.id === id)?.name ?? id ?? t("Unknown system");
  const set = (p: Partial<PortfolioQuery>) => {
    setF((x) => ({ ...x, ...p }));
    setOffset(0);
  };
  const refresh = () => void qc.invalidateQueries({ queryKey: ["next", "portfolio"] });

  const act: PortfolioActions = {
    sysName,
    can: session.can,
    scoring,
    pull: (rs) => setPulling(rs),
    upload: (rs) => setUploadFor(rs),
    compare: (rs) => {
      setCompared(rs.slice(0, 6));
      setView("compare");
      if (rs.length > 6) toast({ text: t("Compare shows six objects at most; the first six are shown."), tone: "neutral" });
    },
    download: async (rs) => {
      // ponytail: one file per run, no ZIP endpoint yet; a bundle endpoint is the upgrade past a handful of objects.
      for (const r of rs) {
        try {
          await downloadWorkbook(r);
        } catch (err) {
          toast({ text: errorSentence(err, t("The workbook could not be downloaded. Try again.")), tone: "bad" });
          return;
        }
      }
      toast({ text: rs.length === 1 ? t("Workbook for run {n} downloaded. Upload it when you are done.", { n: formatInt(rs[0].run_number ?? 0) }) : t("{n} workbooks downloaded. Upload them when you are done.", { n: formatInt(rs.length) }), tone: "good" });
    },
    score: async (rs) => {
      setScoring((s) => new Set([...s, ...rs.map((r) => r.version_id)]));
      const out = await Promise.allSettled(rs.map((r) => analyseRun(r.version_id)));
      const failed = out.filter((o) => o.status === "rejected").length;
      toast(failed ? { text: t("{n} of {m} runs could not be scored. Try again.", { n: formatInt(failed), m: formatInt(rs.length) }), tone: "bad" } : { text: t("Scoring {n} runs.", { n: formatInt(rs.length) }), tone: "good" });
      refresh();
    },
  };

  const confirmPull = async () => {
    const rs = pulling ?? [];
    setPulling(null);
    try {
      const res = await startObjects([...new Set(rs.map((r) => r.module))]);
      toast({ text: res.skipped.length ? t("{n} objects queued to pull, {m} already running.", { n: formatInt(res.queued.length), m: formatInt(res.skipped.length) }) : t("{n} objects queued to pull.", { n: formatInt(res.queued.length) }), tone: "good" });
      refresh();
    } catch (err) {
      toast({ text: errorSentence(err, t("The pull could not start. Try again.")), tone: "bad" });
    }
  };

  const toggle = (r: PortfolioRow) =>
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(r.version_id)) n.delete(r.version_id);
      else n.set(r.version_id, r);
      return n;
    });
  const selection = [...picked.values()];
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + rows.length, total);
  const pager = total > PAGE ? (
    <nav className="nx-pf-pager" aria-label={t("Pages")}>
      <span>{t("Showing {from}–{to} of {m}", { from: formatInt(from), to: formatInt(to), m: formatInt(total) })}</span>
      <Button size={32} icon="chevron-left" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t("Previous")}</Button>
      <Button size={32} icon="chevron-right" disabled={page.data?.next_offset == null} onClick={() => setOffset(page.data?.next_offset ?? offset)}>{t("Next")}</Button>
    </nav>
  ) : null;

  return (
    <main className="nx-pf" data-testid="portfolio">
      <header className="nx-pf-head">
        <div>
          <h1>{t("Portfolio")}</h1>
          <p>{t("Every object at its newest run, where it stands in the cycle, and what to do next.")}</p>
        </div>
        <V2Link className="nx-btn nx-btn-quiet nx-btn-sm" href="/">{t("Landscape map")}</V2Link>
      </header>

      <StatRow rows={all.data?.objects ?? []} loading={all.isLoading} />

      <div className="nx-pf-filters" role="search" aria-label={t("Filter objects")}>
        <label className="nx-field">
          <span>{t("Search")}</span>
          <input className="nx-input" type="search" value={f.q ?? ""} placeholder={t("Object name or code")} onChange={(e) => set({ q: e.target.value })} />
        </label>
        <label className="nx-field">
          <span>{t("System")}</span>
          <select className="nx-input" value={f.system_id ?? ""} onChange={(e) => set({ system_id: e.target.value || undefined })}>
            <option value="">{t("All systems")}</option>
            {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="nx-field">
          <span>{t("Owner")}</span>
          <select className="nx-input" value={f.owner ?? ""} onChange={(e) => set({ owner: e.target.value || undefined })}>
            <option value="">{t("All owners")}</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="nx-field">
          <span>{t("Cycle stage")}</span>
          <select className="nx-input" value={f.step ?? ""} onChange={(e) => set({ step: (e.target.value || undefined) as CycleStep | undefined })}>
            <option value="">{t("All stages")}</option>
            <option value="pull">{t("Pull")}</option>
            <option value="clean">{t("Clean")}</option>
            <option value="upload">{t("Upload")}</option>
            <option value="score">{t("Score")}</option>
            <option value="compare">{t("Compare")}</option>
          </select>
        </label>
        <label className="nx-field">
          <span>{t("Sort by")}</span>
          <select className="nx-input" value={f.sort} onChange={(e) => set({ sort: e.target.value })}>
            <option value="-new_issues">{t("Most new issues")}</option>
            <option value="-regressed">{t("Most regressed")}</option>
            <option value="composite_score">{t("Lowest score")}</option>
            <option value="run_at">{t("Longest since a run")}</option>
            <option value="module">{t("Name")}</option>
            <option value="system_id">{t("System")}</option>
          </select>
        </label>
        <label className="nx-check-row">
          <input type="checkbox" className="nx-check" checked={f.readiness === "pass"} onChange={(e) => set({ readiness: e.target.checked ? "pass" : undefined })} />
          <span>{t("Ready to load only")}</span>
        </label>
      </div>

      <div className="nx-pf-viewbar">
        <Tabs idBase="pf" label={t("Portfolio views")} value={view} onChange={(v) => setView(v as View)} items={[
          { id: "cards", label: t("Cards"), badge: formatInt(total) },
          { id: "table", label: t("Table") },
          { id: "compare", label: t("Compare"), badge: compared.length ? formatInt(compared.length) : undefined },
        ]} />
        {view === "cards" ? <SegmentedControl label={t("Select")} value="none" onChange={(v) => setPicked(v === "page" ? new Map([...picked, ...rows.map((r) => [r.version_id, r] as const)]) : new Map())} items={[{ value: "page", label: t("Select this page") }, { value: "none", label: t("Select none") }]} /> : null}
      </div>

      <section id={`pf-panel-${view}`} role="tabpanel" aria-labelledby={`pf-tab-${view}`}>
        {view === "cards" ? (
          <>
            <BulkBar rows={selection} act={act} onClear={() => setPicked(new Map())} />
            {page.isError ? <ErrorState error={page.error} fallback={t("The portfolio could not be read. Check that the API is reachable, then retry.")} onRetry={() => void page.refetch()} />
              : page.isLoading ? <Skeleton lines={6} label={t("Loading the portfolio")} />
              : rows.length === 0 ? <EmptyState heading={t("No object matches these filters.")}>{t("Clear a filter to see more objects.")}</EmptyState>
              : <Cards rows={rows} act={act} selected={new Set(picked.keys())} onToggle={toggle} />}
          </>
        ) : view === "table" ? (
          <Table rows={rows} total={total} act={act} loading={page.isLoading} error={page.isError ? { sentence: errorSentence(page.error, t("The portfolio could not be read. Check that the API is reachable, then retry.")), onRetry: () => void page.refetch() } : undefined} />
        ) : (
          <CompareObjects rows={compared} sysName={sysName} />
        )}
        {view !== "compare" ? pager : null}
      </section>

      <Confirm
        open={!!pulling}
        title={t("Pull {n} objects now?", { n: formatInt(new Set((pulling ?? []).map((r) => r.module)).size) })}
        consequence={t("Meridian reads {n} objects from their systems again and scores the new runs. Nothing is written to the systems.", { n: formatInt(new Set((pulling ?? []).map((r) => r.module)).size) })}
        confirmLabel={t("Pull now")}
        onConfirm={() => void confirmPull()}
        onCancel={() => setPulling(null)}
      />
      <UploadPanel
        open={!!uploadFor}
        expected={uploadFor ?? []}
        onClose={() => setUploadFor(null)}
        onDone={(res) => {
          const scoringN = res.filter((r) => r.status === "pending" || r.status === "running").length;
          toast({ text: t("{n} workbooks uploaded. {m} new runs scoring.", { n: formatInt(res.length), m: formatInt(scoringN) }), tone: "good" });
          refresh();
        }}
      />
    </main>
  );
}
