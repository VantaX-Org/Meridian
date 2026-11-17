"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getBurndown, getProposalQuality, getRecurrence, getRootCauses, getRuleFeedback, getRunChange, getThroughput, getTimeToFix } from "@/lib/api/v2/work-analytics";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { fixed, whole } from "@/lib/v2/format";
import { BarList, Button, Card, DataTable, EmptyState, FieldChip, PageHeader, Skeleton, StatTile, TrendArea, useAletheia, useAletheiaScope } from "@/ui/kit";
import { ObjChip } from "./ObjChip";
import { day } from "./shared";

const pct = (n: number | null | undefined) => (n == null ? "-" : `${fixed(n, 0)}%`);

function Wait({ q, children }: { q: { isLoading: boolean; isError: boolean }; children: React.ReactNode }) {
  if (q.isLoading) return <Skeleton lines={4} label={t("Loading")} />;
  if (q.isError) return <EmptyState heading={t("Not available yet")} body={t("This view could not be loaded.")} />;
  return <>{children}</>;
}

/** How the work is going: pace, where it sits, how long it takes, what keeps coming back. */
export function WorkAnalytics() {
  useInterfaceLang();
  const fx = useFixture();
  const chat = useAletheia();
  const k = (n: string) => ["v2", "work-analytics", n, fx];
  const burn = useQuery({ queryKey: k("burn"), queryFn: getBurndown, retry: false });
  const change = useQuery({ queryKey: k("change"), queryFn: getRunChange, retry: false });
  const roots = useQuery({ queryKey: k("roots"), queryFn: getRootCauses, retry: false });
  const ttf = useQuery({ queryKey: k("ttf"), queryFn: () => getTimeToFix(180), retry: false });
  const thr = useQuery({ queryKey: k("thr"), queryFn: getThroughput, retry: false });
  const rec = useQuery({ queryKey: k("rec"), queryFn: getRecurrence, retry: false });
  const qual = useQuery({ queryKey: k("qual"), queryFn: getProposalQuality, retry: false });
  const fb = useQuery({ queryKey: k("fb"), queryFn: () => getRuleFeedback(), retry: false });
  const b = burn.data;

  useAletheiaScope({
    key: "work-analytics", label: t("Asking about the work pace"), suggestions: [t("When will the backlog be clear?")],
    answer: () => ({
      text: b?.projected_finish ? t("At this pace the backlog clears on {d}.", { d: day(b.projected_finish) }) : t("There is no projected finish yet."),
      evidence: b ? [t("{n} open now", { n: b.open_now }), t("{n} fixed in 7 days", { n: b.fixed_7d })] : [], actions: [],
    }),
  });

  const dim = roots.data?.dimensions[0];
  return (
    <>
      <PageHeader title={t("Work analytics")} context={t("Pace, causes and quality of the fixing")}
        actions={<Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>} />
      <Wait q={burn}>
        {b ? (
          <>
            <dl className="mx-tiles">
              <StatTile label={t("Open now")} value={whole(b.open_now)} />
              <StatTile label={t("Fixed in 7 days")} value={whole(b.fixed_7d)} />
              <StatTile label={t("Per day")} value={fixed(b.pace_per_day, 1)} />
              <StatTile label={t("Projected finish")} value={b.projected_finish ? day(b.projected_finish) : "-"} />
            </dl>
            <Card title={t("Open issues over time")}>
              <TrendArea label={t("Open issues per day")} emptyLabel={t("No history yet")} points={b.days.map((d) => ({ axis: day(d.day), title: day(d.day), value: d.open }))} />
            </Card>
          </>
        ) : null}
      </Wait>
      <div className="mx-split">
        <div className="mx-col">
          <Card title={t("Since the last run")} sub={t("New, fixed and still failing, by object")}>
            <Wait q={change}>
              {change.data?.objects.length ? (
                <DataTable label={t("Since the last run")} rows={change.data.objects} rowKey={(r) => r.module}
                  columns={[
                    { key: "o", label: t("Object"), render: (r) => <ObjChip code={r.module} />, sort: (r) => r.module },
                    { key: "n", label: t("New"), render: (r) => whole(r.new), sort: (r) => r.new, align: "end" },
                    { key: "f", label: t("Fixed"), render: (r) => whole(r.fixed), sort: (r) => r.fixed, align: "end" },
                    { key: "s", label: t("Still failing"), render: (r) => whole(r.still_failing), sort: (r) => r.still_failing, align: "end" },
                  ]} />
              ) : <EmptyState heading={t("No run to compare yet")} />}
            </Wait>
          </Card>
          <Card title={t("Where the records sit")} sub={dim?.label}>
            <Wait q={roots}>
              {dim?.top.length ? <BarList label={t("Records by cause")} items={dim.top.map((x) => ({ id: x.value, label: x.value, value: x.records, display: whole(x.records) }))} /> : <EmptyState heading={t("No cause data yet")} />}
            </Wait>
          </Card>
          <Card title={t("Time to fix")} sub={t("Median days, last {n} days", { n: ttf.data?.window_days ?? 180 })}>
            <Wait q={ttf}>
              {ttf.data?.by_check.length ? (
                <DataTable label={t("Time to fix")} rows={ttf.data.by_check} rowKey={(r) => `${r.module}|${r.check_id}`}
                  columns={[
                    { key: "c", label: t("Rule"), render: (r) => <FieldChip code={r.check_id} description={r.module} /> },
                    { key: "f", label: t("Fixed"), render: (r) => whole(r.fixed), sort: (r) => r.fixed, align: "end" },
                    { key: "m", label: t("Median days"), render: (r) => (r.median_days == null ? "-" : fixed(r.median_days, 1)), sort: (r) => r.median_days ?? 0, align: "end" },
                    { key: "p", label: t("Slowest tenth"), render: (r) => (r.p90_days == null ? "-" : fixed(r.p90_days, 1)), sort: (r) => r.p90_days ?? 0, align: "end" },
                  ]} />
              ) : <EmptyState heading={t("Nothing fixed in this window")} />}
            </Wait>
          </Card>
        </div>
        <div className="mx-col">
          <Card title={t("Who fixes")} sub={t("Decisions per person")}>
            <Wait q={thr}>
              {thr.data?.people.length ? (
                <DataTable label={t("Who fixes")} rows={thr.data.people} rowKey={(r) => r.person}
                  columns={[
                    { key: "p", label: t("Person"), render: (r) => r.person, sort: (r) => r.person },
                    { key: "t", label: t("Decisions"), render: (r) => whole(r.total), sort: (r) => r.total, align: "end" },
                    { key: "a", label: t("Accepted"), render: (r) => whole(r.accept), align: "end" },
                    { key: "e", label: t("Edited"), render: (r) => whole(r.edit), align: "end" },
                  ]} />
              ) : <EmptyState heading={t("No decisions yet")} />}
            </Wait>
          </Card>
          <Card title={t("What comes back")} sub={t("Reopened {p} of issues", { p: pct(rec.data?.totals.rate_pct) })}>
            <Wait q={rec}>
              {rec.data?.by_check.length ? (
                <DataTable label={t("What comes back")} rows={rec.data.by_check} rowKey={(r) => `${r.module}|${r.check_id}`}
                  columns={[
                    { key: "c", label: t("Rule"), render: (r) => <FieldChip code={r.check_id} description={r.module} /> },
                    { key: "i", label: t("Issues"), render: (r) => whole(r.issues), align: "end" },
                    { key: "r", label: t("Reopened"), render: (r) => pct(r.rate_pct), sort: (r) => r.rate_pct, align: "end" },
                  ]} />
              ) : <EmptyState heading={t("Nothing has come back")} />}
            </Wait>
          </Card>
          <Card title={t("Proposal quality")} sub={t("How often each source is right")}>
            <Wait q={qual}>
              {qual.data?.sources.length ? (
                <DataTable label={t("Proposal quality")} rows={qual.data.sources} rowKey={(r) => r.source}
                  columns={[
                    { key: "s", label: t("Source"), render: (r) => r.source },
                    { key: "p", label: t("Proposed"), render: (r) => whole(r.proposed), align: "end" },
                    { key: "a", label: t("Approved"), render: (r) => pct(r.approval_rate_pct), align: "end" },
                    { key: "f", label: t("Fixed"), render: (r) => pct(r.fix_rate_pct), align: "end" },
                  ]} />
              ) : <EmptyState heading={t("No proposals yet")} />}
            </Wait>
          </Card>
          <Card title={t("Rule feedback")} sub={t("Rules people mark as wrong")}>
            <Wait q={fb}>
              {fb.data?.rules.length ? (
                <DataTable label={t("Rule feedback")} rows={fb.data.rules} rowKey={(r) => r.check_id}
                  columns={[
                    { key: "c", label: t("Rule"), render: (r) => <FieldChip code={r.check_id} /> },
                    { key: "f", label: t("Flagged"), render: (r) => whole(r.flagged), align: "end" },
                    { key: "w", label: t("Wrong"), render: (r) => pct(r.false_positive_rate == null ? null : r.false_positive_rate * 100), align: "end" },
                  ]} />
              ) : <EmptyState heading={t("No feedback yet")} />}
            </Wait>
          </Card>
        </div>
      </div>
    </>
  );
}
