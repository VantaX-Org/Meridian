// frontend/design/templates/RecordPage.tsx
import type { ReactNode } from "react";
import { Pill, type PillTone } from "../primitives/Pill";
import { DomainChip } from "../primitives/DomainChip";
import { Mono } from "../primitives/Mono";
import { Skeleton, StatSkeleton } from "../primitives/Skeleton";
import { Stat, type StatProps } from "../primitives/Stat";
import { formatModuleName } from "../../lib/format";
import { PageFrame } from "./PageFrame";

export interface RecordStatus {
  label: "passing" | "failing" | "in batch" | "fixed";
  tone: PillTone;
}

export function RecordPage({
  recordKey, object, status, children, stats, actions, loading = false,
}: {
  recordKey: string;
  object: string;
  status: RecordStatus;
  children: ReactNode;
  /** Stat row under the header (rule failures, dimensions failing, fields failing, batches, last changed, owner). */
  stats?: Pick<StatProps, "label" | "value" | "hint" | "tone">[];
  /** Page actions at the right of the header, e.g. the one ExportMenu. */
  actions?: ReactNode;
  /** Header 32 + body 120 skeletons (screens.md 3.3) while the record loads. */
  loading?: boolean;
}) {
  if (loading) {
    return (
      <PageFrame gap={4} className="m-motion-stagger" data-state="loading">
        <Skeleton height={32} />
        <div className="m-stat-grid">{[0, 1, 2, 3, 4, 5].map((i) => <StatSkeleton key={i} />)}</div>
        <Skeleton height={120} />
      </PageFrame>
    );
  }
  return (
    <PageFrame gap={4}>
      <header className="flex items-center gap-3">
        <span style={{ fontSize: "var(--m-text-title)", lineHeight: "var(--m-leading-title)", fontWeight: 600 }}>
          <Mono>{recordKey}</Mono>
        </span>
        <span style={{ color: "var(--m-ink-3)" }}>{formatModuleName(object)}</span>
        <DomainChip moduleId={object} />
        <Pill tone={status.tone}>{status.label}</Pill>
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </header>
      {stats && stats.length > 0 && <div className="m-stat-grid">{stats.map((x) => <Stat key={x.label} {...x} />)}</div>}
      {children}
    </PageFrame>
  );
}
