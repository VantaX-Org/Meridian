import type { ReactNode } from "react";
import { PageFrame, Skeleton } from "@/design";

/** The one line under each process page's title: what it shows and what to do with it. */
export const PROCESS_PURPOSE = {
  catalogue: "How each business process really runs on this system, mined from its documents. Open one to see its flow and where it departs from the SAP reference.",
  runs: "Every discovery run on this system and how far it has got. Start a new run to refresh the mined flows.",
  l1: "The as-is flow of this process, mined from its documents. Select a step to drill into it, or compare it with the reference.",
  run: "Progress and result of one discovery run: its stages, the tables it read and any error.",
} as const;

/** Purpose line, then the page's own context line (system, run). */
export function processMeta(purpose: string, context?: ReactNode): ReactNode {
  return (
    <>
      <span className="block m-text-body m-ink-2">{purpose}</span>
      {context ? <span className="mt-1 block">{context}</span> : null}
    </>
  );
}

/** Page frame shared by the process pages: the layout's frame, so the page pads and centres like every other one. */
export function ProcessFrame({ children }: { children: ReactNode }) {
  return <PageFrame>{children}</PageFrame>;
}

export function RowsSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="grid gap-1" data-state="pending">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={44} />)}
    </div>
  );
}

/** Under an always-rendered PageHeader: 112px insight strip plus table rows. */
export function BodySkeleton({ rows = 7 }: { rows?: number }) {
  return (<><Skeleton height={112} /><RowsSkeleton rows={rows} /></>);
}
