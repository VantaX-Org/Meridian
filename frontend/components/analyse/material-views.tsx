"use client";

/** F1: view completeness matrix. Rows are SAP views, columns are the levels each view lives at. */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { DetailDrawer, EmptyState, FieldChip, Mono, SectionCard, Select, useDrawerParam } from "@/components/ui-core";
import type { Material360, MaterialFindings, FailingRule } from "@/lib/api/materials";
import { levelLabel, matrixColumns } from "@/lib/material-views";

const SHAPE = { ok: "●", partial: "◐", missing: "○", na: "—", none: "·" } as const;
const MEANING = {
  ok: "maintained", partial: "maintained, a rule fails", missing: "expected, not maintained", na: "not expected", none: "not applicable here",
} as const;
type Shape = keyof typeof SHAPE;

export function failingAt(f: MaterialFindings | undefined, view: string, level: string): FailingRule[] {
  return (f?.by_view.find((v) => v.view === view)?.failing ?? []).filter((r) => r.level === level);
}

export function MaterialViews({ m, findings, plant, setPlant }: {
  m: Material360; findings?: MaterialFindings; plant: string; setPlant: (v: string) => void;
}) {
  const drawer = useDrawerParam("cell");
  const search = useSearchParams();
  const path = usePathname();
  const { shown, note } = matrixColumns(m.levels, m.levels_total);
  const ids = new Set(shown.map((l) => l.id));
  const rows = m.views.filter((v) => v.cells.some((c) => c.state !== "none" && ids.has(c.level)) || v.expected);
  const plants = m.marc.map((r) => r.WERKS).filter((w): w is string => !!w);

  const shapeOf = (view: string, level: string, state: string): Shape => {
    if (state === "ok") return failingAt(findings, view, level).length ? "partial" : "ok";
    return state === "missing" || state === "na" || state === "none" ? state : "none";
  };
  const href = (cell: string) => {
    const p = new URLSearchParams(search.toString());
    p.set("cell", cell);
    return `${path}?${p}`;
  };

  const raw = drawer.value ?? "";
  const dView = raw.slice(0, Math.max(raw.indexOf(":"), 0));
  const dLevel = raw.slice(dView.length + 1);
  const dRow = m.views.find((v) => v.view === dView);
  const dState = dRow?.cells.find((c) => c.level === dLevel)?.state ?? "none";
  const dRules = failingAt(findings, dView, dLevel);

  return (
    <SectionCard title="View completeness" meta={`${rows.length} views`}
      action={plants.length > 1 ? (
        <Select aria-label="Filter by plant" value={plant} onValueChange={setPlant} placeholder="All plants"
          options={plants.map((w) => ({ value: w, label: `Plant ${w}` }))} />
      ) : undefined}>
      {rows.length === 0 ? <EmptyState>No views to compare for this material.</EmptyState> : (
        <>
          <div className="ui-matrix-scroll">
            <table className="ui-matrix" aria-label="View completeness by level">
              <thead>
                <tr>
                  <th scope="col">View</th>
                  {shown.map((l) => <th key={l.id} scope="col">{levelLabel(l.id)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.view}>
                    <th scope="row">{r.label}</th>
                    {shown.map((l) => {
                      const state = r.cells.find((c) => c.level === l.id)?.state ?? "none";
                      const shape = shapeOf(r.view, l.id, state);
                      const label = `${r.label} at ${levelLabel(l.id)}: ${MEANING[shape]}`;
                      return (
                        <td key={l.id}>
                          {shape === "none" ? <span role="img" aria-label={label}>{SHAPE[shape]}</span>
                            : <Link href={href(`${r.view}:${l.id}`)} aria-label={label}>{SHAPE[shape]}</Link>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ui-section__meta" id="legend">
            {(Object.keys(SHAPE) as Shape[]).map((k, i) => (
              <span key={k}>{i ? "; " : ""}{SHAPE[k]} {MEANING[k]}</span>
            ))}
          </p>
          {note ? <p className="ui-section__meta">{note}</p> : null}
        </>
      )}
      <DetailDrawer open={!!drawer.value && !!dRow} onClose={drawer.close}
        header={<strong>{dRow?.label} at {dLevel ? levelLabel(dLevel) : ""}</strong>}>
        <p>{MEANING[shapeOf(dView, dLevel, dState)]}.</p>
        {dRules.length === 0 ? <p>No rule fails here.</p> : (
          <ul>
            {dRules.map((r) => (
              <li key={`${r.check_id}${r.record_key}`}>
                <div className="ui-cell-stack">
                  <span className="ui-cell-stack__main">{r.message}</span>
                  <span className="ui-cell-stack__sub">
                    <Link className="ui-link" href={`/analyse/rule/${r.check_id}`}><Mono>{r.check_id}</Mono></Link>
                    {r.field ? <FieldChip table={r.field.split(".")[0]} field={r.field.split(".")[1] ?? r.field} /> : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DetailDrawer>
    </SectionCard>
  );
}
