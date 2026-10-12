// frontend/design/templates/RecordPage.tsx
import type { ReactNode } from "react";
import { Pill, type PillTone } from "../primitives/Pill";
import { DomainChip } from "../primitives/DomainChip";
import { Mono } from "../primitives/Mono";
import { Skeleton } from "../primitives/Skeleton";
import { PageFrame } from "./PageFrame";

export interface RecordStatus {
  label: "passing" | "failing" | "in batch" | "fixed";
  tone: PillTone;
}

export function RecordPage({
  recordKey, object, status, children, loading = false,
}: {
  recordKey: string;
  object: string;
  status: RecordStatus;
  children: ReactNode;
  /** Header 32 + body 120 skeletons (screens.md 3.3) while the record loads. */
  loading?: boolean;
}) {
  if (loading) {
    return (
      <PageFrame gap={4} className="m-motion-stagger" data-state="loading">
        <Skeleton height={32} />
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
        <span style={{ color: "var(--m-ink-3)" }}>{object}</span>
        <DomainChip moduleId={object} />
        <Pill tone={status.tone}>{status.label}</Pill>
      </header>
      {children}
    </PageFrame>
  );
}
