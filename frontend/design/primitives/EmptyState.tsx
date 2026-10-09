import type { ReactNode } from "react";

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center" style={{ color: "var(--m-ink-2)" }}>
      <p>{title}</p>
      {action}
    </div>
  );
}
