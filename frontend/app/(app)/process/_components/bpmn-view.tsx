"use client";

/**
 * BPMN tab (process-discovery spec §7.3): the generated L4 diagram, read-only, in the
 * designer's canvas. Above L4 there is no diagram, so the tab asks for a level-4 process.
 */
import { Button, EmptyState } from "@/design";
import type { L4, ProcessModelDocument } from "@/types/process-model";
import { DesignerCanvas } from "@/app/(app)/insights/process/designer/_components/canvas";
import { locate } from "@/app/(app)/insights/process/designer/_components/doc";

const noop = () => {};

export function BpmnView({ doc, node, onOpenFlow }: { doc: ProcessModelDocument; node: string | null; onOpenFlow?: () => void }) {
  const hit = locate(doc, node);
  if (hit?.level !== 4) {
    return <EmptyState title="Pick a level-4 process to see its diagram" detail="Click through the flow until you reach a process with steps."
      action={onOpenFlow && <Button variant="secondary" onClick={onOpenFlow}>Open flow</Button>} />;
  }
  return (
    <DesignerCanvas l4={hit.item as L4} overlay={null} selected={null} editable={false} canDesign={false}
      onBlocked={noop} onSelect={noop} onMove={noop} onConnect={noop} onDeleteNode={noop} onDeleteFlow={noop}
      onAdd={noop} onLayout={noop} />
  );
}
