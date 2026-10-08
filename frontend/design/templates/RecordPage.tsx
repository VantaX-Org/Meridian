// frontend/design/templates/RecordPage.tsx
import type { ReactNode } from "react";
import { Pill } from "../primitives/Pill";
import { Mono } from "../primitives/Mono";

export function RecordPage({
  recordKey, object, status, children,
}: { recordKey: string; object: string; status: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-center gap-3">
        <Mono>{recordKey}</Mono>
        <span style={{ color: "var(--m-ink-3)" }}>{object}</span>
        <Pill>{status}</Pill>
      </header>
      {children}
    </div>
  );
}
