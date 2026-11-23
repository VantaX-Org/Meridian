"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/context/auth-context";
import { getAttention } from "@/lib/api/v2/attention";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { startObjects, usePortfolio, type PortfolioRow } from "@/lib/api/next/portfolio";
import { useLandscape } from "@/lib/v2/queries";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { DASH, int } from "@/lib/v2/score";
import {
  Button, Card, Confirm, DataTable, EmptyState, ErrorState, FieldChip, KpiStrip, MasterList, PageHeader, ScoreRuler, Skeleton, useAletheia, useAletheiaScope, useStacked, useToast,
  type RulerMark, type Severity,
} from "@/ui/kit";
import { actionLabel, objectPath, stepLabel } from "./links";

const sevLabel = (s: string): string => (s === "critical" ? t("Critical") : s === "high" ? t("High") : s === "medium" ? t("Medium") : s === "low" ? t("Low") : t("Info"));
const toneOf = (n: number | null): "go" | "watch" | "stop" => (n === null ? "stop" : n >= 85 ? "go" : n >= 70 ? "watch" : "stop");
const greeting = (): string => { const h = new Date().getHours(); return h < 12 ? t("Good morning") : h < 18 ? t("Good afternoon") : t("Good evening"); };

const RULER_ROWS = 12;

/** The first screen: where every object stands against the gates, what moved, and what needs a person. */
export function Home() {
  useInterfaceLang();
  const fx = useFixture();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const chat = useAletheia();
  const stacked = useStacked();
  const me = useCurrentUser();
  const land = useLandscape(null);
  const pf = usePortfolio({}, true);
  const att = useQuery({ queryKey: ["next", "home-attention", fx], queryFn: () => getAttention({}), staleTime: 30_000 });
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [allMarks, setAllMarks] = useState(false);
  const href = (p: string) => withFixture(p, fx);

  const rows = pf.data?.objects ?? [];
  const systems = land.data?.systems ?? [];
  const cells = land.data?.cells ?? [];
  const scored = rows.filter((r) => r.composite_score !== null);

  useAletheiaScope({
    key: "home",
    label: t("Asking about all objects"),
    suggestions: [t("What needs me first?"), t("Which objects are closest to ready?")],
    answer: (p) => ({ text: p === t("Which objects are closest to ready?")
      ? [...scored].sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0)).slice(0, 3).map((r) => `${r.label}: ${Math.round(r.composite_score ?? 0)}`).join("; ") || t("No scored object yet.")
      : att.data?.items[0] ? `${att.data.items[0].title}. ${att.data.items[0].detail}` : t("Nothing needs you right now.") }),
  });

  const pullAll = async () => {
    setBusy(true);
    try {
      const r = await startObjects(rows.map((x) => x.module));
      toast(t("{n} objects queued for a new pull.", { n: r.queued.length }), "good");
      void qc.invalidateQueries({ queryKey: ["next", "portfolio"] });
    } catch {
      toast(t("The pull could not be started."), "bad");
    } finally {
      setBusy(false);
      setAsk(false);
    }
  };

  if (land.isLoading || pf.isLoading) return <Skeleton lines={8} label={t("Loading the home screen")} />;
  if (land.isError || pf.isError) return <ErrorState heading={t("The overview could not be loaded")} retryLabel={t("Try again")} onRetry={() => void Promise.all([land.refetch(), pf.refetch()])} />;

  const strip = land.data?.status_strip;
  const s = land.data?.sentence;
  const sentence = s ? t("{held} of {n} objects score under 85, and {crit} critical rules are over their limit.", { held: s.held_under_85, n: s.objects, crit: s.critical_over_tolerance }) : "";

  const cellOf = (r: PortfolioRow) => cells.find((c) => c.system_id === r.system_id && c.module === r.module);
  const sysName = new Map((land.data?.systems ?? []).map((x) => [x.id, x.name]));
  const ranked = [...scored].sort((a, b) => (a.composite_score ?? 0) - (b.composite_score ?? 0));
  const marks: RulerMark[] = (allMarks ? ranked : ranked.slice(0, RULER_ROWS)).map((r) => ({
    id: r.module + r.system_id,
    label: r.system_id && sysName.get(r.system_id) ? t("{object} in {system}", { object: r.label, system: sysName.get(r.system_id) as string }) : r.label,
    shown: r.composite_score ?? 0,
    measured: r.capped ? r.measured_score : null, tone: toneOf(r.composite_score),
    href: href(objectPath(r, systems)),
  }));
  const labels = { atRisk: t("At risk"), go: t("Go"), cap70: t("Cap at 70"), cap85: t("Cap at 85"), measured: (n: number) => t("Measured {n}", { n }) };

  const moved = rows.filter((r) => r.resolved + r.new_issues + r.regressed > 0);
  const maxMove = Math.max(1, ...moved.map((r) => Math.max(r.resolved, r.new_issues + r.regressed)));

  const items = att.data?.items ?? [];
  const attRows = items.slice(0, 8).map((i) => ({
    id: i.id,
    severity: (["critical", "high", "medium", "low"].includes(i.severity) ? i.severity : "low") as Severity,
    severityLabel: sevLabel(i.severity),
    text: `${i.title}. ${i.detail}`,
    countLabel: i.action_label,
  }));

  return (
    <div className="mx-home">
      <PageHeader
        title={me?.name ? t("{greeting}, {name}", { greeting: greeting(), name: me.name.split(" ")[0] }) : greeting()}
        crumbs={[{ label: t("Home") }]}
        meta={[
          strip?.run_at ? t("Last run {when}", { when: new Date(strip.run_at).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }) }) : null,
          strip?.records_checked != null ? t("{n} records checked", { n: int(strip.records_checked) }) : null,
          strip?.rules_measured != null ? t("{n} rules measured", { n: int(strip.rules_measured) }) : null,
          strip?.licence_valid_to ? t("Licence valid to {d}", { d: strip.licence_valid_to.slice(0, 10) }) : null,
        ]}
        actions={<>
          <Button variant="primary" onClick={() => setAsk(true)} disabled={!rows.length || busy}>{t("Pull every object")}</Button>
          <Button variant="secondary" href={href("/o")}>{t("All objects")}</Button>
        </>}
      />
      {sentence ? <p className="mx-home-sub">{sentence}</p> : null}

      <KpiStrip label={t("Portfolio at a glance")} cells={[
        { label: t("Objects"), value: int(rows.length), href: href("/o") },
        { label: t("Scored"), value: scored.length ? int(scored.length) : null },
        { label: t("Ready"), value: scored.length ? int(scored.filter((r) => (r.composite_score ?? 0) >= 85).length) : null, note: t("Score 85 or more") },
        { label: t("Held under 85"), value: s ? int(s.held_under_85) : null },
        { label: t("Critical rules over limit"), value: s ? int(s.critical_over_tolerance) : null },
        { label: t("Open work"), value: cells.length ? int(cells.reduce((n, c) => n + (c.open_work ?? 0), 0)) : null, href: href("/work") },
      ]} />

      <Card title={t("Needs your attention")} sub={att.data ? t("{n} items, most urgent first", { n: items.length }) : undefined}>
        {att.isError ? <ErrorState heading={t("The list could not be loaded")} retryLabel={t("Try again")} onRetry={() => void att.refetch()} />
          : attRows.length ? <MasterList label={t("Attention items")} rows={attRows} selectedId={null} onSelect={(id) => { const it = items.find((x) => x.id === id); if (it) router.push(href(it.href)); }} />
          : <EmptyState heading={t("Nothing needs you")} body={t("No approvals, failures or overdue items are waiting.")} />}
      </Card>

      <Card title={t("Where every object stands")} sub={t("Gates at 70 and 85. A hollow mark is the measured score before a cap.")}>
        {scored.length > RULER_ROWS ? <p className="mx-muted">{allMarks ? t("All {n} objects, lowest score first.", { n: scored.length }) : t("The {k} lowest of {n} objects.", { k: RULER_ROWS, n: scored.length })} <Button variant="ghost" onClick={() => setAllMarks((v) => !v)}>{allMarks ? t("Show fewer") : t("Show all {n}", { n: scored.length })}</Button></p> : null}
        {marks.length ? <ScoreRuler marks={marks} labels={labels} ariaLabel={t("Score of every object against the gates")} from={stacked ? 50 : 0} /> : <EmptyState heading={t("No objects have run yet")} body={t("Pull an object to see its score here.")} />}
      </Card>

      {rows.length ? (
        <DataTable<PortfolioRow>
          id="home-objects"
          label={t("Next action per object")}
          rows={rows}
          rowKey={(r) => r.module + r.system_id}
          height={360}
          columns={[
            { key: "label", label: t("Object"), sort: (r) => r.label, render: (r) => <><Link href={href(objectPath(r, systems))}><strong>{r.label}</strong></Link> <FieldChip code={r.module} description={r.label} /></> },
            { key: "system", label: t("System"), sort: (r) => (r.system_id && sysName.get(r.system_id)) || "", render: (r) => (r.system_id && sysName.get(r.system_id)) || DASH },
            { key: "score", label: t("Score"), align: "end", sort: (r) => r.composite_score ?? -1, render: (r) => <span className="mx-num">{r.composite_score === null ? DASH : int(r.composite_score)}</span> },
            { key: "measured", label: t("Measured"), align: "end", defaultHidden: true, sort: (r) => r.measured_score ?? -1, render: (r) => <span className="mx-num">{r.measured_score === null ? DASH : int(r.measured_score)}</span> },
            { key: "step", label: t("Cycle step"), sort: (r) => r.step ?? "", render: (r) => stepLabel(r.step ?? "pull") },
            { key: "open", label: t("Open work"), align: "end", sort: (r) => cellOf(r)?.open_work ?? -1, render: (r) => <span className="mx-num">{cellOf(r) ? int(cellOf(r)?.open_work ?? 0) : DASH}</span> },
            { key: "next", label: t("Next action"), render: (r) => <Button variant="secondary" href={href(objectPath(r, systems))}>{actionLabel(r)}</Button> },
          ]}
        />
      ) : null}

      <div className="mx-home-panels">
        <Card title={t("What moved since the last run")} sub={t("Resolved issues against new and regressed ones, per object.")}>
          {moved.length ? (
            <ul className="mx-home-div" aria-label={t("Change per object")}>
              {moved.map((r) => (
                <li key={r.module + r.system_id}>
                  <span>{r.label}</span>
                  <span className="mx-home-divbar" role="img" aria-label={t("{a} resolved, {b} new or regressed", { a: r.resolved, b: r.new_issues + r.regressed })}>
                    <i data-side="new" style={{ inlineSize: `${((r.new_issues + r.regressed) * 50) / maxMove}%` }} />
                    <i data-side="fixed" style={{ inlineSize: `${(r.resolved * 50) / maxMove}%` }} />
                  </span>
                  <span className="mx-home-v">{`+${r.resolved} / -${r.new_issues + r.regressed}`}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState heading={t("Nothing moved")} body={t("No issue was resolved, opened or regressed since the last run.")} />}
        </Card>
        <Card title={t("Systems")} sub={strip?.licence_valid_to ? t("Licence valid to {d}", { d: strip.licence_valid_to.slice(0, 10) }) : undefined}>
          {systems.length ? (
            <ul className="mx-home-sys" aria-label={t("Connected systems")}>
              {systems.map((x) => (
                <li key={x.id}>
                  <span>{x.name}<span className="mx-home-sub">{[x.version, x.client].filter(Boolean).join(" ")}</span></span>
                  <span className="mx-home-v">{x.records == null ? DASH : int(x.records)}</span>
                  <span className="mx-home-pill" data-tone={x.state === "analysed" ? "go" : x.state === "extracted" ? "watch" : "none"}>{x.state === "analysed" ? t("Analysed") : x.state === "extracted" ? t("Extracted") : t("Not extracted")}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState heading={t("No system connected")} body={t("Connect a system to start.")} />}
        </Card>
      </div>

      <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
      <Confirm open={ask} title={t("Pull every object?")} confirmLabel={t("Pull {n} objects", { n: rows.length })} cancelLabel={t("Cancel")} onConfirm={() => void pullAll()} onCancel={() => setAsk(false)}>
        <p>{t("Every object is read again from its system. This can take a while and is not stopped half way.")}</p>
      </Confirm>
    </div>
  );
}
