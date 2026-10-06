"use client";

/**
 * Material 360: one material across every SAP view and level.
 *  - View completeness matrix, checks by view, fix path, possible duplicates, lifecycle and supersession.
 */

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader, TableSkeleton, Tally } from "@/components/ui-core";
import { PageCrumb } from "@/components/shell/page-crumb";
import { MaterialIdentity } from "@/components/analyse/material-360";
import { MaterialViews } from "@/components/analyse/material-views";
import { MaterialFixPath, MaterialRules } from "@/components/analyse/material-rules";
import { MaterialDuplicatesCard } from "@/components/analyse/material-duplicates";
import { MaterialLifecycle } from "@/components/analyse/material-lifecycle";
import { useUrlState } from "@/hooks/use-url-state";
import { getMaterial, getMaterialDuplicates, getMaterialFindings, getMaterialSupersession } from "@/lib/api/materials";
import { sumRuleCounts } from "@/lib/material-views";

const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

export default function Material360Page() {
  const matnr = decodeURIComponent(useParams<{ matnr: string }>().matnr);
  const [plant, setPlant] = useUrlState("plant");
  const mat = useQuery({ queryKey: ["material", matnr, plant], queryFn: () => getMaterial(matnr, { plant: plant || undefined }), retry: false });
  const vid = mat.data?.version_id;
  const findings = useQuery({ queryKey: ["material", matnr, "findings", vid], enabled: !!vid, queryFn: () => getMaterialFindings(matnr, { version_id: vid }) });
  const sup = useQuery({ queryKey: ["material", matnr, "supersession", vid, plant], enabled: !!vid,
    queryFn: () => getMaterialSupersession(matnr, { version_id: vid, plant: plant || undefined }) });
  const dup = useQuery({ queryKey: ["material", matnr, "duplicates", vid], enabled: !!vid, queryFn: () => getMaterialDuplicates(matnr, { version_id: vid }) });

  const crumb = (
    <PageCrumb segments={[
      { level: "portfolio", label: "Portfolio", href: "/" },
      { level: "hub", label: "Analyse", href: "/analyse" },
      { level: "page", label: `Material: ${mat.data?.description ?? "loading"}` },
    ]} />
  );
  if (mat.isLoading) return <div className="ui-page">{crumb}<TableSkeleton rows={6} label="Loading material" /></div>;
  const m = mat.data;
  if (!m) return <div className="ui-page">{crumb}<EmptyState>This material is not in the latest analysed extract.</EmptyState></div>;

  const sums = findings.data ? sumRuleCounts(findings.data.by_view) : null;
  const missing = m.views.reduce((n, v) => n + v.cells.filter((c) => c.state === "missing").length, 0);
  const chains = sup.data?.plants.filter((p) => p.links > 0) ?? [];
  const broken = chains.filter((p) => p.loop_at || p.dead_end).length;

  return (
    <div className="ui-page">
      {crumb}
      <PageHeader title={m.description ?? "Material without a description"}
        summary={`${plural(m.phasing.plants, "plant")}, ${plural(m.levels_total, "level")} in the latest extract.`} />
      <Tally level={4} label="Material health" figures={[
        { label: "Failing rules", value: sums?.failing ?? null, loading: findings.isLoading, href: "#rules",
          tone: sums?.failing ? "danger" : undefined,
          verdict: sums ? `${sums.failing} of ${sums.total} enabled rules fail.` : "Rules could not be read." },
        { label: "Missing views", value: missing, href: "#views",
          tone: missing ? "high" : undefined, verdict: missing ? "Expected views are not maintained at these levels." : "Every expected view is maintained." },
        { label: "Broken supersession", value: sup.data ? broken : null, loading: sup.isLoading, href: "#lifecycle",
          tone: broken ? "danger" : undefined, verdict: broken ? "A chain loops or ends before a live material." : "No loop or dead end in any chain." },
        { label: "Possible duplicates", value: dup.data ? dup.data.items.length : null, loading: dup.isLoading, href: "#duplicates",
          verdict: dup.data ? `Candidates at or above score ${dup.data.threshold}.` : "Duplicates could not be read." },
      ]} />
      <MaterialIdentity m={m} />
      <div id="views"><MaterialViews m={m} findings={findings.data} plant={plant} setPlant={setPlant} /></div>
      <div id="rules">{findings.data ? <MaterialRules f={findings.data} /> : <TableSkeleton rows={4} label="Loading checks" />}</div>
      {findings.data ? <MaterialFixPath f={findings.data} /> : null}
      <div id="duplicates">{dup.data ? <MaterialDuplicatesCard d={dup.data} /> : <TableSkeleton rows={3} label="Loading duplicates" />}</div>
      <div id="lifecycle">{sup.data ? <MaterialLifecycle m={m} s={sup.data} plant={plant} setPlant={setPlant} /> : <TableSkeleton rows={3} label="Loading lifecycle" />}</div>
    </div>
  );
}
