"use client";

import { useMemo } from "react";
import { Button, Mono } from "@/design";
import type { ProcessVariant } from "@/types/process-model";
import { addChild, newId, type Doc } from "./doc";

const NAMES: Record<string, string> = {
  PTP_MFG: "Plan to Produce", MTO: "Make to Order", RTR: "Record to Report", HTR: "Hire to Retire", STC: "Service to Cash",
};

export interface Group { process_id: string; tables: string[]; count: number }

/** Unmapped variants grouped by detector. A step is one SAP table. */
export function groupDiscovered(variants: ProcessVariant[]): Group[] {
  const m = new Map<string, { tables: Set<string>; count: number }>();
  for (const v of variants) {
    if (v.l4_id) continue;
    const g = m.get(v.process_id) ?? { tables: new Set<string>(), count: 0 };
    g.tables.add(v.sap_table);
    if (v.value !== "*") g.count += 1;
    m.set(v.process_id, g);
  }
  return [...m].map(([process_id, g]) => ({ process_id, tables: [...g.tables], count: g.count }));
}

/** An L1 with one L2, one L3 and one L4 per detector step, each with one activity in a straight line. */
export function skeletonFrom(doc: Doc, g: Group): Doc {
  let d = addChild(doc, null, NAMES[g.process_id] ?? g.process_id.replaceAll("_", " ").toLowerCase()).doc;
  const l1 = d.l1[d.l1.length - 1].id;
  const l2 = addChild(d, l1, "Discovered steps"); d = l2.doc;
  const l3 = addChild(d, l2.id, "Discovered flow"); d = l3.doc;
  for (const table of g.tables) {
    const l4 = addChild(d, l3.id, `${table} step`); d = l4.doc;
    const target = d.l1[d.l1.length - 1].l2[0].l3[0].l4.find((x) => x.id === l4.id)!;
    const actId = newId(d, `${l4.id}-A`);
    const nodeId = newId(d, `${l4.id}-N`);
    const end = target.diagram.nodes[1];
    const flows = target.diagram.flows;
    target.activities.push({ id: actId, name: `${table} activity`, description: "", order: 1, tcode: null, fields: [], check_ids: [], sap_tables: [table] });
    target.diagram.nodes.splice(1, 0, { id: nodeId, type: "task", activity_id: actId, label: null, x: 144, y: 20 });
    end.x = 424;
    flows[0].target = nodeId;
    flows.push({ id: newId(d, `${l4.id}-G`), source: nodeId, target: end.id, label: null, condition: null });
  }
  return d;
}

export function Discovered({ variants, onCreate }: { variants: ProcessVariant[]; onCreate: (g: Group) => void }) {
  const groups = useMemo(() => groupDiscovered(variants), [variants]);
  if (!groups.length) return null;
  return (
    <section className="aurora-designer__discovered" id="discovered" aria-label="Discovered, unmapped">
      <h2 className="aurora-designer__rail-title">Discovered, unmapped</h2>
      <ul className="ui-ranked">
        {groups.map((g) => (
          <li key={g.process_id}>
            <div className="ui-ranked__row">
              <span className="ui-ranked__title">{NAMES[g.process_id] ?? <Mono>{g.process_id}</Mono>}</span>
              <span className="ui-ranked__num">{g.count.toLocaleString()}</span>
              <span className="ui-ranked__meta">
                {g.tables.length} {g.tables.length === 1 ? "step" : "steps"}
              </span>
            </div>
            <Button variant="ghost" onClick={() => onCreate(g)}>Create L1 from discovered</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
