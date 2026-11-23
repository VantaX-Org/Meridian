"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { downloadWorkbook, downloadWorkbooks, startObjects, usePortfolio, type CycleStep, type PortfolioRow } from "@/lib/api/next/portfolio";
import { useLandscape } from "@/lib/v2/queries";
import { useRunParam } from "@/lib/v2/hooks";
import type { LandscapeCell } from "@/lib/api/v2/types";
import { Lead } from "@/ui/screens/object-tabs/Lead";
import { formatDate } from "@/lib/format";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { Button, Card, Chip, Confirm, CycleStepper, DataTable, EmptyState, ErrorState, FieldChip, KpiStrip, PageHeader, Search, Skeleton, useAletheia, useAletheiaScope, useToast, ExportMenu } from "@/ui/kit";
import { actionLabel, objectPath, readinessLabel, STEPS, stepLabel } from "./links";

const SHOWN_MAX = 50;

/** Every object at its newest run: search, filter by cycle step, then open, download its workbook or pull it again. */
export function Objects() {
  useInterfaceLang();
  const fx = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const chat = useAletheia();
  const [q, setQ] = useState("");
  const [step, setStep] = useState<CycleStep | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [ask, setAsk] = useState(false);
  const pf = usePortfolio({ q, step: step ?? undefined }, true);
  const all = usePortfolio({}, true);
  const pinned = useRunParam();
  const land = useLandscape(pinned);
  const systems = land.data?.systems ?? [];
  const cells = land.data?.cells ?? [];
  const nameOf = (m: string) => land.data?.objects.find((o) => o.module === m)?.label ?? m;
  const sysOf = (id: string) => systems.find((s) => s.id === id)?.name ?? t("n/a");
  const scores = cells.map((c) => c.raw_score ?? c.score);
  const within = (test: (v: number) => boolean) => scores.filter((v) => v !== null && test(v)).length;
  const rows = useMemo(() => pf.data?.objects ?? [], [pf.data]);
  const key = (r: PortfolioRow) => `${r.system_id}/${r.module}`;
  const sel = rows.find((r) => key(r) === pick) ?? null;
  const sysName = (r: PortfolioRow) => systems.find((s) => s.id === r.system_id)?.name ?? t("n/a");
  const href = (p: string) => withFixture(p, fx);

  useAletheiaScope({
    key: "objects",
    label: t("Asking about all objects"),
    suggestions: [t("Which objects are not ready?")],
    answer: () => {
      const bad = rows.filter((r) => r.readiness === "fail").slice(0, 5).map((r) => r.label);
      return { text: bad.length ? t("Not ready: {list}.", { list: bad.join(", ") }) : t("Every object in this list is ready or close.") };
    },
  });

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok, "good"); void qc.invalidateQueries({ queryKey: ["next", "portfolio"] }); } catch { toast(t("That did not work. Try again."), "bad"); }
    setAsk(false);
  };

  const counts = (s: CycleStep) => (all.data?.objects ?? []).filter((r) => (r.step ?? "pull") === s).length;

  return (
    <>
      <PageHeader
        title={t("Objects")}
        crumbs={[{ label: t("Objects") }]}
        meta={[pf.data ? t("{n} objects, each at its newest run", { n: pf.data.total }) : null, pinned ? t("Pinned to one run") : null]}
        actions={<>
          <ExportMenu formats={[{ id: "xlsx", label: t("Excel workbooks"), hint: t("One cleaning workbook per object") }]} disabled={!rows.length || rows.length > SHOWN_MAX} count={rows.length} summary={rows.length > SHOWN_MAX ? t("Narrow the list to {n} objects or fewer.", { n: SHOWN_MAX }) : undefined} onExport={() => downloadWorkbooks(rows)} />
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
        </>}
      />
      <KpiStrip label={t("Objects at a glance")} cells={[
        { label: t("Objects"), value: land.data ? int(cells.length) : null },
        { label: t("Ready"), value: land.data ? int(within((v) => v >= 85)) : null, note: t("Score 85 or more") },
        { label: t("At risk"), value: land.data ? int(within((v) => v >= 70 && v < 85)) : null, note: t("Score 70 to 85") },
        { label: t("Not ready"), value: land.data ? int(within((v) => v < 70)) : null, note: t("Score under 70") },
        { label: t("Not scored"), value: land.data ? int(scores.filter((v) => v === null).length) : null },
      ]} />
      {pinned ? (
        <p className="mx-muted" role="status" data-testid="objects-pinned">
          {t("Pinned to one run. Pinned scores come from that run only.")} <a href={href("/o")}>{t("Show each object at its newest run")}</a>
        </p>
      ) : null}
      <Lead
        tab="objects"
        title={t("How the scores spread")}
        sentence={t("{n} objects by measured score, out of 100.", { n: cells.length })}
        bars={[
          { id: "good", label: t("90 or more"), value: within((v) => v >= 90), tone: "good" },
          { id: "warn", label: t("70 to 90"), value: within((v) => v >= 70 && v < 90), tone: "warn" },
          { id: "bad", label: t("Under 70"), value: within((v) => v < 70), tone: "bad" },
          { id: "none", label: t("Not scored"), value: scores.filter((v) => v === null).length },
        ]}
      />
      {pinned ? (
        land.isLoading ? <Skeleton lines={8} label={t("Loading objects")} />
          : land.isError ? <ErrorState heading={t("The objects could not be loaded")} retryLabel={t("Try again")} onRetry={() => void land.refetch()} />
          : !cells.length ? <EmptyState heading={t("No object has a finished run yet, so there is nothing to score.")} body={t("Extract a system and run an analysis to score its objects.")} />
          : (
            <DataTable<LandscapeCell>
              label={t("Objects in the pinned run")}
              rows={cells}
              rowKey={(c) => `${c.system_id}/${c.module}`}
              height={440}
              columns={[
                { key: "label", label: t("Object"), sort: (c) => nameOf(c.module), render: (c) => <><a href={href(`${objectPath(c, systems)}?run=${encodeURIComponent(c.run_id)}`)}>{nameOf(c.module)}</a> <FieldChip code={c.module} description={nameOf(c.module)} /></> },
                { key: "system", label: t("System"), sort: (c) => sysOf(c.system_id), render: (c) => sysOf(c.system_id) },
                { key: "score", label: t("Score"), align: "end", sort: (c) => c.score ?? -1, render: (c) => <span className="mx-num">{c.score === null ? t("n/a") : Math.round(c.score)}</span> },
                { key: "records", label: t("Records checked"), align: "end", sort: (c) => c.records_checked ?? -1, render: (c) => <span className="mx-num">{c.records_checked === null ? t("n/a") : c.records_checked.toLocaleString()}</span> },
              ]}
            />
          )
      ) : <>
      <Card title={t("Find an object")}>
        <Search value={q} onChange={setQ} label={t("Search objects")} clearLabel={t("Clear search")} placeholder={t("Search by object name")} />
        <div className="mx-chips" role="group" aria-label={t("Filter by cycle step")}>
          <Chip selected={step === null} onClick={() => setStep(null)} count={all.data?.total}>{t("All steps")}</Chip>
          {STEPS.map((s) => <Chip key={s} selected={step === s} onClick={() => setStep(s)} count={counts(s)}>{stepLabel(s)}</Chip>)}
        </div>
      </Card>
      {pf.isLoading ? <Skeleton lines={8} label={t("Loading objects")} />
        : pf.isError ? <ErrorState heading={t("The objects could not be loaded")} retryLabel={t("Try again")} onRetry={() => void pf.refetch()} />
        : !rows.length ? <EmptyState heading={t("No object matches")} body={t("Clear the search or the step filter.")} action={<Button onClick={() => { setQ(""); setStep(null); }}>{t("Clear filters")}</Button>} />
        : (
          <DataTable<PortfolioRow>
            id="objects"
            label={t("Objects")}
            rows={rows}
            rowKey={key}
            selection="multi"
            selectedKeys={keys}
            onSelectedKeys={setKeys}
            bulkActions={[
              { id: "pull", label: t("Pull again"), run: (ks) => void run(() => startObjects(rows.filter((r) => ks.includes(key(r))).map((r) => r.module)), t("Pull queued.")) },
              { id: "xlsx", label: t("Download workbooks"), run: (ks) => { const chosen = rows.filter((r) => ks.includes(key(r))); if (chosen.length <= SHOWN_MAX) void downloadWorkbooks(chosen); } },
            ]}
            selected={pick}
            onSelect={(r) => setPick(key(r))}
            height={440}
            columns={[
              { key: "label", label: t("Object"), sort: (r) => r.label, render: (r) => <><a href={href(objectPath(r, systems))} onClick={(e) => e.stopPropagation()}><strong>{r.label}</strong></a> <FieldChip code={r.module} description={r.label} /></> },
              { key: "system", label: t("System"), sort: sysName, render: sysName },
              { key: "score", label: t("Score"), align: "end", sort: (r) => r.composite_score ?? -1, render: (r) => <span className="mx-num">{r.composite_score === null ? t("n/a") : Math.round(r.composite_score)}</span> },
              { key: "ready", label: t("Readiness"), sort: (r) => r.readiness ?? "", render: (r) => readinessLabel(r.readiness) },
              { key: "step", label: t("Next step"), sort: (r) => r.step ?? "", render: actionLabel },
              { key: "run", label: t("Run"), align: "end", sort: (r) => r.run_number ?? 0, render: (r) => <span className="mx-num">{r.run_number ?? t("n/a")}</span> },
              { key: "owner", label: t("Owner"), sort: (r) => r.owner ?? "", render: (r) => r.owner ?? t("Not assigned") },
              { key: "at", label: t("Last run"), sort: (r) => r.run_at ?? "", render: (r) => (r.run_at ? formatDate(r.run_at, "date") : t("n/a")) },
            ]}
          />
        )}
      {sel ? (
        <Card title={t("{object} on {system}", { object: sel.label, system: sysName(sel) })} sub={t("Next step: {step}", { step: actionLabel(sel) })}>
          <CycleStepper label={t("Clean cycle")} step={sel.step ?? "pull"} labels={{ pull: stepLabel("pull"), clean: stepLabel("clean"), upload: stepLabel("upload"), score: stepLabel("score"), compare: stepLabel("compare") }} />
          <div className="mx-links">
            <Button variant="primary" href={href(objectPath(sel, systems))}>{t("Open object")}</Button>
            <ExportMenu formats={[{ id: "xlsx", label: t("Excel workbook"), hint: t("The cleaning workbook for this object") }]} onExport={() => downloadWorkbook(sel)} />
            <Button variant="secondary" onClick={() => setAsk(true)}>{t("Pull again")}</Button>
          </div>
        </Card>
      ) : null}
      </>}
      <Confirm open={ask} title={t("Pull {object} again?", { object: sel?.label ?? "" })} confirmLabel={t("Pull now")} cancelLabel={t("Cancel")} onConfirm={() => sel && void run(() => startObjects([sel.module]), t("Pull queued."))} onCancel={() => setAsk(false)}>
        <p>{t("The object is read again from its system and scored as a new run.")}</p>
      </Confirm>
    </>
  );
}
