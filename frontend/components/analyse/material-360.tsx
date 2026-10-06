"use client";

/** Material 360 identity card: what the material is, in SAP field names. */

import { FieldChip, KeyValue, Mono, SectionCard } from "@/components/ui-core";
import type { Material360 } from "@/lib/api/materials";

const dash = (v: string | null | undefined) => (v ? v : "—");
const withLabel = (code: string | null, label: string | null) => (code ? (label ? `${code}, ${label}` : code) : "—");

export function MaterialIdentity({ m }: { m: Material360 }) {
  const ean = m.mean.find((r) => r.EAN11)?.EAN11 ?? null;
  // the levels also list sales orgs used elsewhere in the extract, so a missing sales view is visible
  const extended = new Set(m.mvke.map((r) => r.VKORG)).size;
  const salesOrgs = new Set(m.levels.filter((l) => l.kind === "sales").map((l) => l.id.split(":")[1].split("/")[0])).size;
  const rows = [
    { k: "Material number", v: <><FieldChip table="MARA" field="MATNR" /> <Mono>{m.matnr}</Mono></> },
    { k: "Material type", v: <><FieldChip table="MARA" field="MTART" /> {withLabel(m.mara.MTART, m.labels.MTART)}</> },
    { k: "Material group", v: <><FieldChip table="MARA" field="MATKL" /> {withLabel(m.mara.MATKL, m.labels.MATKL)}</> },
    { k: "Base unit", v: <><FieldChip table="MARA" field="MEINS" /> {withLabel(m.mara.MEINS, m.labels.MEINS)}</> },
    { k: "EAN", v: <><FieldChip table="MEAN" field="EAN11" /> {ean ? <Mono>{ean}</Mono> : "—"}</> },
    { k: "Old material number", v: <><FieldChip table="MARA" field="BISMT" /> {m.mara.BISMT ? <Mono>{m.mara.BISMT}</Mono> : "—"}</> },
    { k: "Plants", v: String(m.marc.length) },
    { k: "Sales orgs", v: `Extended to ${extended} of ${salesOrgs}` },
    { k: "Description language", v: dash(m.language) },
  ];
  return (
    <SectionCard title="Master record" meta={`${m.levels_total} levels`}>
      <KeyValue rows={rows} />
    </SectionCard>
  );
}
