// frontend/design/templates/RecordPage.tsx
import type { ReactNode } from "react";
import { Pill, type PillTone } from "../primitives/Pill";
import { Mono } from "../primitives/Mono";

export interface RecordStatus {
  label: "passing" | "failing" | "in batch" | "fixed";
  tone: PillTone;
}

export function RecordPage({
  recordKey, object, status, children,
}: { recordKey: string; object: string; status: RecordStatus; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-center gap-3">
        <Mono>{recordKey}</Mono>
        <span style={{ color: "var(--m-ink-3)" }}>{object}</span>
        <Pill tone={status.tone}>{status.label}</Pill>
      </header>
      {children}
    </div>
  );
}
