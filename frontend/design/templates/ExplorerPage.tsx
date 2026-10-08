// frontend/design/templates/ExplorerPage.tsx
import type { ReactNode } from "react";

export function ExplorerPage({
  filterBar, summary, table,
}: { filterBar?: ReactNode; summary?: ReactNode; table: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 p-6">
      {filterBar}
      {summary}
      {table}
    </div>
  );
}
