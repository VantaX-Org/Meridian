// frontend/design/templates/ReportPage.tsx
import type { ReactNode } from "react";
import { Button } from "../primitives/Button";

export function ReportPage({
  narrative, charts, tables, onExport,
}: { narrative: string; charts: ReactNode; tables?: ReactNode; onExport?: () => void }) {
  return (
    <div className="flex flex-col gap-6 p-6">
      <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink)" }}>{narrative}</p>
      {charts}
      {tables}
      {onExport && <Button variant="secondary" onClick={onExport}>Export</Button>}
    </div>
  );
}
