"use client";

import "./tabs-g.css";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFieldLineage } from "@/lib/api/v2/field-lineage";
import { useFixture } from "@/lib/api/v2/fixture";
import { useOpenItem } from "@/lib/v2/hooks";
import { buildLineage, COLUMN_TITLES, type LineageGraph, type LineageNode, type NodeKind } from "@/lib/v2/lineage-graph";
import { useConfigImpact } from "@/lib/v2/object-queries";
import { useObjectRules, useReceipt } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { ListSearch } from "@/design/next/more/states";
import { Button, Code, DataTable, EmptyState, ErrorState, Skeleton, StatCard, type Column } from "../../kit";
import { SegBar } from "../../kit/viz";
import type { ObjectRun } from "../useObjectRun";

const KINDS: NodeKind[] = ["table", "field", "rule", "feature"];
const trim = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const SHOWN_RULES = 3;

/** The graph as a standalone SVG file: the page's colours resolved, no stylesheet needed. */
export function svgFileOf(svg: SVGSVGElement): string {
  const cs = getComputedStyle(svg);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.removeAttribute("class");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = [
    `rect.bg{fill:${v("--nx-surface", "white")};stroke:none}`,
    `rect{fill:none;stroke:${v("--nx-border", "gray")};stroke-width:1}`,
    `line{stroke:${v("--nx-ink-3", "gray")};stroke-width:1}`,
    `text{fill:${v("--nx-ink", "black")};font-size:12px;font-family:sans-serif}`,
    `text.h{fill:${v("--nx-ink-3", "gray")}}`,
  ].join("");
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("class", "bg");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  clone.insertBefore(style, clone.firstChild);
  clone.insertBefore(bg, style.nextSibling);
  return new XMLSerializer().serializeToString(clone);
}

function download(text: string, name: string): boolean {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

function Node({ n, on, dim, hot, onEnter, onLeave, onPick, href }: { n: LineageNode; on: boolean; dim: boolean; hot: boolean; onEnter: () => void; onLeave: () => void; onPick: () => void; href: string | null }) {
  const label = trim(n.label, n.kind === "feature" ? 38 : 20);
  const inner = (
    <>
      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={4} />
      <text x={n.x + 8} y={n.y + 17}>{label}</text>
    </>
  );
  const common = { className: "nx-tg-node", "data-node": n.id, "data-kind": n.kind, "data-hot": on || hot ? "true" : undefined, "data-dim": dim ? "true" : undefined, onMouseEnter: onEnter, onMouseLeave: onLeave, onFocus: onEnter, onBlur: onLeave } as const;
  if (href && n.open) {
    return (
      <Link href={href} aria-label={`${n.kind === "rule" ? t("Rule") : t("Feature")} ${n.label}`} {...common}>
        {inner}
      </Link>
    );
  }
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={hot}
      aria-label={`${n.kind === "table" ? t("Table") : t("Field")} ${n.label}`}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
      {...common}
    >
      {inner}
    </g>
  );
}

/** The lineage graph with its facts list. Pure over `graph`, so a test can draw it without any read. */
export function LineageView({ graph, label }: { graph: LineageGraph; label: string }) {
  const { hrefFor } = useOpenItem();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const activeId = hover ?? pinned;
  const active = graph.nodes.find((n) => n.id === activeId) ?? null;
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const counts = KINDS.map((k) => graph.nodes.filter((n) => n.kind === k).length);
  const linked = (n: LineageNode): boolean => active != null && (n.id === active.id || graph.edges.some((e) => (e.from === active.id && e.to === n.id) || (e.to === active.id && e.from === n.id)));
  const hrefOf = (n: LineageNode): string | null => (n.open ? hrefFor({ kind: n.open.kind, id: n.open.id }) : null);

  const exportSvg = () => {
    if (!svgRef.current) return;
    const ok = download(svgFileOf(svgRef.current), `lineage-${label.toLowerCase().replace(/\s+/g, "-")}.svg`);
    setNote(ok ? t("The lineage was saved as an SVG file.") : t("This browser cannot save the file."));
  };

  return (
    <section className="nx-card nx-tg-sec" aria-label={t("Lineage graph, scrollable")}>
      <div className="nx-tg-stats">
        {KINDS.map((k, i) => (
          <StatCard key={k} label={COLUMN_TITLES[k]} value={counts[i]} />
        ))}
      </div>
      <div className="nx-tg-split">
        <div className="nx-tg-graph">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${graph.width} ${graph.height}`}
            width={graph.width}
            height={graph.height}
            role="group"
            aria-label={t("Lineage of {label}: {counts} tables, {counts2} fields, {counts3} rules, {counts4} S/4 features", { label, counts: counts[0], counts2: counts[1], counts3: counts[2], counts4: counts[3] })}
            data-testid="lineage-graph"
          >
            {KINDS.map((k) => {
              const first = graph.nodes.find((n) => n.kind === k);
              return first ? (
                <text key={k} x={first.x} y={14} className="nx-tg-coltitle h">
                  {COLUMN_TITLES[k]}
                </text>
              ) : null;
            })}
            {graph.edges.map((e) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const on = active != null && (e.from === active.id || e.to === active.id);
              return <line key={`${e.from}>${e.to}`} className="nx-tg-edge" x1={a.x + a.w} y1={a.y + a.h / 2} x2={b.x} y2={b.y + b.h / 2} data-edge={`${e.from}>${e.to}`} data-hot={on ? "true" : undefined} />;
            })}
            {graph.nodes.map((n) => (
              <Node key={n.id} n={n} on={linked(n)} dim={active != null && !linked(n)} hot={pinned === n.id} onEnter={() => setHover(n.id)} onLeave={() => setHover((h) => (h === n.id ? null : h))} onPick={() => setPinned((p) => (p === n.id ? null : n.id))} href={hrefOf(n)} />
            ))}
          </svg>
        </div>
        <aside className="nx-tg-stack" aria-label={t("Facts of the node")}>
          <div className="nx-tg-head">
            <h3>{active ? active.label : t("Node facts")}</h3>
          </div>
          {active ? (
            <>
              <div className="nx-tg-facts">
                <dl data-testid="node-facts">
                  {active.facts.map(([k, v]) => (
                    <div key={k} style={{ display: "contents" }}>
                      <dt>{k}</dt>
                      <dd>{v || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              {(["upstream", "downstream"] as const).map((dir) => {
                const ids = graph.edges.filter((e) => (dir === "upstream" ? e.to : e.from) === active.id).map((e) => (dir === "upstream" ? e.from : e.to));
                const ns = ids.map((id) => byId.get(id)).filter((n): n is LineageNode => n != null);
                return (
                  <div key={dir} className="nx-tg-l2" data-testid={`node-${dir}`}>
                    <h3>
                      <span>{dir === "upstream" ? t("Upstream") : t("Downstream")}</span>
                      <span className="nx-tg-sub">{ns.length}</span>
                    </h3>
                    {ns.length === 0 ? (
                      <p className="nx-tg-prov">{t("None")}</p>
                    ) : (
                      <ul className="nx-tg-list">
                        {ns.map((n) => (
                          <li key={n.id}>
                            <button type="button" className="nx-link" onClick={() => setPinned(n.id)}>
                              {n.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              {active.open ? (
                <Link href={hrefOf(active) ?? "#"} className="nx-link">
                  {active.open.kind === "rule" ? t("Open the rule") : t("Open the feature")}
                </Link>
              ) : null}
            </>
          ) : (
            <p className="nx-tg-prov">{t("Hover or focus a node to see its facts here. Click a rule or a feature to open it.")}</p>
          )}
          <div className="nx-tg-row">
            <Button onClick={exportSvg} icon="download">
              {t("Export as SVG")}
            </Button>
          </div>
          {note ? (
            <p role="status" className="nx-tg-prov">
              {note}
            </p>
          ) : null}
        </aside>
      </div>
      <p className="nx-tg-prov">
        {t("Drawn from the {shown} failing {shown, plural, one {rule} other {rules}} of {label} with the highest value at risk{value}. Features come from the impact model of the current run.", { shown: graph.shown, label, value: graph.hidden > 0 ? t("; {hidden} more are not drawn", { hidden: int(graph.hidden) }) : "" })}
      </p>
    </section>
  );
}

type FlRow = { tb: { table: string; text: string }; r: import("@/lib/api/v2/field-lineage").FieldLineageRow };

/** Field lineage: every field the object extracts, its business term, the check table it points to and who owns that
 *  table, with the rules that read the field. From the SAP data dictionary, never guessed. */
export function FieldLineagePanel({ module, labelOf }: { module: string; labelOf: (module: string) => string }) {
  const fixture = useFixture();
  const { hrefFor } = useOpenItem();
  const [filter, setFilter] = useState("");
  const q = useQuery({ queryKey: ["field-lineage", module, fixture], queryFn: () => getFieldLineage(module), staleTime: 300_000 });
  const rows = useMemo<FlRow[]>(() => {
    const f = filter.trim().toUpperCase();
    return (q.data?.tables ?? []).flatMap((tb) =>
      tb.fields
        .filter((r) => !f || `${tb.table}.${r.field}`.includes(f) || r.text.toUpperCase().includes(f) || r.glossary_terms.some((g) => g.toUpperCase().includes(f)))
        .map((r) => ({ tb, r })),
    );
  }, [q.data, filter]);

  const title = t("Field lineage");
  if (q.isPending) {
    return (
      <section aria-label={title} className="nx-card nx-tg-sec" data-testid="field-lineage-loading">
        <Skeleton lines={4} />
      </section>
    );
  }
  if (q.isError) return <ErrorState sentence={t("The field lineage could not be read.")} error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (d.tables.length === 0) return <EmptyState heading={title}>{t("No extracted tables are registered for this object, so there is no field lineage to show.")}</EmptyState>;
  const owner = (o: string | null | undefined): string => (o == null ? "" : o === "configuration" ? t("Configuration") : labelOf(o));
  const columns: Column<FlRow>[] = [
    { id: "table", label: t("Table"), compare: (a, b) => a.tb.table.localeCompare(b.tb.table), cell: ({ tb }) => <Code code={tb.table} text={tb.text} /> },
    {
      id: "field", label: t("Field"), compare: (a, b) => a.r.field.localeCompare(b.r.field),
      cell: ({ r }) => (
        <span>
          <span className="nx-mono">{r.field}</span>
          {r.key ? <span className="nx-tg-sub"> {t("key")}</span> : null}
          {!r.in_dictionary ? <span className="nx-tg-sub"> {t("not in the dictionary")}</span> : null}
        </span>
      ),
    },
    {
      id: "term", label: t("Business term"),
      cell: ({ r }) => (
        <span>
          {r.glossary_terms.length ? r.glossary_terms.join(", ") : r.text || "-"}
          {r.glossary_terms.length && r.text ? <span className="nx-tg-sub"> ({r.text})</span> : null}
        </span>
      ),
    },
    { id: "check", label: t("Check table"), cell: ({ r }) => (r.check_table ? <Code code={r.check_table} text={r.check_table_text ?? undefined} /> : <span className="nx-tg-dash">-</span>) },
    { id: "owner", label: t("Owner"), cell: ({ r }) => owner(r.owner) || <span className="nx-tg-dash">-</span> },
    {
      id: "rules", label: t("Rules"), align: "end", compare: (a, b) => a.r.rule_count - b.r.rule_count,
      cell: ({ r }) =>
        r.rule_count ? (
          <span>
            {int(r.rule_count)}{" "}
            {r.rule_ids.slice(0, SHOWN_RULES).map((id) => (
              <Link key={id} href={hrefFor({ kind: "rule", id })} className="nx-link nx-mono">
                {id}{" "}
              </Link>
            ))}
          </span>
        ) : (
          <span className="nx-tg-dash">0</span>
        ),
    },
  ];
  return (
    <section aria-label={title} className="nx-card nx-tg-sec" data-testid="field-lineage">
      <div className="nx-tg-head">
        <h2 className="nx-sec-h">{title}</h2>
        <span className="nx-tg-sub">
          {t("{fields} {fields, plural, one {field} other {fields}} in {tables} {tables, plural, one {table} other {tables}}, {fks} {fks, plural, one {check table link} other {check table links}}, dictionary {release}", { fields: d.totals.fields, tables: d.totals.tables, fks: d.totals.foreign_keys, release: d.release })}
        </span>
      </div>
      <SegBar
        testid="field-lineage-coverage"
        segs={[
          { key: "rules", label: t("Rules"), value: d.totals.fields_with_rules, tone: "good" },
          { key: "none", label: t("None"), value: Math.max(0, d.totals.fields - d.totals.fields_with_rules), tone: "quiet" },
        ]}
      />
      <div className="nx-tg-row" data-testid="field-lineage-filter-wrap">
        <ListSearch value={filter} onChange={setFilter} label={t("Filter fields")} />
      </div>
      {rows.length === 0 ? (
        <p className="nx-tg-prov">{t("No field matches that filter.")}</p>
      ) : (
        <DataTable rows={rows} columns={columns} rowKey={({ tb, r }) => `${tb.table}.${r.field}`} rowLabel={({ tb, r }) => `${tb.table}.${r.field}`} caption={t("Table, field, business term, check table, owner and the rules that read each field")} density="compact" />
      )}
      <p className="nx-tg-prov">{t("{n} {n, plural, one {field is} other {fields are}} read by rules. A check table owned by configuration is customizing; one owned by an object is master data that must load first.", { n: d.totals.fields_with_rules })}</p>
    </section>
  );
}

/** The Lineage tab: where the object's fields come from, which rules read them and which S/4 features those rules block. */
export function LineageTab({ o }: { o: ObjectRun }) {
  const apiModule = o.module;
  const label = o.label;
  const receiptQ = useReceipt(apiModule, o.runId);
  const rulesQ = useObjectRules(apiModule, o.runId);
  const impactQ = useConfigImpact(receiptQ.data?.run_id);
  const graph = useMemo(() => buildLineage(rulesQ.data ?? [], impactQ.data ?? [], apiModule), [rulesQ.data, impactQ.data, apiModule]);
  const objects = o.landscape.data?.objects;
  const labelOf = (m: string): string => objects?.find((x) => x.module === m)?.label ?? m.replace(/_/g, " ");
  const fields = <FieldLineagePanel module={apiModule} labelOf={labelOf} />;

  if (rulesQ.isError) return <ErrorState sentence={t("The lineage of {label} could not be read.", { label })} error={rulesQ.error} onRetry={() => void rulesQ.refetch()} />;
  if (rulesQ.isPending || (receiptQ.isPending && !receiptQ.isError)) {
    return (
      <div aria-busy="true" data-testid="lineage-loading">
        <Skeleton lines={6} />
      </div>
    );
  }
  if (graph.nodes.length === 0) {
    return (
      <div className="nx-tg" data-testid="tab-lineage">
        <EmptyState
          heading={t("Field lineage")}
          action={
            <Link href="/runs" className="nx-link">
              {t("Open the runs")}
            </Link>
          }
        >
          {t("Lineage for {label} fills when an analysis finds failing rules: it draws the tables and fields those rules read and the S/4HANA features they block or degrade.", { label })}
        </EmptyState>
        {fields}
      </div>
    );
  }
  return (
    <div className="nx-tg" data-testid="tab-lineage">
      {impactQ.isError ? <ErrorState sentence={t("The S/4 features could not be read for this run, so the graph stops at the rules.")} error={impactQ.error} onRetry={() => void impactQ.refetch()} /> : null}
      <LineageView graph={graph} label={label} />
      {fields}
    </div>
  );
}
