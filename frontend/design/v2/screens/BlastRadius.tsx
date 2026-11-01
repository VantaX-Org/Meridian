"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getBlastRadius, getRuleLineage } from "@/lib/api/v2/lineage";
import { useMoney } from "@/lib/v2/step9-queries";
import { BLAST_COLUMNS, blastModel, pathThrough, type BlastColumn, type BlastNode } from "@/lib/v2/blast-radius";
import { moneyCompactText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { t as tr } from "@/lib/v2/i18n";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";

const HEADINGS: Record<BlastColumn, () => string> = {
  field: () => tr("Fields read"),
  step: () => tr("Process steps"),
  feature: () => tr("S/4HANA features"),
  kpi: () => tr("KPIs"),
};

/**
 * Blast radius, the rule canvas's signature view: one bad field traced through the process steps it feeds, the S/4HANA
 * features those steps enable and the KPIs they drive, with the documents in flight per step and the money per feature.
 * Selecting a node lights its path end to end.
 */
export function BlastRadius({ checkId, versionId, failing, fixHref }: { checkId: string; versionId: string | null; failing: number; fixHref: string }) {
  const f = useFixture();
  const graph = useQuery({ queryKey: ["v2", "lineage", "graph", f, checkId], queryFn: () => getRuleLineage(checkId), staleTime: 300_000, retry: false });
  const blast = useQuery({
    queryKey: ["v2", "lineage", "blast", f, versionId, checkId],
    queryFn: () => getBlastRadius(versionId as string, checkId),
    staleTime: 60_000,
    retry: false,
    enabled: Boolean(versionId) && failing > 0,
  });
  const money = useMoney("landscape", null);

  const model = useMemo(() => {
    if (!graph.data) return null;
    const mine = (money.data?.features ?? []).filter((m) => m.blocking_rules.includes(checkId));
    return blastModel(graph.data, blast.data ?? null, mine);
  }, [graph.data, blast.data, money.data, checkId]);

  if (graph.isPending) return <Skeleton width="100%" height={420} />;
  if (graph.isError || !model) {
    return <ErrorFrame onRetry={() => void graph.refetch()}>{tr("The lineage of this rule could not be read. The lineage model may not cover it yet.")}</ErrorFrame>;
  }
  if (!model.nodes.some((n) => n.col !== "field")) {
    return <EmptyFrame>{tr("The lineage model maps no process step or feature to the fields this rule reads.")}</EmptyFrame>;
  }

  const currency = money.data?.currency ?? null;
  const steps = model.nodes.filter((n) => n.col === "step");
  const touched = steps.filter((n) => (n.documents ?? 0) > 0).length;
  return (
    <div className="m2-br" data-testid="blast-radius">
        <dl className="m2-br-figs">
          <div>
            <dt>{tr("Failing records")}</dt>
            <dd>{int(failing)}</dd>
          </div>
          <div>
            <dt>{tr("Documents in flight")}</dt>
            <dd>{model.documents == null ? <Dash /> : int(model.documents)}</dd>
          </div>
          <div>
            <dt>{tr("Process steps touched")}</dt>
            <dd>{model.documents == null ? <Dash /> : tr("{n} of {total}", { n: int(touched), total: int(steps.length) })}</dd>
          </div>
          <div>
            <dt>{tr("Features blocked")}</dt>
            <dd>{money.data ? int(model.blocked) : <Dash />}</dd>
          </div>
          <div>
            <dt>{tr("Cost a month")}</dt>
            <dd>{model.perMonth == null ? <Dash /> : moneyCompactText(model.perMonth, currency)}</dd>
          </div>
          {failing > 0 ? (
            <V2Link href={fixHref} className="m2-btn m2-next">
              {tr("Fix the {n} failing records", { n: int(failing) })}
            </V2Link>
          ) : null}
        </dl>
        <BlastMap nodes={model.nodes} edges={model.edges} currency={currency} lit={(id) => pathThrough(model, id)} />
        <p className="m2-meta">
          {tr("Select a field, step or feature to trace its path. Documents in flight are the open documents the failing records touch, joined in SAP on their keys.")}
          {blast.data?.keys_truncated ? <> {tr("The failing records were sampled for the join.")}</> : null}
        </p>
    </div>
  );
}

function BlastMap({ nodes, edges, currency, lit }: { nodes: BlastNode[]; edges: [string, string][]; currency: string | null; lit: (id: string) => Set<string> }) {
  const box = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [paths, setPaths] = useState<{ key: string; d: string; a: string; b: string }[]>([]);
  const on = useMemo(() => (sel ? lit(sel) : null), [sel, lit]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const draw = () => {
      const base = el.getBoundingClientRect();
      const at = new Map<string, DOMRect>();
      el.querySelectorAll<HTMLElement>("[data-node]").forEach((n) => at.set(n.dataset.node as string, n.getBoundingClientRect()));
      setPaths(
        edges.flatMap(([a, b]) => {
          const p = at.get(a);
          const q = at.get(b);
          if (!p || !q) return [];
          const x1 = p.right - base.left;
          const y1 = p.top + p.height / 2 - base.top;
          const x2 = q.left - base.left;
          const y2 = q.top + q.height / 2 - base.top;
          const mx = (x1 + x2) / 2;
          return [{ key: `${a}>${b}`, a, b, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` }];
        }),
      );
    };
    draw();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [edges, nodes]);

  return (
    <div className="m2-br-map" ref={box}>
      <svg className="m2-br-edges" aria-hidden="true">
        {paths.map((p) => (
          <path key={p.key} d={p.d} data-on={on ? String(on.has(p.a) && on.has(p.b)) : undefined} />
        ))}
      </svg>
      {BLAST_COLUMNS.map((col) => (
        <section key={col} className="m2-br-col" aria-label={HEADINGS[col]()}>
          <h3>{HEADINGS[col]()}</h3>
          <ul>
            {nodes
              .filter((n) => n.col === col)
              .map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    data-node={n.id}
                    data-status={n.status ?? undefined}
                    data-on={on ? String(on.has(n.id)) : undefined}
                    aria-pressed={sel === n.id}
                    onClick={() => setSel((s) => (s === n.id ? null : n.id))}
                  >
                    <span className="m2-br-label">{col === "field" ? <Mono>{n.label}</Mono> : n.label}</span>
                    {n.sub ? <span className="m2-br-sub">{n.sub}</span> : null}
                    {n.documents != null ? <span className="m2-br-num">{tr("{n} documents", { n: int(n.documents) })}</span> : null}
                    {n.status ? (
                      <span className="m2-br-num">
                        {n.status === "blocked" ? tr("Blocked") : tr("Degraded")}
                        {n.perMonth != null ? <>{"  "}{tr("{v} a month", { v: moneyCompactText(n.perMonth, currency) })}</> : null}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
