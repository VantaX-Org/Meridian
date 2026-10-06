"use client";

/** Rule coverage for one object by SAP maintenance view and table (E1b). */

import { Fragment, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Banner, EmptyState, Mono, PageHeader, SectionCard, StatusBadge, TableSkeleton, Tally } from "@/components/ui-core";
import { PageCrumb } from "@/components/shell/page-crumb";
import { getModuleCoverage, type ModuleCoverage } from "@/lib/api/rules";
import { DIMENSIONS, formatModuleName, labelOf } from "@/lib/format";
import { MM_VIEWS } from "@/lib/material-views";
import { Count, plural, qs, RULES } from "./coverage-shared";

export function ObjectCoverage({ object }: { object: string }) {
  const name = formatModuleName(object);
  const q = useQuery({ queryKey: ["rules.coverage.module", object], queryFn: () => getModuleCoverage(object, { enabled: true }), retry: false });
  const crumb = (
    <PageCrumb segments={[
      { level: "portfolio", label: "Portfolio", href: "/" },
      { level: "page", label: "Rule coverage", href: "/analyse/coverage" },
      { level: "object", label: name },
    ]} />
  );
  return (
    <div className="ui-page">
      {crumb}
      <PageHeader title={`Rule coverage: ${name}`}
        summary={q.data ? `${plural(q.data.totals.rules, "enabled rule")} on ${name}.` : `Rules on ${name} by SAP view and table.`} />
      {q.isLoading ? <TableSkeleton rows={8} label={`Reading ${name} coverage`} />
        : q.error || !q.data ? <Banner tone="danger" title={`${name} has no rules`}>{(q.error as Error | null)?.message ?? "No rules found."}</Banner>
        : !q.data.has_view_map ? <EmptyState action={<Link className="ui-link" href="/analyse/coverage">All objects</Link>}>No SAP view map for this object yet.</EmptyState>
        : <Views object={object} d={q.data} />}
    </div>
  );
}

function Views({ object, d }: { object: string; d: ModuleCoverage }) {
  const [open, setOpen] = useState<string | null>(null);
  const t = d.totals;
  const base = (extra: Record<string, string>) => `${RULES}?${qs({ module: object, ...extra })}`;
  const views = d.views.filter((v) => v.total > 0);
  const label = (id: string) => MM_VIEWS.find((v) => v.id === id)?.label;
  return (
    <>
      <Tally level={2} label={`${formatModuleName(object)} coverage`} figures={[
        { label: "Rules enabled", value: t.rules, href: base({}), verdict: "Rules on this object that run on every analysis." },
        { label: "Views covered", value: t.views, href: "#views", verdict: `${t.views.toLocaleString()} of ${t.views_total.toLocaleString()} maintenance views have a rule.` },
        { label: "Tables covered", value: t.tables, href: "#views", verdict: "SAP tables the rules read." },
        { label: "Never run", value: t.never_run, tone: t.never_run ? "warning" : undefined, href: "/sync", verdict: "Enabled rules no analysis has evaluated yet." },
      ]} />
      <section id="views">
        <SectionCard title="Rules per view and table" meta={`${views.length.toLocaleString()} views, ${t.tables.toLocaleString()} tables`} flush>
          <div className="ui-matrix-scroll">
            <table className="ui-cov">
              <caption className="ui-visually-hidden">Rules per SAP view and table</caption>
              <thead><tr><th scope="col">View</th><th scope="col">Rules</th><th scope="col">Tables</th></tr></thead>
              <tbody>
                {views.map((v) => (
                  <Fragment key={v.view}>
                    <tr>
                      <th scope="row">
                        <button type="button" className="ui-cov__expand" aria-expanded={open === v.view} onClick={() => setOpen(open === v.view ? null : v.view)}>
                          {label(v.view) ?? v.label}
                        </button>
                      </th>
                      <Count n={v.total} thin={false} label={v.label} href={base({ view: v.view })} />
                      <td>
                        <span className="ui-cov__tables">
                          {v.tables.map((tb) => (
                            <Link key={tb.table} className="ui-link" href={base({ table: tb.table, view: v.view })}>
                              <Mono>{tb.table}</Mono><span className="aurora-number ui-chip-count">{tb.count.toLocaleString()}</span>
                            </Link>
                          ))}
                        </span>
                      </td>
                    </tr>
                    {open === v.view ? (
                      <tr className="ui-cov__rules">
                        <td colSpan={3}>
                          <ul aria-label={`Rules in ${v.label}`}>
                            {v.rules.map((r) => (
                              <li key={r.check_id}>
                                <Link className="ui-link" href={`/analyse/rule/${encodeURIComponent(r.check_id)}?module=${encodeURIComponent(object)}`}>
                                  <Mono>{r.check_id}</Mono> {r.message ?? ""}
                                </Link>
                                {r.last_pass_rate == null ? <> <StatusBadge status="idle">Not run</StatusBadge></> : null}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </section>
      <SectionCard title="Dimension by view" meta={`${views.length.toLocaleString()} views, ${DIMENSIONS.length} dimensions`} flush>
        <div className="ui-matrix-scroll">
          <table className="ui-cov">
            <caption className="ui-visually-hidden">Rules per view and dimension</caption>
            <thead><tr><th scope="col">View</th>{DIMENSIONS.map((x) => <th key={x.id} scope="col">{x.label}</th>)}</tr></thead>
            <tbody>
              {views.map((v) => (
                <tr key={v.view}>
                  <th scope="row">{label(v.view) ?? v.label}</th>
                  {DIMENSIONS.map((x) => (
                    <Count key={x.id} n={d.dimension_by_view[v.view]?.[x.id] ?? 0} label={`${v.label}, ${labelOf(x.id)}`} href={base({ view: v.view, dimension: x.id })} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </>
  );
}
