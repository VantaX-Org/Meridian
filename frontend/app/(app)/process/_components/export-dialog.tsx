"use client";

/**
 * Export dialog: Signavio (process-discovery spec §5.4, §7.3): whole L1 package or the current node,
 * with or without the view's filters, and the three Signavio import steps.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Dialog, Mono, Notice, RadioGroup } from "@/design";
import { downloadAuthenticated } from "@/lib/api/download";
import { pptxExportUrl } from "@/lib/api/process-designer";
import { exportRun, type ProcessFilterParams } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { fmtShare } from "./shared";

/** api/services/process_discovery/generate.py EDGE_THRESHOLD: edges under 1% of cases are left out of the export. */
const EDGE_THRESHOLD = 0.01;

export function ExportDialog({ open, onOpenChange, runId, l1, node, nodeName, filters }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  l1: string;
  node: string | null;
  nodeName: string;
  filters: ProcessFilterParams;
}) {
  const [format, setFormat] = useState<"signavio" | "pptx">("signavio");
  const [scope, setScope] = useState<"package" | "node">("package");
  const [useFilters, setUseFilters] = useState(true);
  const filtered = Object.keys(filters).length > 0;
  const run = useMutation({
    mutationFn: () => (format === "pptx"
      ? downloadAuthenticated(pptxExportUrl("reference"), `meridian-${l1}-reference.pptx`)
      : exportRun(runId, l1, useFilters ? filters : {}, scope === "node" && node ? node : undefined)),
    onSuccess: () => {
      toast(format === "pptx" ? "Exported the reference model as PowerPoint"
        : scope === "node" && node ? `Exported ${nodeName} as BPMN` : `Exported the ${l1} package for Signavio`);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Export"
      footer={<>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Close without exporting</Button>
        <Button onClick={() => run.mutate()} pending={run.isPending}>Export</Button>
      </>}>
      <div className="grid gap-4">
        <RadioGroup legend="Format" name="format" value={format} onValueChange={(v) => setFormat(v as "signavio" | "pptx")}
          options={[{ value: "signavio", label: "Signavio (BPMN 2.0)" }, { value: "pptx", label: "Reference model deck (.pptx)" }]} />
        {format === "pptx" ? (
          <p className="m-ink-3">
            A deck of the reference L1 to L5 process model: a summary, one slide per L1 and one per L4. Discovered cases and filters are not part of the deck.
          </p>
        ) : (<>
        <RadioGroup legend="Scope" name="scope" value={scope} onValueChange={(v) => setScope(v as "package" | "node")}
          options={[
            { value: "package", label: `Whole ${l1} package (.zip, one .bpmn per process)` },
            ...(node && node !== l1 ? [{ value: "node", label: `${nodeName} only (.bpmn)` }] : []),
          ]} />
        {filtered && (
          <RadioGroup legend="Filters" name="filters" value={useFilters ? "view" : "all"} onValueChange={(v) => setUseFilters(v === "view")}
            options={[{ value: "view", label: "The filters of this view" }, { value: "all", label: "Every case in the run" }]} />
        )}
        <p className="m-ink-3">
          Edges carried by fewer than {fmtShare(EDGE_THRESHOLD)} of cases are left out. Each step keeps its case count, share and median time.
        </p>
        <section className="grid gap-1">
          <h2 className="m-text-h font-semibold m-ink">Import into Signavio</h2>
          <ol className="grid list-decimal gap-1 pl-5">
            <li>Open the target folder in Signavio Process Manager.</li>
            <li>Choose Import, then BPMN 2.0 (.bpmn), and upload the files from the zip. Start with <Mono>{`L1_${l1}.bpmn`}</Mono>, then the rest.</li>
            <li>Each callActivity&apos;s calledElement is the process id of the exported file it refers to. Signavio may not link them on import: confirm the links after import and set any missing ones by hand.</li>
          </ol>
        </section>
        </>)}
        {run.isError && <Notice tone="danger" title="Could not export">{apiErrorMessage(run.error)}</Notice>}
      </div>
    </Dialog>
  );
}
