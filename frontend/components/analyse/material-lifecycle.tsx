"use client";

/** F4: lifecycle. Per-plant discontinuation fields, the supersession chain, and BOM usage. */

import Link from "next/link";
import { EmptyState, FieldChip, Mono, SectionCard, Select } from "@/components/ui-core";
import type { ChainNode, Material360, MaterialSupersession } from "@/lib/api/materials";
import { formatDate } from "@/lib/format";

const FLAG_TEXT: Record<string, string> = {
  MM551: "Supersession loops back",
  MM550: "Chain ends before a live material",
  MM552: "Chain continues past the depth shown",
};
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

function Flags({ flags }: { flags: string[] }) {
  return <>{flags.map((c, i) => (
    <span key={c}>{i ? " " : ""}<Link className="ui-link" href={`/analyse/rule/${c}`}><Mono>{c}</Mono></Link></span>
  ))}</>;
}

/** Text and links sit in separate blocks so a link is never inline with prose. */
function Note({ text, code }: { text: string; code: string }) {
  return (
    <div className="ui-cell-stack">
      <span className="ui-cell-stack__main">{text}</span>
      <span className="ui-cell-stack__sub"><Flags flags={[code]} /></span>
    </div>
  );
}

function Node({ n }: { n: ChainNode }) {
  return (
    <li>
      <div className="ui-cell-stack">
        <span className="ui-cell-stack__main">
          {n.this ? <strong>{n.maktx ?? "This material"}</strong> : (
            <Link className="ui-link" href={`/analyse/material/${encodeURIComponent(n.matnr)}`}>{n.maktx ?? "Material"}</Link>
          )}
        </span>
        <span className="ui-cell-stack__sub">
          <Mono>{n.matnr}</Mono>
          <span>{n.kzaus ? `Discontinued ${n.ausdt ? `from ${formatDate(n.ausdt)}` : "with no date"}` : "Not discontinued"}</span>
        </span>
        {n.flags.length ? <span className="ui-cell-stack__sub"><Flags flags={n.flags} /></span> : null}
      </div>
    </li>
  );
}

export function MaterialLifecycle({ m, s, plant, setPlant }: {
  m: Material360; s: MaterialSupersession; plant: string; setPlant: (v: string) => void;
}) {
  const plants = s.plants;
  const shown = plant ? plants.filter((p) => p.werks === plant) : plants.filter((p) => p.links > 0 || p.kzaus);
  const bom = s.bom_usage;
  return (
    <SectionCard title="Lifecycle and supersession"
      meta={`${plural(m.phasing.phasing_out, "plant")} discontinued of ${m.phasing.plants}`}
      action={plants.length > 1 ? (
        <Select aria-label="Plant for supersession" value={plant} onValueChange={setPlant} placeholder="Plants with a change"
          options={plants.map((p) => ({ value: p.werks, label: `Plant ${p.werks}` }))} />
      ) : undefined}>
      <p>
        <FieldChip table="MARC" field="KZAUS" /> marks a plant as discontinued, <FieldChip table="MARC" field="AUSDT" /> is the last
        date, and <FieldChip table="MARC" field="NFMAT" /> names the follow-up material.
      </p>
      {shown.length === 0 ? (
        <EmptyState>Not discontinued at any plant, and no follow-up material is set.</EmptyState>
      ) : shown.map((p) => (
        <div key={p.werks}>
          <h3 className="ui-section__title">Plant {p.werks}</h3>
          <ol>{p.chain.map((n) => <Node key={n.matnr} n={n} />)}</ol>
          {p.loop_at ? <Note text={FLAG_TEXT.MM551} code="MM551" /> : null}
          {p.dead_end ? <Note text={FLAG_TEXT.MM550} code="MM550" /> : null}
          {p.truncated ? <p>{FLAG_TEXT.MM552}. Showing {plural(p.depth, "link")}.</p> : null}
        </div>
      ))}
      <h3 className="ui-section__title">BOM usage</h3>
      {bom === null ? <p>BOM usage not loaded (<Mono>STPO</Mono>).</p>
        : bom.length === 0 ? <p>Not a component in any loaded bill of materials.</p> : (
          <table className="ui-mini-table" aria-label="BOM usage">
            <thead><tr><th>BOM</th><th>Item</th><th>Plant</th><th>Follow-up group</th><th>Rules</th></tr></thead>
            <tbody>
              {bom.map((b) => (
                <tr key={`${b.stlnr}${b.posnr}`}>
                  <td><Mono>{b.stlnr ?? "—"}</Mono></td><td><Mono>{b.posnr ?? "—"}</Mono></td><td><Mono>{b.werks ?? "—"}</Mono></td>
                  <td><Mono>{b.nfgrp ?? "—"}</Mono></td><td><Flags flags={b.flags} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </SectionCard>
  );
}
