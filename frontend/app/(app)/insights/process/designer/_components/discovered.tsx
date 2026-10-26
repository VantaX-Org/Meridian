"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Button, Card, Mono } from "@/design";
import type { ProcessVariant } from "@/types/process-model";
import { addChild, newId, type Doc } from "./doc";

const NAMES: Record<string, string> = {
  PTP_MFG: "Plan to produce", MTO: "Make to order", RTR: "Record to report", HTR: "Hire to retire", STC: "Service to cash",
};

/**
 * Detector process_id (api/models/config_intelligence.py) to the process-discovery L1 that mines it.
 * PTP_MFG and MTO come from AUFK order categories 10 and 30 (variant_discovery.py), i.e. the PP and PM L1s.
 * STC has no discovery L1.
 */
const AS_IS_L1: Record<string, string> = { OTC: "OTC", PTP: "PTP", HTR: "HTR", RTR: "R2R", PTP_MFG: "PP", MTO: "PM" };

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
  let d = addChild(doc, null, NAMES[g.process_id] ?? g.process_id).doc;
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
    <Card title="Discovered, unmapped" padding="sm">
      <ul className="flex flex-col gap-3 [list-style:none] [margin:0] [padding:0]" id="discovered" aria-label="Discovered, unmapped">
        {groups.map((g) => (
          <li key={g.process_id} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 m-text-body m-ink">
              <span>{NAMES[g.process_id] ?? <Mono>{g.process_id}</Mono>}</span>
              <span className="m-text-meta m-ink-2">
                {g.count.toLocaleString()} variants, {g.tables.length} {g.tables.length === 1 ? "step" : "steps"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => onCreate(g)}>Create L1 from discovered</Button>
              {AS_IS_L1[g.process_id] && (
                // Without ?run= the drill opens the latest completed run of that L1.
                <Button variant="ghost" render={<Link href={`/process/${AS_IS_L1[g.process_id]}`}>Open as-is model</Link>} />
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
