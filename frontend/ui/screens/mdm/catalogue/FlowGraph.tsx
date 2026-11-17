"use client";

import type { Dfg, NodeStats } from "@/lib/api/v2/discovery";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import "./flow.css";

const W = 184;
const H = 64;
const GAP_X = 72;
const GAP_Y = 24;
const PAD = 16;

/**
 * Layers by longest path from the entry steps. Edges that close a loop (found by a depth-first walk in the
 * order the API lists the steps) are left out of the layering and drawn as return arcs.
 */
export function layout(nodes: readonly NodeStats[], edges: Dfg["edges"]) {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const live = edges.filter((e) => known.has(e.source) && known.has(e.target) && e.source !== e.target);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  live.forEach((e) => out.get(e.source)?.push(e.target));
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const walk = (id: string) => {
    state.set(id, 1);
    for (const to of out.get(id) ?? []) {
      if (state.get(to) === 1) back.add(`${id}>${to}`);
      else if (!state.has(to)) walk(to);
    }
    state.set(id, 2);
  };
  const entries = ids.filter((id) => !live.some((e) => e.target === id));
  [...entries, ...ids].forEach((id) => { if (!state.has(id)) walk(id); });
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  // ponytail: Bellman-style relaxation, O(nodes x edges); a level holds a few dozen steps at most.
  for (let i = 0; i < ids.length; i++) {
    for (const e of live) {
      if (back.has(`${e.source}>${e.target}`)) continue;
      const l = (layer.get(e.source) ?? 0) + 1;
      if (l > (layer.get(e.target) ?? 0)) layer.set(e.target, l);
    }
  }
  const rows = new Map<number, number>();
  const pos = new Map<string, { x: number; y: number }>();
  ids.forEach((id) => {
    const l = layer.get(id) ?? 0;
    const r = rows.get(l) ?? 0;
    rows.set(l, r + 1);
    pos.set(id, { x: PAD + l * (W + GAP_X), y: PAD + r * (H + GAP_Y) });
  });
  const width = PAD * 2 + (Math.max(0, ...layer.values()) + 1) * (W + GAP_X) - GAP_X;
  const height = PAD * 2 + Math.max(1, ...rows.values()) * (H + GAP_Y) - GAP_Y + H;
  return { pos, back, live, width, height };
}

/** Pass, fail or unknown, from the data quality defects counted on the records behind the step. */
export const dqTone = (n: NodeStats) => (n.dq_defects == null ? "quiet" : n.dq_defects > 0 ? "crit" : "pass");

/**
 * The as-is flow of one level as a graph: steps as boxes coloured by their data quality, hand-offs as arrows whose
 * width follows the cases that took them. A picked variant lights its steps and hand-offs. A step opens the level
 * below it.
 */
export function FlowGraph({ dfg, variant, onOpen, testId }: { dfg: Dfg; variant?: readonly string[] | null; onOpen: (n: NodeStats) => void; testId?: string }) {
  const { pos, back, live, width, height } = layout(dfg.nodes, dfg.edges);
  const max = Math.max(1, ...live.map((e) => e.count));
  const name = new Map(dfg.nodes.map((n) => [n.id, n.name]));
  const lit = new Set(variant ?? []);
  const pairs = new Set((variant ?? []).slice(1).map((a, i) => `${variant?.[i]}>${a}`));
  const hot = Boolean(variant?.length);
  return (
    <div className="mx-flow" data-testid={testId} role="group" aria-label={t("As-is flow graph: steps, hand-offs and the cases on each")}>
      <div className="mx-flow-canvas" style={{ width, height }}>
        <svg width={width} height={height} aria-hidden="true">
          <defs>
            <marker id="mx-flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="mx-flow-head" />
            </marker>
          </defs>
          {live.map((e) => {
            const a = pos.get(e.source);
            const b = pos.get(e.target);
            if (!a || !b) return null;
            const loop = back.has(`${e.source}>${e.target}`) || b.x <= a.x;
            const x1 = loop ? a.x + W / 2 : a.x + W;
            const y1 = loop ? a.y + H : a.y + H / 2;
            const x2 = loop ? b.x + W / 2 : b.x;
            const y2 = loop ? b.y + H : b.y + H / 2;
            const dip = Math.max(y1, y2) + GAP_Y + H / 2;
            const d = loop ? `M${x1},${y1} C${x1},${dip} ${x2},${dip} ${x2},${y2}` : `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
            const on = pairs.has(`${name.get(e.source)}>${name.get(e.target)}`);
            return (
              <g key={`${e.source}>${e.target}`} data-on={hot ? on : undefined} className="mx-flow-edge">
                <path d={d} strokeWidth={1 + (5 * e.count) / max} markerEnd="url(#mx-flow-arrow)" fill="none" />
                <text x={(x1 + x2) / 2} y={loop ? dip - 4 : (y1 + y2) / 2 - 6} textAnchor="middle">{int(e.count)}</text>
              </g>
            );
          })}
        </svg>
        {dfg.nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const tone = dqTone(n);
          const dq = n.dq_defects == null ? t("Data quality not measured") : n.dq_defects > 0 ? t("{n} data quality defects", { n: int(n.dq_defects) }) : t("No data quality defects");
          return (
            <button
              key={n.id}
              type="button"
              className="mx-flow-node"
              data-tone={tone}
              data-observed={n.observed}
              data-on={hot ? lit.has(n.name) : undefined}
              style={{ left: p.x, top: p.y, width: W, height: H }}
              onClick={() => onOpen(n)}
              title={`${n.id} ${n.name}. ${dq}`}
              aria-label={t("{id} {name}: {cases} cases, {dq}. Open the level below.", { id: n.id, name: n.name, cases: int(n.case_count), dq })}
              data-testid={`pd-node-${n.id}`}
            >
              <span className="mx-flow-name"><code>{n.id}</code> {n.name}</span>
              <span className="mx-flow-meta">{n.observed ? t("{n} cases", { n: int(n.case_count) }) : t("Not observed")}</span>
            </button>
          );
        })}
      </div>
      <p className="mx-flow-key">
        <span data-tone="pass">{t("No data quality defects")}</span>
        <span data-tone="crit">{t("Has data quality defects")}</span>
        <span data-tone="quiet">{t("Data quality not measured")}</span>
        <span>{t("Arrow width follows the cases on the hand-off. Pick a step to open the level below.")}</span>
      </p>
    </div>
  );
}
