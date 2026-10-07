"use client";

/**
 * Rule coverage: where the rule library is deep and where it is thin.
 * E1: every object by dimension, as plain counts that open the rules behind them.
 * E1b (?object=material_master): one object by SAP maintenance view and table.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Tooltip } from "@/components/aurora";
import { Banner, EmptyState, FilterBar, PageHeader, SectionCard, TableSkeleton, Tally } from "@/components/ui-core";
import { PageCrumb } from "@/components/shell/page-crumb";
import { useUrlState } from "@/hooks/use-url-state";
import { getConfigAwareScore, type ConfigAwareModule } from "@/lib/api/config-load";
import { getSystems } from "@/lib/api/connectivity";
import { getRuleCoverage, type CoverageObject } from "@/lib/api/rules";
import { checkClassLabel, DIMENSIONS, formatModuleName } from "@/lib/format";
import { ObjectCoverage } from "./coverage-object";
import { Count, plural, qs, RULES } from "./coverage-shared";

const SYSTEMS: Record<string, string> = { ecc: "ECC", successfactors: "SuccessFactors", warehouse: "Warehouse" };
const AUTHORITIES: Record<string, string> = { sap_hard_constraint: "SAP hard constraint", best_practice: "Best practice", regulatory: "Regulatory", iso_standard: "ISO standard", s4hana_migration: "S/4HANA migration", customer_configured: "Customer configured" };

export function RuleCoverage() {
  const [object] = useUrlState("object", "");
  return object ? <ObjectCoverage object={object} /> : <Matrix />;
}

function ConfigCells({ m }: { m: ConfigAwareModule | undefined }) {
  if (!m) return <><td>{"—"}</td><td>{"—"}</td><td>{"—"}</td><td>{"—"}</td></>;
  const reason = m.not_applicable_reasons[0]?.reason;
  return (
    <>
      <td className="aurora-number">{(m.applicable - m.by_default).toLocaleString()}</td>
      <td className="aurora-number">{m.by_default.toLocaleString()}</td>
      <td className="aurora-number">{m.not_applicable === 0 ? "–" : reason ? <Tooltip label={reason} fallback>{m.not_applicable.toLocaleString()}</Tooltip> : m.not_applicable.toLocaleString()}</td>
      <td className="aurora-number">{m.applicable === 0 ? "—" : `${m.passes.toLocaleString()} of ${m.applicable.toLocaleString()}`}</td>
    </>
  );
}

function Matrix() {
  const router = useRouter();
  const [sort, setSort] = useUrlState("sort", "total:desc");
  const [system, setSystem] = useUrlState("system", "");
  const [authority, setAuthority] = useUrlState("authority", "");
  const [checkClass, setCheckClass] = useUrlState("check_class", "");
  const [state, setState] = useUrlState("state", "");
  const q = useQuery({
    queryKey: ["rules.coverage", { system, authority, checkClass, state }],
    queryFn: () => getRuleCoverage({ system: system || undefined, authority: authority || undefined, check_class: checkClass || undefined, enabled: state ? state === "enabled" : undefined }),
  });
  const [cfgSystem, setCfgSystem] = useUrlState("config_system", "");
  const systems = useQuery({ queryKey: ["systems"], queryFn: getSystems, meta: { ignoreError: true } });
  const aware = useQuery({ queryKey: ["config-aware-score", "coverage", cfgSystem], retry: false, meta: { ignoreError: true },
    queryFn: () => getConfigAwareScore({ system_id: cfgSystem || undefined }) });
  const awareByModule = useMemo(() => new Map((aware.data?.modules ?? []).map((m) => [m.module, m])), [aware.data]);
  const [key, dir] = sort.split(":");
  const rows = useMemo(() => {
    const val = (o: CoverageObject) => (key === "object" ? formatModuleName(o.module) : key === "total" ? o.total : o.by_dimension[key] ?? 0);
    const sign = dir === "asc" ? 1 : -1;
    return [...(q.data?.objects ?? [])].sort((a, b) => {
      const x = val(a), y = val(b);
      return (typeof x === "string" ? x.localeCompare(String(y)) : (x as number) - (y as number)) * sign || a.module.localeCompare(b.module);
    });
  }, [q.data, key, dir]);
  const clickSort = (k: string) => setSort(key === k && dir === "desc" ? `${k}:asc` : `${k}:desc`);
  const filtered = !!(system || authority || checkClass || state);
  const clear = () => { setSystem(""); setAuthority(""); setCheckClass(""); setState(""); };
  const t = q.data?.totals;
  const filterQs = { category: system, authority: authority === "customer_configured" ? "customer" : authority ? "shipped" : "", check: checkClass };
  const groups = [
    { id: "system", label: "System", value: system, allLabel: "All systems", onChange: setSystem, options: Object.entries(SYSTEMS).map(([value, label]) => ({ value, label })) },
    { id: "authority", label: "Authority", value: authority, allLabel: "All authorities", onChange: setAuthority, options: Object.entries(AUTHORITIES).map(([value, label]) => ({ value, label })) },
    { id: "check_class", label: "Check type", value: checkClass, allLabel: "All check types", onChange: setCheckClass,
      options: (q.data?.check_classes ?? []).filter((c) => c.check_class).map((c) => ({ value: c.check_class!, label: checkClassLabel(c.check_class!), count: c.count })) },
    { id: "state", label: "State", value: state, allLabel: "Enabled and disabled", onChange: setState, options: [{ value: "enabled", label: "Enabled" }, { value: "disabled", label: "Disabled" }] },
  ];
  if ((systems.data?.length ?? 0) > 1) {
    groups.push({ id: "config_system", label: "Configuration", value: cfgSystem, allLabel: "All systems", onChange: setCfgSystem,
      options: (systems.data ?? []).map((x) => ({ value: x.id, label: x.name })) });
  }
  const chart = (q.data?.check_classes ?? []).filter((c) => c.check_class).slice(0, 12).map((c) => ({ type: checkClassLabel(c.check_class!), rules: c.count, id: c.check_class! }));

  return (
    <div className="ui-page">
      <PageCrumb segments={[{ level: "portfolio", label: "Portfolio", href: "/" }, { level: "page", label: "Rule coverage" }]} />
      <PageHeader title="Rule coverage"
        summary={t ? `${plural(t.rules, "rule")} across ${plural(t.objects, "object")}. Open a count to see its rules.` : "Rules per object and dimension."} />
      <Tally level={2} label="Rule library coverage" figures={[
        { label: "Rules enabled", value: t?.enabled ?? null, loading: q.isLoading, href: `${RULES}?${qs({ ...filterQs })}`, verdict: t ? `${t.enabled.toLocaleString()} of ${t.rules.toLocaleString()} rules run on every analysis.` : "" },
        { label: "Objects covered", value: t?.objects ?? null, loading: q.isLoading, href: "#matrix", verdict: t ? `${t.shipped.toLocaleString()} rules ship with Meridian.` : "" },
        { label: "Dimensions thin", value: t?.thin_cells ?? null, loading: q.isLoading, tone: t?.thin_cells ? "warning" : undefined, href: "#matrix", verdict: "Object and dimension pairs with under five rules." },
        { label: "Never run", value: t?.never_run ?? null, loading: q.isLoading, tone: t?.never_run ? "warning" : undefined, href: "/sync", verdict: "Enabled rules no analysis has evaluated yet." },
      ]} />
      <FilterBar groups={groups} onClear={filtered ? clear : undefined} />
      {q.error ? <Banner tone="danger" title="Coverage could not be read">{(q.error as Error).message}</Banner> : null}
      <section id="matrix">
        <SectionCard title="Rules per object and dimension" meta={t ? `${t.objects.toLocaleString()} objects, ${DIMENSIONS.length} dimensions` : undefined} flush>
          {q.isLoading ? <TableSkeleton rows={8} label="Reading rule coverage" /> : rows.length === 0 ? (
            <EmptyState action={filtered ? <button type="button" className="ui-link-button" onClick={clear}>Clear filters</button> : undefined}>No rules match these filters.</EmptyState>
          ) : (
            <div className="ui-matrix-scroll">
              <table className="ui-cov">
                <caption className="ui-visually-hidden">Rules per object and dimension</caption>
                <thead>
                  <tr>
                    <th scope="col" aria-sort={key === "object" ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                      <button type="button" className="ui-cov__sort" aria-pressed={key === "object"} onClick={() => clickSort("object")}>Object</button>
                    </th>
                    {DIMENSIONS.map((d) => (
                      <th key={d.id} scope="col" aria-sort={key === d.id ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                        <button type="button" className="ui-cov__sort" aria-pressed={key === d.id} onClick={() => clickSort(d.id)}>{d.label}</button>
                      </th>
                    ))}
                    <th scope="col" aria-sort={key === "total" ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                      <button type="button" className="ui-cov__sort" aria-pressed={key === "total"} onClick={() => clickSort("total")}>Total</button>
                    </th>
                    <th scope="col">Configured</th>
                    <th scope="col">Applies by default</th>
                    <th scope="col">Does not apply</th>
                    <th scope="col">Passing applicable</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.module}>
                      <th scope="row"><Link className="ui-link" href={`/analyse/coverage?object=${encodeURIComponent(o.module)}`}>{formatModuleName(o.module)}</Link></th>
                      {DIMENSIONS.map((d) => (
                        <Count key={d.id} n={o.by_dimension[d.id] ?? 0} label={`${formatModuleName(o.module)}, ${d.label}`}
                          href={`${RULES}?${qs({ module: o.module, dimension: d.id, ...filterQs })}`} />
                      ))}
                      <Count n={o.total} thin={false} label={formatModuleName(o.module)} href={`${RULES}?${qs({ module: o.module, ...filterQs })}`} />
                      <ConfigCells m={awareByModule.get(o.module)} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </section>
      <SectionCard title="Rules by check type" meta="Select a bar to open its rules">
        {chart.length === 0 ? <EmptyState>No rules to chart.</EmptyState> : (
          <BarChart data={chart} xKey="type" series={[{ key: "rules", label: "Rules" }]} height={280} ariaLabel="Rules by check type"
            onBarClick={(i) => router.push(`${RULES}?${qs({ check: chart[i].id })}`)} />
        )}
      </SectionCard>
    </div>
  );
}

