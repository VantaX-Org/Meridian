import type { ReactNode } from "react";

export function Stat({ label, value, delta }: { label: string; value: ReactNode; delta?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>{label}</span>
      <span className="text-[22px] leading-[28px] font-semibold" style={{ color: "var(--m-ink)" }}>{value}</span>
      {delta != null && <span className="text-[13px] leading-[18px]">{delta}</span>}
    </div>
  );
}
