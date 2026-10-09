import type { ReactNode } from "react";

export function BulkBar({ count, actions }: { count: number; actions: ReactNode }) {
  if (count === 0) return null;
  return (
    <div
      className="flex items-center justify-between px-3 py-2 rounded"
      style={{ background: "var(--m-accent-soft)" }}
    >
      <span className="text-[13px]" style={{ color: "var(--m-ink)" }}>{count} selected</span>
      <div className="flex gap-2">{actions}</div>
    </div>
  );
}
