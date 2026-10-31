"use client";

import { useMemo, useRef, useState } from "react";
import { useOpenItem, useRunParam } from "@/lib/v2/hooks";
import { buildLineage, COLUMN_TITLES, type LineageGraph, type LineageNode, type NodeKind } from "@/lib/v2/lineage-graph";
import { useConfigImpact } from "@/lib/v2/object-queries";
import { useLandscape, useObjectRules, useReceipt } from "@/lib/v2/queries";
import { int, moduleFromSlug } from "@/lib/v2/score";
import "../../mdm.css";
import { EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../../parts";
import { ScrollFrame } from "./ScrollFrame";
import { t as tr } from "@/lib/v2/i18n";

const KINDS: NodeKind[] = ["table", "field", "rule", "feature"];
const trim = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const MONO: ReadonlySet<NodeKind> = new Set<NodeKind>(["table", "field", "rule"]);

/** The graph as a standalone SVG file: the page's colours resolved, no stylesheet needed. */
export function svgFileOf(svg: SVGSVGElement): string {
  const cs = getComputedStyle(svg);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.removeAttribute("class");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = [
    `rect.bg{fill:${v("--m2-bg", "white")};stroke:none}`,
    `rect{fill:none;stroke:${v("--m2-line-2", "gray")};stroke-width:1}`,
    `line{stroke:${v("--m2-ink-3", "gray")};stroke-width:1}`,
    `text{fill:${v("--m2-fg", "black")};font-size:12px;font-family:sans-serif}`,
    `text.m,text.mono{font-family:monospace}`,
    `text.h{fill:${v("--m2-meta", "gray")}}`,
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

function Node({ n, on, hot, onEnter, onLeave, onPick, hrefFor }: { n: LineageNode; on: boolean; hot: boolean; onEnter: () => void; onLeave: () => void; onPick: () => void; hrefFor: (k: "rule" | "feature", id: string) => string }) {
  const label = trim(n.label, n.kind === "feature" ? 38 : 20);
  const inner = (
    <>
      <rect x={n.x} y={n.y} width={n.w} height={n.h} />
      <text x={n.x + 8} y={n.y + 17} className={MONO.has(n.kind) ? "mono" : undefined}>{label}</text>
    </>
  );
  const common = { "data-node": n.id, "data-kind": n.kind, "data-on": on || hot ? "true" : undefined, onMouseEnter: onEnter, onMouseLeave: onLeave, onFocus: onEnter, onBlur: onLeave } as const;
  if (n.open) {
    return (
      <V2Link href={hrefFor(n.open.kind, n.open.id)} className="m2-lg" aria-label={`${n.kind === "rule" ? tr("Rule") : tr("Feature")} ${n.label}`} {...common}>
        {inner}
      </V2Link>
    );
  }
  return (
    <g className="m2-lg" role="button" tabIndex={0} aria-pressed={hot} aria-label={`${n.kind === "table" ? tr("Table") : tr("Field")} ${n.label}`} onClick={onPick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } }} {...common}>
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
  const hrefOf = (k: "rule" | "feature", id: string): string => hrefFor({ kind: k, id });

  const exportSvg = () => {
    if (!svgRef.current) return;
    const ok = download(svgFileOf(svgRef.current), `lineage-${label.toLowerCase().replace(/\s+/g, "-")}.svg`);
    setNote(ok ? tr("The lineage was saved as an SVG file.") : tr("This browser cannot save the file."));
  };

  return (
    <div className="m2-lgwrap">
      <div>
        <ScrollFrame label={tr("Lineage graph, scrollable")}>
          <svg
            ref={svgRef}
            className="m2-lineage m2-lgx"
            viewBox={`0 0 ${graph.width} ${graph.height}`}
            width={graph.width}
            height={graph.height}
            role="group"
            aria-label={tr("Lineage of {label}: {counts} tables, {counts2} fields, {counts3} rules, {counts4} S/4 features", { label, counts: counts[0], counts2: counts[1], counts3: counts[2], counts4: counts[3] })}
            data-testid="lineage-graph"
          >
            {KINDS.map((k) => {
              const first = graph.nodes.find((n) => n.kind === k);
              return first ? (
                <text key={k} x={first.x} y={14} className="h">
                  {COLUMN_TITLES[k]}
                </text>
              ) : null;
            })}
            {graph.edges.map((e) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const on = active != null && (e.from === active.id || e.to === active.id);
              return <line key={`${e.from}>${e.to}`} x1={a.x + a.w} y1={a.y + a.h / 2} x2={b.x} y2={b.y + b.h / 2} data-edge={`${e.from}>${e.to}`} data-on={on ? "true" : undefined} />;
            })}
            {graph.nodes.map((n) => (
              <Node key={n.id} n={n} on={linked(n)} hot={pinned === n.id} onEnter={() => setHover(n.id)} onLeave={() => setHover((h) => (h === n.id ? null : h))} onPick={() => setPinned((p) => (p === n.id ? null : n.id))} hrefFor={hrefOf} />
            ))}
          </svg>
        </ScrollFrame>
        <p className="m2-prov">
          {tr("Drawn from the {shown} failing {shown, plural, one {rule} other {rules}} of {label} with the highest value at risk{value}. Features come from the impact model of the current run.", { shown: graph.shown, label, value: graph.hidden > 0 ? tr("; {hidden} more are not drawn", { hidden: int(graph.hidden) }) : "" })}
        </p>
      </div>
      <aside className="m2-lgfacts" aria-label={tr("Facts of the node")}>
        <h3 className="m2-h3">{active ? active.label : tr("Node facts")}</h3>
        {active ? (
          <>
            <dl className="m2-facts" data-testid="node-facts">
              {active.facts.map(([k, v]) => (
                <div className="m2-fact" key={k}>
                  <dt>{k}</dt>
                  <dd>{v || "—"}</dd>
                </div>
              ))}
            </dl>
            {(["upstream", "downstream"] as const).map((dir) => {
              const ids = graph.edges.filter((e) => (dir === "upstream" ? e.to : e.from) === active.id).map((e) => (dir === "upstream" ? e.from : e.to));
              const ns = ids.map((id) => byId.get(id)).filter((n): n is LineageNode => n != null);
              return (
                <div key={dir} data-testid={`node-${dir}`}>
                  <h4 className="m2-h3"><span>{dir === "upstream" ? tr("Upstream") : tr("Downstream")}</span><span className="m2-meta">{ns.length}</span></h4>
                  {ns.length === 0 ? <p className="m2-rp m2-meta">{tr("None")}</p> : (
                    <ul className="m2-flist">
                      {ns.map((n) => (
                        <li key={n.id}><button type="button" className="m2-linkbtn" onClick={() => setPinned(n.id)}>{n.label}</button></li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {active.open ? (
              <p className="m2-rp">
                <V2Link href={hrefOf(active.open.kind, active.open.id)}>{active.open.kind === "rule" ? tr("Open the rule") : tr("Open the feature")}</V2Link>
              </p>
            ) : null}
          </>
        ) : (
          <p className="m2-rp m2-meta">{tr("Hover or focus a node to see its facts here. Click a rule or a feature to open it.")}</p>
        )}
        <div className="m2-acts">
          <button type="button" className="m2-btn" onClick={exportSvg}>
            {tr("Export as SVG")}
          </button>
        </div>
        {note ? <p role="status" className="m2-prov">{note}</p> : null}
      </aside>
    </div>
  );
}

/** The Lineage tab: where the object's fields come from, which rules read them and which S/4 features those rules block. */
export function LineageTab({ module: moduleSegment }: { system: string; module: string }) {
  const run = useRunParam();
  const apiModule = moduleFromSlug(moduleSegment);
  const L = useLandscape(run);
  const label = `${L.data?.objects.find((o) => o.module === apiModule)?.label ?? apiModule.replace(/_/g, " ")}`;
  const receiptQ = useReceipt(apiModule, run);
  const rulesQ = useObjectRules(apiModule, run);
  const impactQ = useConfigImpact(receiptQ.data?.run_id);
  const graph = useMemo(() => buildLineage(rulesQ.data ?? [], impactQ.data ?? [], apiModule), [rulesQ.data, impactQ.data, apiModule]);

  if (rulesQ.isError) return <ErrorFrame onRetry={() => void rulesQ.refetch()}>{tr("The lineage of {label} could not be read.", { label })}</ErrorFrame>;
  if (rulesQ.isPending || (receiptQ.isPending && !receiptQ.isError)) {
    return (
      <div aria-busy="true" data-testid="lineage-loading">
        <Skeleton width="100%" height={220} />
      </div>
    );
  }
  if (graph.nodes.length === 0) {
    return (
      <EmptyFrame action={<V2Link href="/runs" className="m2-btn">{tr("Open the runs")}</V2Link>}>
        {tr("Lineage for {label} fills when an analysis finds failing rules: it draws the tables and fields those rules read and the S/4HANA features they block or degrade.", { label })}
      </EmptyFrame>
    );
  }
  return (
    <>
      {impactQ.isError ? <ErrorFrame onRetry={() => void impactQ.refetch()}>{tr("The S/4 features could not be read for this run, so the graph stops at the rules.")}</ErrorFrame> : null}
      <LineageView graph={graph} label={label} />
    </>
  );
}
